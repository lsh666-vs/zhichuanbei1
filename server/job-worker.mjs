import { parentPort, workerData } from 'node:worker_threads';
import { tsImport } from 'tsx/esm/api';

const cancelled = () => Atomics.load(new Int32Array(workerData.cancel), 0) !== 0;
let last = 0,
  lastProgress;
const progress = (value) => {
  lastProgress = value;
  const now = Date.now();
  if (now - last > 50 || value.checked === value.total) {
    parentPort.postMessage({ type: 'progress', progress: value });
    last = now;
  }
};
try {
  const engine = await tsImport('../src/engine/index.ts', import.meta.url);
  const { kind, payload } = workerData;
  let result;
  if (kind === 'search') result = engine.search(payload, progress, cancelled);
  else if (kind === 'shrink') result = engine.shrink(payload.evaluation, progress, cancelled);
  else if (kind === 'regression')
    result = engine.regress(
      payload.instance,
      payload.before,
      payload.after,
      payload.seed,
      payload.count,
      progress,
      cancelled,
      payload.history ?? [],
    );
  else throw new Error('未知任务类型');
  if (lastProgress) parentPort.postMessage({ type: 'progress', progress: lastProgress });
  parentPort.postMessage({ type: 'result', result });
} catch (error) {
  parentPort.postMessage({
    type: 'error',
    error: error instanceof Error ? error.message.slice(0, 500) : '计算失败',
  });
} finally {
  parentPort.close();
}
