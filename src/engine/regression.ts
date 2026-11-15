import type {
  Evaluation,
  Instance,
  RegressionResult,
  RegressionRow,
  SearchProgress,
  Strategy,
} from '../shared/types.js';
import { evaluate } from './evaluate.js';
import { generateInstance, seededRandom } from './generation.js';
import { integer, LIMITS, validateInstance, validateStrategy } from './validation.js';

/** Missing a reachable target is worse than any complete route. Infinity stays internal. */
export function deficit(evaluation: Evaluation): number {
  if (!evaluation.witnessVerified || evaluation.verdict === 'invalid' || evaluation.verdict === 'incomplete')
    throw new Error('回归样本没有通过独立核验。');
  if (evaluation.instance.domain === 'graph') {
    if (!evaluation.reference.complete) return 0;
    return evaluation.candidate.complete ? evaluation.difference : Infinity;
  }
  return evaluation.difference;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

export function regress(
  instance: Instance,
  before: Strategy,
  after: Strategy,
  seed: number,
  count: number,
  onProgress?: (progress: SearchProgress) => void,
  isCancelled: () => boolean = () => false,
  history: Instance[] = [],
): RegressionResult {
  validateInstance(instance);
  validateStrategy(before);
  validateStrategy(after);
  if (instance.domain !== before.domain || instance.domain !== after.domain)
    throw new Error('回归实例与前后策略须属于同一领域。');
  integer(seed, -2147483648, 4294967295, '回归种子');
  integer(count, 0, LIMITS.regression, '回归保留样本数');
  if (!Array.isArray(history) || history.length > 20)
    throw new Error('历史回归实例须为不超过 20 个实例的数组。');
  const seen = new Set([canonical(instance)]),
    saved: Instance[] = [];
  for (const item of history) {
    validateInstance(item);
    if (item.domain !== instance.domain) throw new Error('历史回归实例必须属于同一领域。');
    const key = canonical(item);
    if (!seen.has(key)) {
      saved.push(item);
      seen.add(key);
    }
  }
  // A separate stream from search avoids simply replaying its same seeded prefix.
  const random = seededRandom((seed ^ 0x9e3779b9) >>> 0),
    rows: RegressionRow[] = [];
  const size = instance.domain === 'graph' ? instance.nodes.length : Math.max(2, instance.items.length);
  const values =
    instance.domain === 'interval'
      ? instance.items.flatMap((item) => [item.end, item.value])
      : instance.domain === 'knapsack'
        ? [instance.capacity, ...instance.items.flatMap((item) => [item.weight, item.value])]
        : instance.edges.map((edge) => edge.weight);
  const maxValue = Math.min(100, Math.max(2, ...values));
  const total = count + 1 + saved.length;
  onProgress?.({ checked: 0, total, found: 0 });
  for (let index = 0; index < total; index++) {
    if (isCancelled()) throw new Error('回归检查已取消；未返回未完成的比较结果。');
    const sample =
      index === 0
        ? instance
        : index <= saved.length
          ? saved[index - 1]
          : generateInstance(
              instance.domain,
              size,
              maxValue,
              random,
              instance.domain === 'interval' ? instance.objective : 'value',
            );
    const first = evaluate(sample, before),
      second = evaluate(sample, after);
    const a = deficit(first),
      b = deficit(second),
      change = b < a ? 'improved' : b > a ? 'regressed' : 'unchanged';
    rows.push({
      label:
        index === 0
          ? '原始实例'
          : index <= saved.length
            ? `历史实例 ${index}`
            : `保留样本 ${index - saved.length}`,
      instance: structuredClone(sample),
      before: first,
      after: second,
      change,
    });
    onProgress?.({
      checked: index + 1,
      total,
      found: rows.filter((row) => row.change === 'regressed').length,
    });
  }
  return {
    rows,
    seed,
    improved: rows.filter((row) => row.change === 'improved').length,
    regressed: rows.filter((row) => row.change === 'regressed').length,
    unchanged: rows.filter((row) => row.change === 'unchanged').length,
  };
}
