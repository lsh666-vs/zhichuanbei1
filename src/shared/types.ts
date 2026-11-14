export type Domain = 'interval' | 'knapsack' | 'graph';
export type Objective = 'value' | 'count';
export interface IntervalItem { id: string; label: string; start: number; end: number; value: number }
export interface KnapsackItem { id: string; label: string; weight: number; value: number }
export interface GraphNode { id: string; label: string; x: number; y: number }
export interface GraphEdge { id: string; from: string; to: string; weight: number }
export interface IntervalInstance { domain: 'interval'; items: IntervalItem[]; objective: Objective }
export interface KnapsackInstance { domain: 'knapsack'; items: KnapsackItem[]; capacity: number }
export interface GraphInstance { domain: 'graph'; nodes: GraphNode[]; edges: GraphEdge[]; source: string; target: string; directed: boolean }
export type Instance = IntervalInstance | KnapsackInstance | GraphInstance;
export interface Strategy { id: string; name: string; domain: Domain; algorithm: 'greedy' | 'optimal' | 'dijkstra' | 'local'; score: string; direction: 'asc' | 'desc'; tieBreak: 'id' | 'value' | 'weight' | 'start' | 'end' }
export interface TraceStep { index: number; kind: 'consider' | 'select' | 'reject' | 'visit' | 'relax' | 'finish'; message: string; activeIds: string[]; selectedIds: string[]; currentValue: number; rejectedIds?: string[]; frontier?: {id:string;distance:number}[]; data?: Record<string,unknown> }
export interface Execution { solutionIds: string[]; value: number; feasible: boolean; complete: boolean; reason?: string; steps: TraceStep[]; pathNodeIds?: string[] }
export interface Evaluation { instance: Instance; strategy: Strategy; candidate: Execution; reference: Execution; verdict: 'counterexample' | 'pass' | 'invalid' | 'incomplete'; difference: number; witnessVerified: boolean; details: string[] }
export interface SearchOptions { domain: Domain; strategy: Strategy; seed: number; attempts: number; size: number; maxValue?: number; objective?: Objective }
export interface SearchProgress { checked: number; total: number; found: number }
export interface SearchResult { status: 'counterexample' | 'not_found' | 'incomplete'; checked: number; total: number; seed: number; elapsedMs: number; evaluation?: Evaluation; reason?: string; samples?: {index:number;gap:number}[] }
export interface ShrinkStep { description: string; beforeSize: number; afterSize: number; instance: Instance; evaluation: Evaluation }
export interface ShrinkResult { original: Evaluation; final: Evaluation; steps: ShrinkStep[]; checks: number; minimality: 'reduced' | 'local'; elapsedMs: number }
export interface RegressionRow { label: string; instance: Instance; before: Evaluation; after: Evaluation; change: 'improved' | 'regressed' | 'unchanged' }
export interface RegressionResult { rows: RegressionRow[]; improved: number; regressed: number; unchanged: number; seed: number }
export interface Experiment { id: string; title: string; domain: Domain; createdAt: string; updatedAt: string; instance: Instance; strategy: Strategy; versions: {id:string;at:string;strategy:Strategy;note:string}[]; evaluation?: Evaluation; search?: SearchResult; shrink?: ShrinkResult; regression?: RegressionResult }
export interface ExperimentPackage { format: 'counterlab-experiment'; version: 1; engineVersion: string; exportedAt: string; experiment: Experiment; checksum: string }
export interface JobStatus { id: string; kind: 'search' | 'shrink' | 'regression'; state: 'queued' | 'running' | 'completed' | 'cancelled' | 'failed'; progress: SearchProgress; result?: SearchResult | ShrinkResult | RegressionResult; error?: string }
export interface AiStatus { configured: boolean; provider: string; model: string; baseUrl: string; calls: number; inputTokens: number; outputTokens: number }
export interface AiProposal { strategy: Strategy; explanation: string; assumptions: string[]; source: 'live-model' }

