import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Domain } from '../src/shared/types.ts';
import { defaultStrategy, presets, regress, search, shrink } from '../src/engine/index.ts';
import { Store } from '../server/store.ts';

const directory = resolve('examples');
mkdirSync(directory, { recursive: true });
const store = new Store(resolve('.runtime/example-generation.sqlite'));
const results = [];
try {
  for (const domain of ['interval', 'knapsack', 'graph'] as Domain[]) {
    const strategy = defaultStrategy(domain);
    const found = search({ domain, strategy, seed: 20261115, attempts: 300, size: 7, maxValue: 20 });
    if (!found.evaluation || found.status !== 'counterexample')
      throw new Error(`${domain}: expected a reproducible witness for the example strategy.`);
    const reduced = shrink(found.evaluation);
    const regression = regress(reduced.final.instance, strategy, presets(domain).at(-1)!, 314159, 12);
    const saved = store.save({
      title: `${domain} · 固定种子反例与修正`,
      instance: reduced.final.instance,
      strategy,
      evaluation: reduced.final,
      search: found,
      shrink: reduced,
      regression,
    });
    const exported = store.export(saved.id)!;
    const imported = store.import(exported);
    if (imported.evaluation?.verdict !== 'counterexample') throw new Error('Round-trip lost witness.');
    writeFileSync(resolve(directory, `${domain}.counterlab.json`), JSON.stringify(exported, null, 2));
    results.push({
      domain,
      checked: found.checked,
      seed: found.seed,
      reductionSteps: reduced.steps.length,
      regressionImproved: regression.improved,
      regressionRegressed: regression.regressed,
      roundTripVerified: true,
    });
  }
  writeFileSync(resolve('.runtime/example-generation-results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  store.close();
}
