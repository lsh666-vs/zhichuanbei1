import type {
  AiProposal,
  AiStatus,
  Domain,
  Evaluation,
  Experiment,
  ExperimentPackage,
  Instance,
  JobStatus,
  SearchOptions,
  Strategy,
} from '../shared/types';

export interface CatalogEntry {
  domain: Domain;
  title: string;
  description: string;
  instance: Instance;
  strategy: Strategy;
  presets: Strategy[];
}
export interface Catalog {
  domains: CatalogEntry[];
  engineVersion: string;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options?.headers },
    });
  } catch {
    throw new Error('无法连接本地实验服务。请确认 CounterLab 服务已启动，再重试。');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || `请求失败（${response.status}）`);
  return data as T;
}
const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const api = {
  catalog: () => request<Catalog>('/catalog'),
  evaluate: (instance: Instance, strategy: Strategy) => post<Evaluation>('/evaluate', { instance, strategy }),
  experiments: () => request<Experiment[]>('/experiments'),
  save: (experiment: Partial<Experiment>, id?: string) =>
    request<Experiment>(id ? `/experiments/${encodeURIComponent(id)}` : '/experiments', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(experiment),
    }),
  remove: (id: string) =>
    request<{ ok: boolean }>(`/experiments/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  search: (options: SearchOptions) => post<JobStatus>('/jobs/search', options),
  shrink: (evaluation: Evaluation) => post<JobStatus>('/jobs/shrink', { evaluation }),
  regression: (instance: Instance, before: Strategy, after: Strategy, seed: number, count: number) =>
    post<JobStatus>('/jobs/regression', { instance, before, after, seed, count }),
  job: (id: string) => request<JobStatus>(`/jobs/${encodeURIComponent(id)}`),
  cancel: (id: string) => post<JobStatus>(`/jobs/${encodeURIComponent(id)}/cancel`, {}),
  import: (value: ExperimentPackage) => post<Experiment>('/import', value),
  aiStatus: () => request<AiStatus>('/ai/status'),
  propose: (domain: Domain, instruction: string, currentStrategy: Strategy) =>
    post<AiProposal>('/ai/propose', { domain, instruction, currentStrategy }),
  explain: (evaluation: Evaluation) =>
    post<{ text: string; source: 'live-model' }>('/ai/explain', { evaluation }),
};

export const domainLabels: Record<Domain, string> = {
  interval: '区间调度',
  knapsack: '0-1 资源分配',
  graph: '图路由',
};
export const clone = <T>(value: T): T => structuredClone(value);
export const initialInstance: Instance = {
  domain: 'interval',
  objective: 'value',
  items: [
    { id: 'A', label: '任务 A', start: 0, end: 4, value: 9 },
    { id: 'B', label: '任务 B', start: 0, end: 2, value: 6 },
    { id: 'C', label: '任务 C', start: 2, end: 4, value: 6 },
  ],
};
export const initialStrategy: Strategy = {
  id: 'value-first',
  name: '收益优先',
  domain: 'interval',
  algorithm: 'greedy',
  score: 'value',
  direction: 'desc',
  tieBreak: 'id',
};
