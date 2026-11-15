import { describe, expect, test } from 'vitest';
import { report, escapeHtml } from '../server/report.ts';
import {
  ENGINE_VERSION,
  defaultStrategy,
  demoInstance,
  evaluate,
  presets,
  regress,
  search,
  shrink,
} from '../src/engine/index.ts';
import type { Evaluation, Experiment, GraphInstance } from '../src/shared/types.ts';

const timestamp = '2026-11-15T12:00:00.000Z';
function experiment(evaluation: Evaluation): Experiment {
  return {
    id: 'report-example',
    title: '可重放报告',
    domain: evaluation.instance.domain,
    createdAt: timestamp,
    updatedAt: timestamp,
    instance: evaluation.instance,
    strategy: evaluation.strategy,
    evaluation,
    versions: [
      {
        id: 'revision-1',
        at: timestamp,
        strategy: evaluation.strategy,
        instance: evaluation.instance,
        evaluation,
        note: '初始实验',
      },
    ],
  };
}
function graph(): GraphInstance {
  return {
    domain: 'graph',
    directed: true,
    source: 'S',
    target: 'T',
    nodes: [
      { id: 'S', label: '起点', x: 0, y: 0 },
      { id: 'A', label: '死路', x: 1, y: 1 },
      { id: 'T', label: '终点', x: 2, y: 0 },
    ],
    edges: [
      { id: 'SA', from: 'S', to: 'A', weight: 1 },
      { id: 'ST', from: 'S', to: 'T', weight: 4 },
    ],
  };
}
function currentSummary(html: string) {
  return html.slice(html.indexOf('<section class="verdict"'), html.indexOf('</section>'));
}
function auditSection(html: string, id: string) {
  const start = html.indexOf(`<section id="${id}">`);
  expect(start).toBeGreaterThanOrEqual(0);
  return html.slice(start, html.indexOf('</section>', start));
}

describe('semantic graph report values', () => {
  test('unreachable targets do not appear as successful zero-cost paths or zero gaps', () => {
    const instance = { ...graph(), edges: [] },
      evaluation = evaluate(instance, defaultStrategy('graph'));
    expect(evaluation.reference.value).toBe(0);
    expect(evaluation.reference.complete).toBe(false);
    const html = report(experiment(evaluation), ENGINE_VERSION),
      summary = currentSummary(html);
    expect(summary).toContain('<dt>候选路径</dt><dd>未到达</dd>');
    expect(summary).toContain('<dt>参照路径</dt><dd>不可达</dd>');
    expect(summary).toContain('<dt>目标差距</dt><dd>差距不适用</dd>');
    expect(summary).not.toContain('<dd>0</dd>');
    expect(summary).toContain('目标不可达（已独立核验）');
    expect(html).toContain('终态：未到达');
    expect(html).toContain('终态：不可达');
    expect(auditSection(html, 'versions')).not.toContain('<dd>0</dd>');
  });
  test('a candidate dead end preserves the verified reference path cost and avoids a numeric gap', () => {
    const evaluation = evaluate(graph(), defaultStrategy('graph'));
    expect(evaluation.candidate.complete).toBe(false);
    expect(evaluation.verdict).toBe('counterexample');
    const summary = currentSummary(report(experiment(evaluation), ENGINE_VERSION));
    expect(summary).toContain('<dt>候选路径</dt><dd>未到达</dd>');
    expect(summary).toContain('<dt>参照路径</dt><dd>4</dd>');
    expect(summary).toContain('差距不适用');
    expect(summary).not.toContain('<dd>0</dd>');
    expect(summary).toContain('已验证反例');
  });
  test('a genuine complete zero-cost route retains its numeric zero values', () => {
    const instance = { ...graph(), edges: [{ id: 'ST', from: 'S', to: 'T', weight: 0 }] },
      evaluation = evaluate(instance, defaultStrategy('graph'));
    expect(evaluation.candidate.complete).toBe(true);
    expect(evaluation.reference.complete).toBe(true);
    const summary = currentSummary(report(experiment(evaluation), ENGINE_VERSION));
    expect(summary.match(/<dd>0<\/dd>/g)).toHaveLength(3);
    expect(summary).not.toContain('差距不适用');
  });
  test('unverified incomplete output is not labeled independently proven unreachable', () => {
    const actual = evaluate({ ...graph(), edges: [] }, defaultStrategy('graph'));
    const summary = currentSummary(
      report(experiment({ ...actual, witnessVerified: false, verdict: 'invalid' }), ENGINE_VERSION),
    );
    expect(summary).toContain('结果未通过独立核验');
    expect(summary).toContain('<dt>参照路径</dt><dd>未完成</dd>');
    expect(summary).not.toContain('目标不可达（已独立核验）');
    expect(summary).toContain('差距不适用');
  });
});

function withAudit(): Experiment {
  const instance = demoInstance('interval'),
    strategy = defaultStrategy('interval'),
    before = evaluate(instance, strategy);
  const afterStrategy = presets('interval').find((item) => item.algorithm === 'optimal')!,
    after = evaluate(instance, afterStrategy);
  const data = experiment(after);
  data.search = search({ domain: 'interval', strategy, seed: 42, attempts: 100, size: 6, maxValue: 20 });
  data.shrink = shrink(before);
  data.shrink.minimality = 'reduced';
  data.regression = regress(instance, strategy, afterStrategy, 71, 3);
  data.versions = [
    { id: 'revision-1', at: timestamp, strategy, instance, evaluation: before, note: '首次反例' },
    {
      id: 'revision-2',
      at: timestamp,
      strategy: afterStrategy,
      instance,
      evaluation: after,
      note: '修复策略',
    },
    { id: 'legacy', at: timestamp, strategy: afterStrategy, note: '旧版无快照' },
  ];
  return data;
}

