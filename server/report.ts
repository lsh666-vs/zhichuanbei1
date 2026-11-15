import type { Evaluation, Experiment, Instance } from '../src/shared/types.ts';

export function escapeHtml(value: unknown) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
}

const verdictNames = {
  counterexample: '已验证反例',
  pass: '当前实例通过',
  invalid: '实例/策略无效',
  incomplete: '计算未完成',
};

function verdict(evaluation: Evaluation) {
  if (!evaluation.witnessVerified) return '结果未通过独立核验';
  if (
    evaluation.instance.domain === 'graph' &&
    !evaluation.reference.complete &&
    evaluation.verdict === 'pass'
  ) {
    return '目标不可达（已独立核验）';
  }
  return verdictNames[evaluation.verdict];
}

function executionValue(evaluation: Evaluation, side: 'candidate' | 'reference'): string {
  const execution = evaluation[side];
  if (evaluation.instance.domain === 'graph' && !execution.complete) {
    if (side === 'candidate') return '未到达';
    return evaluation.witnessVerified && evaluation.verdict === 'pass' ? '不可达' : '未完成';
  }
  if (!execution.complete) return '未完成';
  if (!execution.feasible) return '不可行';
  return String(execution.value);
}

function gap(evaluation: Evaluation) {
  if (
    !evaluation.witnessVerified ||
    !evaluation.candidate.complete ||
    !evaluation.reference.complete ||
    evaluation.verdict === 'invalid' ||
    evaluation.verdict === 'incomplete'
  ) {
    return '差距不适用';
  }
  return String(evaluation.difference);
}

function metrics(entries: [string, unknown][]) {
  return `<dl class="metrics">${entries.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>`;
}

function summary(evaluation: Evaluation) {
  const isGraph = evaluation.instance.domain === 'graph';
  return `<p class="result-label">${escapeHtml(verdict(evaluation))}</p>${metrics([
    [isGraph ? '候选路径' : '候选值', executionValue(evaluation, 'candidate')],
    [isGraph ? '参照路径' : '参照值', executionValue(evaluation, 'reference')],
    ['目标差距', gap(evaluation)],
  ])}`;
}

function compactResult(evaluation: Evaluation) {
  const difference = gap(evaluation);
  return `${escapeHtml(verdict(evaluation))}<br><small>候选 ${escapeHtml(executionValue(evaluation, 'candidate'))} / 参照 ${escapeHtml(executionValue(evaluation, 'reference'))} · ${difference === '差距不适用' ? difference : `差距 ${escapeHtml(difference)}`}</small>`;
}

function instanceSummary(instance: Instance) {
  if (instance.domain === 'interval')
    return `${instance.items.length} 个区间 · 目标：${instance.objective === 'count' ? '任务数量' : '总收益'}`;
  if (instance.domain === 'knapsack') return `${instance.items.length} 件物品 · 容量 ${instance.capacity}`;
  return `${instance.nodes.length} 个节点 · ${instance.edges.length} 条边 · ${instance.source} → ${instance.target} · ${instance.directed ? '有向图' : '无向图'}`;
}

