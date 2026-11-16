import React, { useEffect, useMemo, useState } from 'react';
import katex from 'katex';
import { at, Doc, fmt, numeric, shape, useLab, optimizerIndex, boundedIndex } from './core';
export function Formula({ tex }: { tex: string }) {
  const html = useMemo(
    () => katex.renderToString(tex, { throwOnError: false, strict: 'ignore', trust: false }),
    [tex],
  );
  return (
    <div
      className="formula"
      dangerouslySetInnerHTML={{
        __html: html,
      }}
    />
  );
}
function Tensor({ value, path }: { value: any; path: string }) {
  const [page, setPage] = useState(0),
    [open, setOpen] = useState(false);
  const dims = shape(value);
  const flat = open ? (Array.isArray(value) ? value.flat(Infinity) : [value]) : [],
    start = page * 64;
  return (
    <div className="tensor">
      <button className="tensor-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>
          {open ? '−' : '+'} {path}
        </span>
        <code>{dims.length ? '[' + dims.join(' × ') + ']' : typeof value}</code>
      </button>
      {open && (
        <>
          <div className="tensor-page">
            <button disabled={!page} onClick={() => setPage(page - 1)}>
              上一页
            </button>
            <small>
              {start}–{Math.min(start + 64, flat.length) - 1} / {flat.length}
            </small>
            <button disabled={start + 64 >= flat.length} onClick={() => setPage(page + 1)}>
              下一页
            </button>
            <button onClick={() => navigator.clipboard.writeText(JSON.stringify(value))}>复制完整原值</button>
          </div>
          <div className="tensor-values">
            {flat.slice(start, start + 64).map((n, i) => (
              <span key={i} title={JSON.stringify(n)}>
                <sup>{start + i}</sup>
                {fmt(n)}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
export function RawTree({ value, path = 'event' }: { value: any; path?: string }) {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return <Tensor key={path} value={value} path={path} />;
  return (
    <>
      {Object.entries(value).map(([k, v]) =>
        v !== null && typeof v === 'object' && !Array.isArray(v) ? (
          <details key={k}>
            <summary>{k}</summary>
            <RawTree value={v} path={path + '.' + k} />
          </details>
        ) : (
          <Tensor key={k} path={k} value={v} />
        ),
      )}
    </>
  );
}
function OptimizerDetails({
  event,
  traceId,
  checkpoint,
}: {
  event: Doc;
  traceId: string;
  checkpoint: string;
}) {
  const s = useLab((x) => x.selection),
    select = useLab((x) => x.select);
  const [parameter, setParameter] = useState(''),
    [coordinateNote, setCoordinateNote] = useState('');
  const names = Object.keys(event.parameters ?? {}),
    pk = names.includes(parameter) ? parameter : names[0];
  const p = event.parameters?.[pk],
    dims = shape(p?.before);
  const ix = optimizerIndex(p?.before, s.neuron, s.input);
  const row = ix[0] ?? 0,
    column = ix[1] ?? 0;
  useEffect(() => {
    const layer = Number(pk?.match(/\.(\d+)$/)?.[1] ?? s.layer);
    const model = ['actor', 'value', 'q1', 'q2', 'target_q1', 'target_q2'].includes(event.label)
      ? event.label
      : s.model;
    if (s.neuron !== row || s.input !== column || s.layer !== layer || s.model !== model) {
      if (s.neuron !== row || s.input !== column)
        setCoordinateNote(`原坐标已按真实 shape [${dims.join(',')}] 规范为 [${ix.join(',')}]。`);
      select({ neuron: row, input: column, model, layer });
    }
  }, [event.id, traceId, pk, row, column, s.neuron, s.input, s.layer, s.model]);
  const val = (key: string) => at(p?.[key], ix);
  const coordinate = (axis: number, value: number) => {
    const bounded = boundedIndex(value, dims[axis]);
    setCoordinateNote(value === bounded ? '' : `坐标已限制在 0…${dims[axis] - 1}。`);
    select(axis === 0 ? { neuron: bounded } : { input: bounded });
  };
  return (
    <section className="optimizer-inspection" aria-label="优化器参数检查" data-testid="optimizer-inspection">
      <label>
        记录参数
        <select
          aria-label="优化器参数"
          value={pk ?? ''}
          onChange={(e) => {
            setParameter(e.target.value);
            setCoordinateNote('');
          }}
        >
          {names.map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
      </label>
      {dims.length > 0 ? (
        <div className="optimizer-coordinates">
          <label>
            {dims.length === 2 ? '矩阵行 j' : '向量索引'}
            <input
              aria-label={dims.length === 2 ? '优化器矩阵行' : '优化器向量索引'}
              type="number"
              min={0}
              max={dims[0] - 1}
              value={row}
              onChange={(e) => coordinate(0, +e.target.value)}
            />
          </label>
          {dims.length === 2 && (
            <label>
              矩阵列 i
              <input
                aria-label="优化器矩阵列"
                type="number"
                min={0}
                max={dims[1] - 1}
                value={column}
                onChange={(e) => coordinate(1, +e.target.value)}
              />
            </label>
          )}
          <small>真实 shape [{dims.join(' × ')}]</small>
        </div>
      ) : (
        <p className="optimizer-scalar">标量，无索引</p>
      )}
      {coordinateNote && <small role="status">{coordinateNote}</small>}
      <b className="optimizer-path" data-testid="optimizer-path">
        {event.label}/{pk}
        {dims.length ? `[${ix.join(',')}]` : ' · 标量'}
      </b>
      <div className="optimizer-step" aria-label="记录的参数更新">
        {(
          [
            ['before', '更新前'],
            ['delta', '记录 Δ'],
            ['after', '更新后'],
          ] as const
        ).map(([key, label]) => (
          <div key={key}>
            <small>{label}</small>
            <b data-testid={'optimizer-' + key} title={String(val(key))}>
              {fmt(val(key))}
            </b>
          </div>
        ))}
      </div>
      <dl className="optimizer-gradients">
        <dt>原始批梯度 · 裁剪前</dt>
        <dd data-testid="optimizer-raw_gradient" title={String(val('raw_gradient'))}>
          {fmt(val('raw_gradient'))}
        </dd>
        <dt>实际梯度 · 裁剪后 / 送入 Adam</dt>
        <dd data-testid="optimizer-gradient" title={String(val('gradient'))}>
          {fmt(val('gradient'))}
        </dd>
      </dl>
      <small>
        全局范数 {fmt(event.gradient_norm)} · clip factor {fmt(event.clip_factor)}
      </small>
      <p className="optimizer-source" data-testid="optimizer-source">
        同一事件 {event.id} · Trace {traceId}
        <br />
        origin 检查点 {checkpoint}
        <br />
        样本行 {s.sample}（更新是批次级记录）；这里只浏览坐标，不修改参数。
      </p>
      <details className="optimizer-advanced">
        <summary>Adam 历史与高级记录</summary>
        <Formula tex={String.raw`m_t=\beta_1m_{t-1}+(1-\beta_1)g_t`} />
        <Formula tex={String.raw`\Delta\theta=-\eta\hat m_t/(\sqrt{\hat v_t}+\epsilon)`} />
        <dl>
          {[
            'moment_before',
            'variance_before',
            'moment',
            'variance',
            'corrected_moment',
            'corrected_variance',
          ].map((key) => (
            <React.Fragment key={key}>
              <dt>{key}</dt>
              <dd title={String(val(key))}>{fmt(val(key))}</dd>
            </React.Fragment>
          ))}
        </dl>
        <small>
          step {event.step} · lr {event.lr} · β₁ {event.beta1} · β₂ {event.beta2} · ε {event.epsilon}
          。数值均为该事件保存记录，没有重新计算 Adam。
        </small>
      </details>
    </section>
  );
}

export default function Inspector({
  event,
  traceId,
  checkpoint,
  backward,
  onBackward,
  forwardOnly,
}: {
  event?: Doc;
  traceId: string;
  checkpoint: string;
  backward: boolean;
  onBackward: () => void;
  forwardOnly: boolean;
}) {
  const s = useLab((x) => x.selection),
    select = useLab((x) => x.select);
  if (!event)
    return (
      <aside className="inspector" tabIndex={-1} aria-label="深层张量检查">
        <h3>对象检查器</h3>
        <p className="muted">选择一个事件，检查它的真实数值。</p>
      </aside>
    );
  const layer = event.kind === 'layer';
  const row = event.output?.[s.sample],
    n = Math.min(s.neuron, (row?.length ?? 1) - 1),
    j = Math.min(s.input, (event.input?.[s.sample]?.length ?? 1) - 1);
  const point = (key: string) => event[key]?.[s.sample]?.[n];
  const raw = backward
    ? event
    : Object.fromEntries(Object.entries(event).filter(([k]) => !k.includes('gradient')));
  return (
    <aside className="inspector" tabIndex={-1} aria-label="深层张量检查">
      <div className="eyebrow">DEEP INSPECTOR</div>
      <h3>{event.label}</h3>
      <div className="tags">
        <span>{event.kind}</span>
        <code>{event.id}</code>
      </div>
      {event.kind !== 'optimizer' && (
        <>
          <p className="source">
            来源 {traceId || '实时 forward-only'}
            <br />
            参数版本 {checkpoint?.slice(0, 12) || '当前完整检查点'}
            <br />
            样本行 {s.sample} · 单元 {n}
          </p>
          {!forwardOnly && (
            <label className="check">
              <input type="checkbox" checked={backward} onChange={onBackward} />
              回看该次更新已完成的反传结果
            </label>
          )}
          <p className="muted small">
            {forwardOnly
              ? '此处只运行了前向；null 梯度表示未执行反传。'
              : backward
                ? '梯度在实际 backward 后记录，使用最小化损失约定。'
                : '当前只展示前向数值。局部导数与总梯度是不同对象。'}
          </p>
        </>
      )}
      {layer && (
        <>
          <Formula tex="z_j=\sum_i W_{ji}x_i+b_j,\quad h_j=f(z_j)" />
          <div className="field-row">
            <label>
              单元 j
              <input
                aria-label="检查单元"
                type="number"
                min="0"
                max={(row?.length ?? 1) - 1}
                value={n}
                onChange={(e) => select({ neuron: +e.target.value })}
              />
            </label>
            <label>
              输入 i
              <input
                aria-label="检查输入"
                type="number"
                min="0"
                max={(event.input?.[s.sample]?.length ?? 1) - 1}
                value={j}
                onChange={(e) => select({ input: +e.target.value })}
              />
            </label>
          </div>
          <dl>
            <dt>W[j,i]</dt>
            <dd>{fmt(event.weight?.[n]?.[j])}</dd>
            <dt>x[i]</dt>
            <dd>{fmt(event.input?.[s.sample]?.[j])}</dd>
            <dt>W × x</dt>
            <dd>{fmt(event.weight?.[n]?.[j] * event.input?.[s.sample]?.[j])}</dd>
            <dt>b[j]</dt>
            <dd>{fmt(event.bias?.[n])}</dd>
            <dt>z[j]</dt>
            <dd>{fmt(point('preactivation'))}</dd>
            <dt>h[j] · {event.activation}</dt>
            <dd>{fmt(point('output'))}</dd>
            <dt>局部 dh/dz</dt>
            <dd>{fmt(point('local_derivative'))}</dd>
            {backward && (
              <>
                <dt>总 dL/dh</dt>
                <dd>{fmt(point('output_gradient'))}</dd>
                <dt>总 dL/dz</dt>
                <dd>{fmt(point('preactivation_gradient'))}</dd>
                <dt>路径 dL/dz × x[i]</dt>
                <dd>{fmt(point('preactivation_gradient') * event.input?.[s.sample]?.[j])}</dd>
              </>
            )}
          </dl>
          <div className="callout">
            本层当前样本的 mean |h| ={' '}
            {fmt(numeric(row).reduce((a, b) => a + Math.abs(b), 0) / (row?.length || 1))}；|h| &lt; 10⁻³
            的比例 = {fmt(numeric(row).filter((v) => Math.abs(v) < 0.001).length / (row?.length || 1))}
            。单次低激活不能单独证明神经元休眠。
          </div>
        </>
      )}
      {event.kind === 'objective' && (
        <>
          <Formula
            tex={
              event.label === 'ppo_clip'
                ? '-\mathrm{mean}\,[\min(rA,\mathrm{clip}(r,1-\epsilon,1+\epsilon)A)]'
                : event.label === 'actor'
                  ? '\mathrm{mean}\,[\alpha\log\pi(a|s)-\min(Q_1,Q_2)]'
                  : '\tfrac12\mathrm{mean}\,[(Q-y)^2]'
            }
          />
          <p className="small">
            {event.label === 'ppo_clip'
              ? `样本 ${s.sample}: r=${fmt(event.ratio?.[s.sample])}, A=${fmt(event.advantage?.[s.sample])}, 平坦策略分支=${event.flat_policy_branch?.[s.sample] ? '是' : '否'}；这不意味着整批梯度或 Adam 更新为零。`
              : 'Critic 更新的目标停止梯度；Actor 阶段保持经过动作的导数，Critic 参数不更新。具体阶段和版本见原值。'}
          </p>
        </>
      )}
      {event.kind === 'optimizer' && (
        <OptimizerDetails event={event} traceId={traceId} checkpoint={checkpoint} />
      )}
      {event.kind === 'sample_gradients' && (
        <div className="callout">
          贡献已除以 batch size。把全部样本贡献求和后与 raw_gradient 对照；不再求平均，也不能把单样本 Adam
          更新相加。
          <RawTree
            value={Object.fromEntries(
              Object.entries(event.contributions).map(([k, v]: any) => [
                k,
                { selected_sample: v[s.sample], sum: numeric(v).length ? sumRows(v) : null },
              ]),
            )}
          />
        </div>
      )}
      <details className="raw">
        <summary>原始字段 · 分页完整张量</summary>
        <RawTree value={raw} />
      </details>
    </aside>
  );
}
function sumRows(rows: any[]) {
  if (!rows.length) return null;
  if (typeof rows[0] === 'number') return rows.reduce((a, b) => a + b, 0);
  return rows[0].map((_: any, i: number) => sumRows(rows.map((r) => r[i])));
}
