import type { Execution, Instance, KnapsackItem } from '../shared/types.js';

/** Independent value checks deliberately use different state spaces from the trace executors. */
export function independentOptimum(instance: Instance): number | null {
  if (instance.domain === 'interval') {
    // A time-indexed recurrence, independent of the executor's predecessor-index DP.
    const maxTime = Math.max(...instance.items.map((item) => item.end));
    const timeline = new Int32Array(maxTime + 1);
    const endings = new Map<number, typeof instance.items>();
    for (const item of instance.items) endings.set(item.end, [...(endings.get(item.end) ?? []), item]);
    for (let t = 1; t <= maxTime; t++) {
      timeline[t] = timeline[t - 1];
      for (const item of endings.get(t) ?? [])
        timeline[t] = Math.max(
          timeline[t],
          timeline[item.start] + (instance.objective === 'count' ? 1 : item.value),
        );
    }
    return timeline[maxTime];
  }
  if (instance.domain === 'knapsack') {
    // Meet-in-the-middle subset enumeration, independent of capacity DP.
    const middle = Math.floor(instance.items.length / 2),
      capacity = instance.capacity;
    function subsets(items: KnapsackItem[]): { weight: number; value: number }[] {
      let entries = [{ weight: 0, value: 0 }];
      for (const item of items)
        entries = [
          ...entries,
          ...entries
            .filter((entry) => entry.weight + item.weight <= capacity)
            .map((entry) => ({ weight: entry.weight + item.weight, value: entry.value + item.value })),
        ];
      return entries;
    }
    const left = subsets(instance.items.slice(0, middle)),
      right = subsets(instance.items.slice(middle)).sort((a, b) => a.weight - b.weight || b.value - a.value);
    let best = 0;
    for (const item of right) {
      best = Math.max(best, item.value);
      item.value = best;
    }
    let answer = 0;
    for (const item of left) {
      let lo = 0,
        hi = right.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (right[mid].weight <= instance.capacity - item.weight) lo = mid + 1;
        else hi = mid;
      }
      if (lo > 0) answer = Math.max(answer, item.value + right[lo - 1].value);
    }
    return answer;
  }
  // Bellman–Ford uses synchronous rounds and no executor adjacency/path helpers.
  let distances = new Map(
    instance.nodes.map((node) => [node.id, node.id === instance.source ? 0 : Infinity]),
  );
  for (let round = 0; round < instance.nodes.length - 1; round++) {
    const next = new Map(distances);
    for (const edge of instance.edges) {
      next.set(edge.to, Math.min(next.get(edge.to)!, distances.get(edge.from)! + edge.weight));
      if (!instance.directed)
        next.set(edge.from, Math.min(next.get(edge.from)!, distances.get(edge.to)! + edge.weight));
    }
    distances = next;
  }
  const answer = distances.get(instance.target)!;
  return Number.isFinite(answer) ? answer : null;
}

/** An additional deliberately small brute-force oracle, used on interval witnesses. */
export function enumerateIntervalOptimum(instance: Extract<Instance, { domain: 'interval' }>): number {
  let best = 0;
  function visit(index: number, selected: number[], value: number) {
    if (index === instance.items.length) {
      best = Math.max(best, value);
      return;
    }
    visit(index + 1, selected, value);
    const current = instance.items[index];
    if (
      selected.every((i) => {
        const other = instance.items[i];
        return current.end <= other.start || other.end <= current.start;
      })
    )
      visit(index + 1, [...selected, index], value + (instance.objective === 'count' ? 1 : current.value));
  }
  visit(0, [], 0);
  return best;
}

export function verifyExecution(instance: Instance, execution: Execution): boolean {
  if (!execution.feasible || !Number.isSafeInteger(execution.value) || execution.value < 0) return false;
  if (new Set(execution.solutionIds).size !== execution.solutionIds.length) return false;
  if (instance.domain === 'graph') {
    const nodes = execution.pathNodeIds;
    if (!nodes || nodes[0] !== instance.source || nodes.length !== execution.solutionIds.length + 1)
      return false;
    if (new Set(nodes).size !== nodes.length) return false;
    let value = 0;
    for (let i = 0; i < execution.solutionIds.length; i++) {
      const edge = instance.edges.find((item) => item.id === execution.solutionIds[i]);
      if (!edge) return false;
      if (
        !(edge.from === nodes[i] && edge.to === nodes[i + 1]) &&
        !(!instance.directed && edge.to === nodes[i] && edge.from === nodes[i + 1])
      )
        return false;
      value += edge.weight;
    }
    return value === execution.value && execution.complete === (nodes.at(-1) === instance.target);
  }
  const selected = execution.solutionIds.map((id) => instance.items.find((item) => item.id === id));
  if (selected.some((item) => !item) || !execution.complete) return false;
  if (instance.domain === 'interval') {
    const items = selected as typeof instance.items;
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++)
        if (items[i].start < items[j].end && items[j].start < items[i].end) return false;
    return (
      execution.value ===
      items.reduce((sum, item) => sum + (instance.objective === 'count' ? 1 : item.value), 0)
    );
  }
  const items = selected as typeof instance.items;
  return (
    items.reduce((sum, item) => sum + item.weight, 0) <= instance.capacity &&
    items.reduce((sum, item) => sum + item.value, 0) === execution.value
  );
}
