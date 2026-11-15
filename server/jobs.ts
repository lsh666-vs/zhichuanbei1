import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import type { JobStatus, SearchProgress } from '../src/shared/types.ts';
import type { Store } from './store.ts';

type Entry = {
  status: JobStatus;
  payload: unknown;
  cancel: SharedArrayBuffer;
  worker?: Worker;
  timer?: ReturnType<typeof setTimeout>;
};
export class JobError extends Error {
  statusCode = 429;
}
export class Jobs {
  private entries = new Map<string, Entry>();
  private active = 0;
  private closing = false;
  constructor(
    private store: Store,
    private timeoutMs = 45000,
  ) {}
  create(kind: JobStatus['kind'], payload: unknown): JobStatus {
    if (this.closing) throw new JobError('服务正在关闭');
    if ([...this.entries.values()].filter((e) => ['queued', 'running'].includes(e.status.state)).length >= 8)
      throw new JobError('任务队列已满，请等待或取消现有任务');
    this.prune();
    const status: JobStatus = {
      id: randomUUID(),
      kind,
      state: 'queued',
      progress: { checked: 0, total: 0, found: 0 },
    };
    this.entries.set(status.id, { status, payload, cancel: new SharedArrayBuffer(4) });
    this.store.saveJob(status);
    queueMicrotask(() => this.pump());
    return structuredClone(status);
  }
  get(id: string) {
    const status = this.entries.get(id)?.status ?? this.store.getJob(id);
    return status ? structuredClone(status) : undefined;
  }
  cancel(id: string): JobStatus | undefined {
    const entry = this.entries.get(id);
    if (!entry) return this.store.getJob(id);
    if (!['queued', 'running'].includes(entry.status.state)) return entry.status;
    Atomics.store(new Int32Array(entry.cancel), 0, 1);
    entry.status.state = 'cancelled';
    entry.status.error = '用户取消了任务，不能将其解释为未找到反例。';
    this.store.saveJob(entry.status);
    if (entry.timer) clearTimeout(entry.timer);
    if (entry.worker) void entry.worker.terminate();
    else this.pump();
    return entry.status;
  }
  private pump() {
    if (this.closing || this.active >= 1) return;
    const entry = [...this.entries.values()].find((e) => e.status.state === 'queued');
    if (!entry) return;
    this.active++;
    entry.status.state = 'running';
    this.store.saveJob(entry.status);
    let worker: Worker;
    try {
      worker = new Worker(new URL('./job-worker.mjs', import.meta.url), {
        workerData: { kind: entry.status.kind, payload: entry.payload, cancel: entry.cancel },
        execArgv: [],
        resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32 },
      });
    } catch {
      entry.status.state = 'failed';
      entry.status.error = '无法启动计算进程，请检查本地运行环境。';
      this.store.saveJob(entry.status);
      this.active--;
      queueMicrotask(() => this.pump());
      return;
    }
    entry.worker = worker;
    worker.on(
      'message',
      (message: {
        type: string;
        progress?: SearchProgress;
        result?: JobStatus['result'];
        error?: string;
      }) => {
        if (entry.status.state !== 'running') return;
        if (message.type === 'progress' && message.progress) entry.status.progress = message.progress;
        else if (message.type === 'result') {
          entry.status.state = 'completed';
          entry.status.result = message.result;
        } else if (message.type === 'error') {
          entry.status.state = 'failed';
          entry.status.error = message.error?.slice(0, 500) ?? '计算失败';
        }
        this.store.saveJob(entry.status);
      },
    );
    worker.on('error', () => {
      if (entry.status.state === 'running') {
        entry.status.state = 'failed';
        entry.status.error = '计算进程异常退出，实验数据未改变。';
        this.store.saveJob(entry.status);
      }
    });
    worker.on('exit', () => {
      if (entry.timer) clearTimeout(entry.timer);
      if (entry.status.state === 'running') {
        entry.status.state = 'failed';
        entry.status.error = '计算进程未返回完整结果。';
        this.store.saveJob(entry.status);
      }
      entry.worker = undefined;
      this.active--;
      this.prune();
      this.pump();
    });
    entry.timer = setTimeout(() => {
      if (entry.status.state === 'running') {
        entry.status.state = 'failed';
        entry.status.error = '任务超过计算时限；搜索未完成，不代表不存在反例。';
        this.store.saveJob(entry.status);
        void worker.terminate();
      }
    }, this.timeoutMs);
  }
  private prune() {
    for (const [id, item] of this.entries) {
      if (this.entries.size < 100) break;
      if (!item.worker && !['queued', 'running'].includes(item.status.state)) this.entries.delete(id);
    }
  }
  async close() {
    this.closing = true;
    const pending: Promise<number>[] = [];
    for (const entry of this.entries.values()) {
      if (['running', 'queued'].includes(entry.status.state)) {
        entry.status.state = 'failed';
        entry.status.error = '服务关闭导致任务中断，请重新运行。';
        this.store.saveJob(entry.status);
      }
      if (entry.timer) clearTimeout(entry.timer);
      if (entry.worker) pending.push(entry.worker.terminate());
    }
    await Promise.all(pending);
  }
}