function json(value: unknown) {
  return `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
}

function trace(evaluation: Evaluation, side: 'candidate' | 'reference') {
  const title = side === 'candidate' ? '候选策略的真实执行轨迹' : '参照解的真实执行轨迹';
  const execution = evaluation[side],
    isGraph = evaluation.instance.domain === 'graph';
  return `<section><h2>${title}</h2>${isGraph ? '<p class="note">过程数值只描述该执行步骤；到达终点的完整路径才能用于最终路径代价比较。</p>' : ''}<ol class="trace">${execution.steps
    .map((step) => {
      const value =
        step.kind === 'finish' && !execution.complete
          ? `终态：${executionValue(evaluation, side)}`
          : `${isGraph ? '过程数值' : '当前值'} ${step.currentValue}`;
      return `<li><strong>${escapeHtml(step.kind)}</strong> ${escapeHtml(step.message)} <small>${escapeHtml(value)}</small></li>`;
    })
    .join('')}</ol></section>`;
}

function searchAudit(experiment: Experiment) {
  const search = experiment.search;
  if (!search) return '';
  const status = {
    counterexample: '发现并验证反例',
    not_found: '有限抽样未发现反例',
    incomplete: '搜索未完成',
  }[search.status];
  return `<section id="search"><h2>搜索记录</h2>${metrics([
    ['保存时状态', status],
    ['随机种子', search.seed],
    ['已检查 / 计划样本', `${search.checked} / ${search.total}`],
    ['原运行耗时', `${search.elapsedMs} ms`],
  ])}<p class="note">种子、检查次数、耗时和状态是保存时的历史记录；本报告没有重新运行搜索。已有见证在保存/导入时重新计算，采样覆盖未重新执行。有限抽样未发现反例不构成普遍正确性证明。</p>${search.reason ? `<p>${escapeHtml(search.reason)}</p>` : ''}${search.evaluation ? `<h3>保存的搜索见证</h3>${summary(search.evaluation)}<details><summary>查看见证输入与策略</summary>${json({ instance: search.evaluation.instance, strategy: search.evaluation.strategy })}</details>` : '<p>该记录未附带反例见证。</p>'}</section>`;
}

function shrinkAudit(experiment: Experiment) {
  const shrink = experiment.shrink;
  if (!shrink) return '';
  const minimality =
    shrink.minimality === 'local'
      ? '原运行记录：在其局部编辑集合内不可再缩减'
      : '已缩减；不声明局部或全局最小';
  return `<section id="shrink"><h2>反例缩减记录</h2>${metrics([
    ['接受步骤', shrink.steps.length],
    ['原运行候选检查', shrink.checks],
    ['原运行耗时', `${shrink.elapsedMs} ms`],
  ])}<p>原始输入：${escapeHtml(instanceSummary(shrink.original.instance))}<br>最终输入：${escapeHtml(instanceSummary(shrink.final.instance))}</p><p>${escapeHtml(minimality)}</p><p class="note">保存/导入时复核每步的输入、原策略、同类失败和有效缩减关系；此处的检查次数属于历史记录。重新验证反例性质不等于重新执行最小性搜索，也不能证明全局最小反例。</p>${summary(shrink.final)}${shrink.steps.length ? `<div class="table-wrap" role="region" aria-label="缩减步骤" tabindex="0"><table><thead><tr><th scope="col">步骤</th><th scope="col">接受的修改</th><th scope="col">结构规模</th><th scope="col">复核结果</th></tr></thead><tbody>${shrink.steps.map((step, index) => `<tr><td>${escapeHtml(index + 1)}</td><td>${escapeHtml(step.description)}</td><td>${escapeHtml(step.beforeSize)} → ${escapeHtml(step.afterSize)}</td><td>${compactResult(step.evaluation)}</td></tr>`).join('')}</tbody></table></div>` : '<p>没有接受任何缩减步骤，最终输入与原始输入相同。</p>'}<details><summary>查看缩减前后输入</summary>${json({ original: shrink.original.instance, final: shrink.final.instance, strategy: shrink.original.strategy })}</details></section>`;
}

function regressionAudit(experiment: Experiment) {
  const regression = experiment.regression;
  if (!regression) return '';
  const change = { improved: '改善', regressed: '退化', unchanged: '不变' };
  return `<section id="regression"><h2>修复与回归记录</h2>${metrics([
    ['改善', regression.improved],
    ['退化', regression.regressed],
    ['不变', regression.unchanged],
    ['比较实例', regression.rows.length],
    ['保留样本种子', regression.seed],
  ])}<p class="note">保存/导入时，对每行的同一输入重新计算前后策略，并重新统计变化类型；样本来源和种子为保存时记录。本报告没有重新生成保留样本。没有退化只表示本表覆盖的实例中没有退化。</p><div class="table-wrap" role="region" aria-label="回归比较" tabindex="0"><table><thead><tr><th scope="col">实例</th><th scope="col">修改前</th><th scope="col">修改后</th><th scope="col">变化</th></tr></thead><tbody>${regression.rows.map((row) => `<tr><td>${escapeHtml(row.label)}<br><small>${escapeHtml(instanceSummary(row.instance))}</small></td><td>${compactResult(row.before)}</td><td>${compactResult(row.after)}</td><td>${escapeHtml(change[row.change])}</td></tr>`).join('')}</tbody></table></div></section>`;
}

function versions(experiment: Experiment) {
  return `<section id="versions"><h2>实验修订与快照</h2><ol class="versions">${experiment.versions.map((version, index) => `<li><h3>修订 ${escapeHtml(index + 1)} · ${escapeHtml(version.strategy.name)}</h3><p><time>${escapeHtml(version.at)}</time> · ${escapeHtml(version.note)}</p>${version.instance ? `<p>${escapeHtml(instanceSummary(version.instance))}</p>` : '<p class="note">此旧修订没有输入快照，无法重放当时的输入。</p>'}${version.evaluation ? summary(version.evaluation) : '<p>此修订没有计算结果快照。</p>'}<details><summary>查看此修订的策略${version.instance ? '与输入' : ''}</summary>${json({ strategy: version.strategy, ...(version.instance ? { instance: version.instance } : {}) })}</details></li>`).join('')}</ol></section>`;
}

export function report(experiment: Experiment, engineVersion: string) {
  const evaluation = experiment.evaluation;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escapeHtml(experiment.title)} · CounterLab</title><style>
body{font:16px/1.7 system-ui,sans-serif;max-width:1080px;margin:40px auto;padding:0 24px;color:#252522;background:#faf8f2;overflow-wrap:anywhere}h1{font-size:32px;line-height:1.3}h2{margin-top:38px;font-size:22px}h3{font-size:17px}small,.note{color:#55564f}pre{padding:18px;background:#efeee7;white-space:pre-wrap;overflow-wrap:anywhere;border-radius:12px;font-size:13px}.verdict{border-left:4px solid #b64a35;padding:12px 20px;background:#f3e9e0}.result-label{font-weight:700}.metrics{display:flex;flex-wrap:wrap;gap:12px;margin:12px 0}.metrics div{min-width:140px;flex:1;padding:12px 16px;background:#fffdf7;border:1px solid #d9d6cc;border-radius:10px}.metrics dt{font-size:13px;color:#57584f}.metrics dd{margin:4px 0 0;font-size:20px;font-weight:650;overflow-wrap:anywhere}.trace li{margin-bottom:10px}.trace small{display:block}.table-wrap{overflow-x:auto;border:1px solid #d2d0c5;border-radius:10px}table{border-collapse:collapse;width:100%;min-width:650px;text-align:left;font-size:14px}th,td{padding:12px 14px;border-bottom:1px solid #dedbd1;vertical-align:top}th{background:#efeee7}tr:last-child td{border-bottom:0}details{margin:14px 0}summary{cursor:pointer;font-weight:600}.versions{padding-left:24px}.versions>li{padding:4px 0 24px;border-bottom:1px solid #dedbd1}footer{margin-top:40px;border-top:1px solid #ccc;padding-top:20px}@media(max-width:600px){body{padding:0 16px;margin:24px auto}h1{font-size:25px}.metrics div{min-width:110px}.metrics dd{font-size:17px}}@media print{body{background:white;max-width:none;margin:0}.table-wrap{overflow:visible}table{min-width:0}.metrics div{break-inside:avoid}h2,h3{break-after:avoid}details{break-inside:avoid}}
</style></head><body><header><small>COUNTERLAB / 可重放算法实验</small><h1>${escapeHtml(experiment.title)}</h1><p>${escapeHtml(experiment.domain)} · 执行器 ${escapeHtml(engineVersion)} · 更新 ${escapeHtml(experiment.updatedAt)}</p></header><main><section class="verdict" aria-label="当前实验结论">${evaluation ? summary(evaluation) + `<p>${evaluation.details.map(escapeHtml).join('<br>')}</p>` : '<p class="result-label">尚未计算</p>'}<p>结论仅适用于本报告输入。有限样本通过不构成普遍正确性证明；不可达时的数值哨兵不表示存在零成本路径。</p></section><section id="input"><h2>策略契约</h2>${json(experiment.strategy)}<h2>实验输入</h2>${json(experiment.instance)}</section>${evaluation ? trace(evaluation, 'candidate') + trace(evaluation, 'reference') : ''}${searchAudit(experiment)}${shrinkAudit(experiment)}${regressionAudit(experiment)}${versions(experiment)}</main><footer>本报告由本地程序生成。执行结论在保存/导入时重新计算；历史运行统计与采样过程没有在报告生成时重跑。完整输入、轨迹与重放请使用 JSON 实验包。</footer></body></html>`;
}