describe('saved report audit and escaping', () => {
  test.each([
    ['not_found', 10, '有限抽样未发现反例'],
    ['incomplete', 2, '搜索未完成'],
  ] as const)('search status %s retains its saved coverage boundary', (status, checked, label) => {
    const data = experiment(evaluate(demoInstance('interval'), defaultStrategy('interval')));
    data.search = { status, checked, total: 10, seed: 4294967295, elapsedMs: 17 };
    const html = auditSection(report(data, ENGINE_VERSION), 'search');
    expect(html).toContain(label);
    expect(html).toContain(`<dd>${checked} / 10</dd>`);
    expect(html).toContain('<dt>随机种子</dt><dd>4294967295</dd>');
    expect(html).toContain('该记录未附带反例见证');
    expect(html).not.toContain('发现并验证反例');
  });

  test('shows actual search statistics, accepted reductions, regression rows and revision snapshots', () => {
    const data = withAudit(),
      html = report(data, ENGINE_VERSION);
    const searchHtml = auditSection(html, 'search');
    expect(searchHtml).toContain('<dt>随机种子</dt><dd>42</dd>');
    expect(searchHtml).toContain(`<dd>${data.search!.checked} / 100</dd>`);
    expect(searchHtml).toContain('发现并验证反例');
    expect(searchHtml).toContain('本报告没有重新运行搜索');
    expect(searchHtml).toContain('采样覆盖未重新执行');
    const shrinkHtml = auditSection(html, 'shrink');
    expect(shrinkHtml).toContain(`<dt>接受步骤</dt><dd>${data.shrink!.steps.length}</dd>`);
    expect(shrinkHtml).toContain(`<dt>原运行候选检查</dt><dd>${data.shrink!.checks}</dd>`);
    expect(shrinkHtml).toContain(escapeHtml(data.shrink!.steps[0].description));
    expect(shrinkHtml).toContain('不声明局部或全局最小');
    expect(shrinkHtml).toContain('也不能证明全局最小反例');
    const regressionHtml = auditSection(html, 'regression');
    expect(regressionHtml).toContain('<dt>比较实例</dt><dd>4</dd>');
    expect(regressionHtml).toContain(`<dt>改善</dt><dd>${data.regression!.improved}</dd>`);
    expect(regressionHtml).toContain('<dt>退化</dt><dd>0</dd>');
    expect(regressionHtml).toContain('<dt>保留样本种子</dt><dd>71</dd>');
    for (const row of data.regression!.rows) expect(regressionHtml).toContain(escapeHtml(row.label));
    const versionsHtml = auditSection(html, 'versions');
    expect(versionsHtml).toContain('首次反例');
    expect(versionsHtml).toContain('修复策略');
    expect(versionsHtml).toContain('已验证反例');
    expect(versionsHtml).toContain('当前实例通过');
    expect(versionsHtml).toContain('此旧修订没有输入快照');
  });
  test('dead-end semantics remain truthful within search, shrink, regression and old snapshots', () => {
    const instance = graph(),
      strategy = defaultStrategy('graph'),
      before = evaluate(instance, strategy),
      after = evaluate(instance, presets('graph')[1]);
    const data = experiment(after);
    data.versions.unshift({
      id: 'failed',
      at: timestamp,
      strategy,
      instance,
      evaluation: before,
      note: '原始死路',
    });
    data.search = {
      status: 'counterexample',
      checked: 1,
      total: 10,
      seed: 8,
      elapsedMs: 1,
      evaluation: before,
    };
    data.shrink = shrink(before);
    data.regression = regress(instance, strategy, after.strategy, 8, 0);
    const html = report(data, ENGINE_VERSION);
    for (const id of ['search', 'shrink', 'regression', 'versions'])
      expect(auditSection(html, id)).toContain('未到达');
    expect(auditSection(html, 'regression')).toContain('候选 未到达 / 参照 4 · 差距不适用');
    expect(auditSection(html, 'shrink')).toContain('差距不适用');
  });
  test('every user-controlled audit surface is escaped and standalone CSP blocks active content', () => {
    const injected = '</summary><script>globalThis.reportInjection=1</script><img src=x onerror="1">';
    const data = withAudit();
    data.title = injected;
    data.strategy.name = injected;
    if (data.instance.domain === 'interval') data.instance.items[0].label = injected;
    data.evaluation!.details.push(injected);
    data.evaluation!.candidate.steps[0].message = injected;
    data.search!.reason = injected;
    data.shrink!.steps[0].description = injected;
    data.regression!.rows[0].label = injected;
    data.versions[0].note = injected;
    const html = report(data, `version ${injected}`);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html.match(/&lt;script&gt;/g)!.length).toBeGreaterThanOrEqual(8);
    expect(html).toContain('http-equiv="Content-Security-Policy"');
    expect(html).toContain("default-src 'none'");
    expect(html).toContain('&lt;/summary&gt;');
    expect(html).toContain('onerror=&quot;1&quot;');
    expect(escapeHtml('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
  test('missing calculation or audit data is described without invented results', () => {
    const data = experiment(evaluate(demoInstance('interval'), defaultStrategy('interval')));
    delete data.evaluation;
    data.versions = data.versions.map(
      ({ instance: _instance, evaluation: _evaluation, ...version }) => version,
    );
    const html = report(data, ENGINE_VERSION);
    expect(currentSummary(html)).toContain('尚未计算');
    expect(html).not.toContain('<section id="search">');
    expect(html).not.toContain('<section id="shrink">');
    expect(html).not.toContain('<section id="regression">');
    expect(auditSection(html, 'versions')).toContain('此修订没有计算结果快照');
  });
});
