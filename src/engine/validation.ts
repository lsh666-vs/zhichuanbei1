import type { Domain, Instance, Strategy } from '../shared/types.js';
import { compileScore } from './score.js';

export const LIMITS = {
  interval: 16,
  knapsack: 18,
  graph: 12,
  edges: 80,
  attempts: 2000,
  regression: 100,
} as const;
export const lexical = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export function integer(value: unknown, min: number, max: number, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`${label}须为 ${min}–${max} 的安全整数。`);
}
function object(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label}须为对象。`);
}
function text(value: unknown, label: string, max = 80): asserts value is string {
  if (typeof value !== 'string' || value.length > max || value.length === 0)
    throw new Error(`${label}须为 1–${max} 个字符。`);
}
function id(value: unknown) {
  text(value, '对象 ID', 32);
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('对象 ID 只能包含字母、数字、下划线和连字符。');
}
function array(value: unknown, min: number, max: number, label: string): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max)
    throw new Error(`${label}数量须为 ${min}–${max}。`);
}
export function validateInstance(input: unknown): asserts input is Instance {
  object(input, '实例');
  if (input.domain === 'interval' || input.domain === 'knapsack') {
    array(input.items, 1, LIMITS[input.domain], '项目');
    const ids = new Set<string>();
    for (const item of input.items) {
      object(item, '项目');
      id(item.id);
      text(item.label, '项目标签');
      if (ids.has(item.id as string)) throw new Error(`对象 ID 重复：${item.id}`);
      ids.add(item.id as string);
      integer(item.value, 0, 100000, '收益');
      if (input.domain === 'interval') {
        integer(item.start, 0, 10000, '开始时间');
        integer(item.end, 0, 10000, '结束时间');
        if (item.start >= item.end) throw new Error('区间开始时间必须小于结束时间。');
      } else integer(item.weight, 1, 10000, '重量');
    }
    if (input.domain === 'interval') {
      if (input.objective !== 'count' && input.objective !== 'value')
        throw new Error('区间目标须为 count 或 value。');
    } else integer(input.capacity, 0, 10000, '容量');
  } else if (input.domain === 'graph') {
    array(input.nodes, 2, LIMITS.graph, '节点');
    array(input.edges, 0, LIMITS.edges, '边');
    if (typeof input.directed !== 'boolean') throw new Error('图的 directed 必须为布尔值。');
    const ids = new Set<string>();
    for (const node of input.nodes) {
      object(node, '节点');
      id(node.id);
      text(node.label, '节点标签');
      if (ids.has(node.id as string)) throw new Error(`节点 ID 重复：${node.id}`);
      ids.add(node.id as string);
      for (const key of ['x', 'y'])
        if (
          typeof node[key] !== 'number' ||
          !Number.isFinite(node[key]) ||
          Math.abs(node[key] as number) > 10000
        )
          throw new Error('节点坐标须为 -10000–10000 的有限数。');
    }
    id(input.source);
    id(input.target);
    if (!ids.has(input.source as string) || !ids.has(input.target as string))
      throw new Error('起点和终点须对应已有节点。');
    const edgeIds = new Set<string>(),
      pairs = new Set<string>();
    for (const edge of input.edges) {
      object(edge, '边');
      id(edge.id);
      id(edge.from);
      id(edge.to);
      integer(edge.weight, 0, 10000, '边权');
      if (!ids.has(edge.from as string) || !ids.has(edge.to as string))
        throw new Error('边的端点须对应已有节点。');
      if (edge.from === edge.to) throw new Error('当前图契约不允许自环。');
      if (edgeIds.has(edge.id as string)) throw new Error(`边 ID 重复：${edge.id}`);
      edgeIds.add(edge.id as string);
      const ends = [edge.from, edge.to] as string[];
      if (!input.directed) ends.sort(lexical);
      const pair = JSON.stringify(ends);
      if (pairs.has(pair)) throw new Error('当前图契约不允许重复连接同一对端点的边。');
      pairs.add(pair);
    }
  } else throw new Error('领域必须为 interval、knapsack 或 graph。');
}
export function validateStrategy(input: unknown): asserts input is Strategy {
  object(input, '策略');
  text(input.id, '策略 ID', 80);
  text(input.name, '策略名称');
  if (!['interval', 'knapsack', 'graph'].includes(input.domain as string)) throw new Error('策略领域无效。');
  const domain = input.domain as Domain;
  const allowed = domain === 'graph' ? ['local', 'dijkstra', 'optimal'] : ['greedy', 'optimal'];
  if (!allowed.includes(input.algorithm as string))
    throw new Error(`该领域支持算法：${allowed.join('、')}。`);
  if (input.direction !== 'asc' && input.direction !== 'desc') throw new Error('排序方向须为 asc 或 desc。');
  const ties =
    domain === 'interval'
      ? ['id', 'value', 'start', 'end']
      : domain === 'knapsack'
        ? ['id', 'value', 'weight']
        : ['id', 'weight'];
  if (!ties.includes(input.tieBreak as string)) throw new Error(`该领域支持平局规则：${ties.join('、')}。`);
  compileScore(input.score as string, domain);
}
