/** Opt-in integration probe: makes two real model requests, never prints credentials. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AiClient } from '../server/ai.ts';
import { defaultStrategy, demoInstance, evaluate } from '../src/engine/index.ts';

const ai = new AiClient();
if (!ai.status().configured) throw new Error('Configure the local .env before running this paid API probe.');
const started = performance.now();
const strategy = defaultStrategy('interval');
const proposal = await ai.propose({
  domain: 'interval',
  instruction:
    '把区间调度策略改成优先选择结束最早的任务；若结束时间相同，按ID升序。说明它对最多任务数与最大收益的不同适用边界。',
  currentStrategy: strategy,
});
if (
  proposal.strategy.score !== 'end' ||
  proposal.strategy.direction !== 'asc' ||
  proposal.strategy.algorithm !== 'greedy'
)
  throw new Error('Live strategy did not preserve the requested contract.');
const evaluation = evaluate(demoInstance('interval'), strategy);
const explanation = await ai.explain(evaluation);
if (!explanation.text.trim()) throw new Error('Empty live explanation.');
const status = ai.status();
const result = {
  kind: 'live-provider-integration',
  at: new Date().toISOString(),
  provider: status.provider,
  model: status.model,
  calls: status.calls,
  inputTokens: status.inputTokens,
  outputTokens: status.outputTokens,
  elapsedMs: Math.round(performance.now() - started),
  strategyValidated: true,
  explanationReceived: true,
  proposal,
  explanation,
  scope:
    'Two real requests; correctness of arbitrary model prose is not guaranteed. Numerical verdicts remain deterministic.',
};
const output = resolve('.runtime/live-ai-results.json');
mkdirSync(resolve('.runtime'), { recursive: true });
writeFileSync(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, proposal: undefined, explanation: undefined }, null, 2));
