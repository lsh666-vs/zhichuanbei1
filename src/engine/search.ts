import type { SearchOptions, SearchProgress, SearchResult } from '../shared/types.js';
import { evaluate } from './evaluate.js';
import { generateInstance, seededRandom } from './generation.js';
import { integer, LIMITS, validateStrategy } from './validation.js';

export function search(
  options: SearchOptions,
  onProgress?: (progress: SearchProgress) => void,
  isCancelled: () => boolean = () => false,
): SearchResult {
  if (!options || typeof options !== 'object') throw new Error('搜索参数须为对象。');
  validateStrategy(options.strategy);
  if (options.domain !== options.strategy.domain) throw new Error('搜索领域与策略必须相同。');
  integer(options.seed, -2147483648, 4294967295, '随机种子');
  integer(options.attempts, 1, LIMITS.attempts, '搜索样本数');
  integer(options.size, 2, LIMITS[options.domain], '实例规模');
  const maxValue = options.maxValue ?? 20;
  integer(maxValue, 2, 100, '生成数值上限');
  if (options.objective !== undefined && options.objective !== 'count' && options.objective !== 'value')
    throw new Error('区间目标须为 count 或 value。');
  const started = performance.now(),
    random = seededRandom(options.seed),
    samples: NonNullable<SearchResult['samples']> = [];
  let checked = 0;
  const base = () => ({
    checked,
    total: options.attempts,
    seed: options.seed,
    elapsedMs: Math.round(performance.now() - started),
    samples,
  });
  onProgress?.({ checked: 0, total: options.attempts, found: 0 });
  for (let index = 0; index < options.attempts; index++) {
    if (isCancelled())
      return { ...base(), status: 'incomplete', reason: '搜索已取消；只对已检查样本保留结论。' };
    const instance = generateInstance(options.domain, options.size, maxValue, random, options.objective);
    const evaluation = evaluate(instance, options.strategy);
    checked++;
    if (
      !evaluation.witnessVerified ||
      evaluation.verdict === 'invalid' ||
      evaluation.verdict === 'incomplete'
    )
      return { ...base(), status: 'incomplete', reason: '样本未通过独立核验，搜索未完成。' };
    // Dead-end has no numerical path-length gap: store the finite sentinel 0, not Infinity.
    samples.push({ index: checked, gap: evaluation.difference });
    const found = evaluation.verdict === 'counterexample';
    onProgress?.({ checked, total: options.attempts, found: found ? 1 : 0 });
    if (found) return { ...base(), status: 'counterexample', evaluation };
  }
  return {
    ...base(),
    status: 'not_found',
    reason: `在种子 ${options.seed} 的 ${checked} 个随机样本中未发现反例；这是抽样结果，不是穷尽检验或正确性证明。`,
  };
}
