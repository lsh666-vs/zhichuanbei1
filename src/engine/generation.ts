import type { Domain, GraphInstance, Instance, Objective } from '../shared/types.js';

/** Mulberry32: explicit uint32 state makes all generated input reproducible. */
export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateInstance(
  domain: Domain,
  size: number,
  maxValue: number,
  random: () => number,
  objective: Objective = 'value',
): Instance {
  const int = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1));
  if (domain === 'interval')
    return {
      domain,
      objective,
      items: Array.from({ length: size }, (_, index) => {
        const start = int(0, maxValue - 1);
        return {
          id: `I${index + 1}`,
          label: `任务 ${index + 1}`,
          start,
          end: start + int(1, maxValue),
          value: int(0, maxValue),
        };
      }),
    };
  if (domain === 'knapsack')
    return {
      domain,
      capacity: int(1, maxValue),
      items: Array.from({ length: size }, (_, index) => ({
        id: `K${index + 1}`,
        label: `物品 ${index + 1}`,
        weight: int(1, maxValue),
        value: int(0, maxValue),
      })),
    };
  const nodes = Array.from({ length: size }, (_, index) => ({
    id: `N${index + 1}`,
    label: index === 0 ? '起点' : index === size - 1 ? '终点' : `节点 ${index + 1}`,
    x: Math.round(250 + 190 * Math.cos((2 * Math.PI * index) / size)),
    y: Math.round(200 + 150 * Math.sin((2 * Math.PI * index) / size)),
  }));
  const instance: GraphInstance = {
    domain,
    nodes,
    edges: [],
    source: nodes[0].id,
    target: nodes.at(-1)!.id,
    directed: random() < 0.7,
  };
  const pairs = new Set<string>();
  function add(from: number, to: number) {
    const ends = instance.directed ? [from, to] : [Math.min(from, to), Math.max(from, to)],
      key = ends.join(':');
    if (from === to || pairs.has(key) || instance.edges.length >= 80) return;
    pairs.add(key);
    instance.edges.push({
      id: `E${instance.edges.length + 1}`,
      from: nodes[from].id,
      to: nodes[to].id,
      weight: int(0, maxValue),
    });
  }
  // Three quarters of graphs have a guaranteed route; the rest also test unreachable cases.
  if (random() < 0.75) for (let i = 0; i < size - 1; i++) add(i, i + 1);
  const density = 0.15 + random() * 0.5;
  for (let from = 0; from < size; from++)
    for (let to = 0; to < size; to++) {
      if (from !== to && (instance.directed || from < to) && random() < density) add(from, to);
    }
  return instance;
}
