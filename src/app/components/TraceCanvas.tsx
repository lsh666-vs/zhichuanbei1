import { useId, useRef, type KeyboardEvent } from 'react';
import { Crosshair, CircleDot, ScanLine } from 'lucide-react';
import type { Evaluation, Execution, GraphInstance, Instance, TraceStep } from '../../shared/types';

const stage = (execution: Execution | undefined, step: number) =>
  execution?.steps[Math.min(step, execution.steps.length - 1)];
function selectedAt(execution: Execution | undefined, step: number) {
  return stage(execution, step)?.selectedIds ?? [];
}
function activateObject(event: KeyboardEvent, id: string, setHovered: (id: string | null) => void) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    setHovered(id);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    setHovered(null);
  }
}

function IntervalTrack({
  instance,
  execution,
  step,
  tone,
  hovered,
  setHovered,
}: {
  instance: Extract<Instance, { domain: 'interval' }>;
  execution?: Execution;
  step: number;
  tone: string;
  hovered: string | null;
  setHovered: (id: string | null) => void;
}) {
  const min = Math.min(0, ...instance.items.map((i) => i.start));
  const max = Math.max(1, ...instance.items.map((i) => i.end));
  const x = (time: number) => 65 + ((time - min) / (max - min)) * 535;
  const selected = selectedAt(execution, step);
  const current = stage(execution, step);
  const height = Math.max(164, 58 + instance.items.length * 35);
  return (
    <svg
      className={`interval-svg ${tone}`}
      viewBox={`0 0 650 ${height}`}
      role="group"
      aria-label={`${tone === 'candidate' ? '候选' : '参照'}区间执行轨迹`}
    >
      {Array.from({ length: 9 }, (_, index) => {
        const value = min + ((max - min) * index) / 8;
        return (
          <g key={index}>
            <line className="grid-line" x1={x(value)} x2={x(value)} y1={26} y2={height - 14} />
            <text className="axis-text" x={x(value)} y={15} textAnchor="middle">
              {Number.isInteger(value) ? value : Number(value.toFixed(1))}
            </text>
          </g>
        );
      })}
      {instance.items.map((item, index) => {
        const isSelected = selected.includes(item.id);
        const active = current?.activeIds.includes(item.id);
        const rejected = current?.rejectedIds?.includes(item.id);
        const y = 38 + index * 35;
        return (
          <g
            tabIndex={0}
            role="button"
            aria-label={`${item.label}，时间 ${item.start} 到 ${item.end}，收益 ${item.value}${isSelected ? '，已选择' : ''}`}
            key={item.id}
            onClick={() => setHovered(item.id)}
            onKeyDown={(event) => activateObject(event, item.id, setHovered)}
            onMouseEnter={() => setHovered(item.id)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(item.id)}
            onBlur={() => setHovered(null)}
            className={`interval-object ${isSelected ? 'selected' : ''} ${active ? 'active' : ''} ${rejected ? 'rejected' : ''} ${hovered === item.id ? 'hovered' : ''}`}
          >
            <text className="object-axis" x={25} y={y + 17}>
              {item.id}
            </text>
            <rect
              x={x(item.start)}
              y={y}
              width={Math.max(4, x(item.end) - x(item.start))}
              height={25}
              rx={4}
            />
            <text className="bar-text" x={x(item.start) + 10} y={y + 17}>
              {x(item.end) - x(item.start) > 72 ? `${item.id} · ${item.value}` : item.id}
            </text>
            {isSelected && x(item.end) - x(item.start) > 45 && (
              <text className="bar-check" x={x(item.end) - 12} y={y + 17} textAnchor="middle">
                ✓
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function KnapsackTrack({
  instance,
  execution,
  step,
  tone,
  hovered,
  setHovered,
}: {
  instance: Extract<Instance, { domain: 'knapsack' }>;
  execution?: Execution;
  step: number;
  tone: string;
  hovered: string | null;
  setHovered: (id: string | null) => void;
}) {
  const selected = selectedAt(execution, step);
  const active = stage(execution, step)?.activeIds ?? [];
  const weight = instance.items
    .filter((i) => selected.includes(i.id))
    .reduce((total, item) => total + item.weight, 0);
  return (
    <div className={`knapsack-plot ${tone}`}>
      <div className="capacity-label">
        <span>
          已用容量 <b>{weight}</b> / {instance.capacity}
        </span>
        <span>{Math.round((weight / Math.max(1, instance.capacity)) * 100)}%</span>
      </div>
      <div className="capacity-track">
        {instance.items
          .filter((i) => selected.includes(i.id))
          .map((item) => (
            <span
              key={item.id}
              style={{ width: `${(item.weight / Math.max(1, instance.capacity)) * 100}%` }}
              title={`${item.id}：重量 ${item.weight}`}
            >
              {item.id}
            </span>
          ))}
      </div>
      <div className="item-grid">
        {instance.items.map((item) => (
          <button
            key={item.id}
            className={`knapsack-item ${selected.includes(item.id) ? 'selected' : ''} ${active.includes(item.id) ? 'active' : ''} ${hovered === item.id ? 'hovered' : ''}`}
            onMouseEnter={() => setHovered(item.id)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(item.id)}
            onBlur={() => setHovered(null)}
          >
            <span className="item-corner">{item.id}</span>
            <strong>
              {item.value}
              <small>收益</small>
            </strong>
            <span className="item-weight">重量 {item.weight}</span>
            {selected.includes(item.id) && <span className="item-selected">✓</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

export interface GraphProjection {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}
const finite = (value: number) => (Number.isFinite(value) ? value : 0);
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export function graphProjection(instance: GraphInstance): GraphProjection {
  const xs = instance.nodes.map((node) => finite(node.x)),
    ys = instance.nodes.map((node) => finite(node.y));
  let minX = Math.min(...xs, xs.length ? Infinity : 0),
    maxX = Math.max(...xs, xs.length ? -Infinity : 0);
  let minY = Math.min(...ys, ys.length ? Infinity : 0),
    maxY = Math.max(...ys, ys.length ? -Infinity : 0);
  if (minX === maxX) {
    minX -= 0.5;
    maxX += 0.5;
  }
  if (minY === maxY) {
    minY -= 0.5;
    maxY += 0.5;
  }
  return { minX, maxX, minY, maxY };
}
export function projectGraphPoint(point: { x: number; y: number }, projection: GraphProjection) {
  return {
    x: 60 + ((finite(point.x) - projection.minX) / (projection.maxX - projection.minX)) * 520,
    y: 35 + ((finite(point.y) - projection.minY) / (projection.maxY - projection.minY)) * 110,
  };
}
export function unprojectGraphPoint(point: { x: number; y: number }, projection: GraphProjection) {
  return {
    x: clamp(
      projection.minX + ((clamp(point.x, 60, 580) - 60) / 520) * (projection.maxX - projection.minX),
      -10000,
      10000,
    ),
    y: clamp(
      projection.minY + ((clamp(point.y, 35, 145) - 35) / 110) * (projection.maxY - projection.minY),
      -10000,
      10000,
    ),
  };
}

export function GraphPlot({
  instance,
  execution,
  step = 0,
  tone = 'candidate',
  onChange,
  hovered = null,
  setHovered = () => {},
}: {
  instance: GraphInstance;
  execution?: Execution;
  step?: number;
  tone?: string;
  onChange?: (instance: GraphInstance) => void;
  hovered?: string | null;
  setHovered?: (id: string | null) => void;
}) {
  const svg = useRef<SVGSVGElement>(null),
    markerId = `graph-arrow-${useId().replace(/[^\w-]/g, '')}`;
  const drag = useRef<{
    id: string;
    pointerId: number;
    projection: GraphProjection;
    latest: GraphInstance;
    target: SVGGElement;
  } | null>(null);
  // Keep the view used by a drag even after release. External edits fit a new view.
  const pinned = useRef<{ instance: GraphInstance; projection: GraphProjection } | null>(null);
  const projection =
    drag.current?.projection ??
    (pinned.current?.instance === instance ? pinned.current.projection : graphProjection(instance));
  const positions = Object.fromEntries(
    instance.nodes.map((node) => [node.id, projectGraphPoint(node, projection)]),
  );
  const current = stage(execution, step),
    selected = current?.selectedIds ?? [],
    active = current?.activeIds ?? [];
  const finishDrag = () => {
    const currentDrag = drag.current;
    if (!currentDrag) return;
    pinned.current = { instance: currentDrag.latest, projection: currentDrag.projection };
    drag.current = null;
    if (currentDrag.target.hasPointerCapture(currentDrag.pointerId))
      currentDrag.target.releasePointerCapture(currentDrag.pointerId);
  };
  return (
    <svg
      ref={svg}
      className={`graph-svg ${tone}`}
      viewBox="0 0 650 195"
      role="group"
      aria-label="路由网络与当前执行状态"
      style={onChange ? { touchAction: 'none' } : undefined}
      onPointerMove={(event) => {
        const currentDrag = drag.current,
          matrix = svg.current?.getScreenCTM();
        if (!currentDrag || event.pointerId !== currentDrag.pointerId || !onChange || !svg.current || !matrix)
          return;
        const point = svg.current.createSVGPoint();
        point.x = event.clientX;
        point.y = event.clientY;
        const local = point.matrixTransform(matrix.inverse()),
          nextPoint = unprojectGraphPoint(local, currentDrag.projection);
        const next = {
          ...currentDrag.latest,
          nodes: currentDrag.latest.nodes.map((node) =>
            node.id === currentDrag.id ? { ...node, ...nextPoint } : node,
          ),
        };
        currentDrag.latest = next;
        onChange(next);
      }}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onLostPointerCapture={finishDrag}
    >
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 10 10"
          refX="25"
          refY="5"
          markerWidth="5"
          markerHeight="5"
          orient="auto"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
        </marker>
      </defs>
      {instance.edges.map((edge) => {
        const from = positions[edge.from],
          to = positions[edge.to];
        if (!from || !to) return null;
        const id = `edge:${edge.id}`,
          picked = selected.includes(edge.id);
        return (
          <g
            key={edge.id}
            className={`graph-edge ${picked ? 'selected' : ''} ${active.includes(edge.id) ? 'active' : ''} ${hovered === id ? 'hovered' : ''}`}
            tabIndex={0}
            role="button"
            aria-label={`边 ${edge.id}，${edge.from} ${instance.directed ? '到' : '连接'} ${edge.to}，权重 ${edge.weight}`}
            onClick={() => setHovered(id)}
            onKeyDown={(event) => activateObject(event, id, setHovered)}
            onMouseEnter={() => setHovered(id)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(id)}
            onBlur={() => setHovered(null)}
          >
            <line
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              markerEnd={instance.directed ? `url(#${markerId})` : undefined}
            />
            <rect x={(from.x + to.x) / 2 - 11} y={(from.y + to.y) / 2 - 10} width="22" height="20" rx="6" />
            <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 + 4} textAnchor="middle">
              {edge.weight}
            </text>
          </g>
        );
      })}
      {instance.nodes.map((node) => {
        const position = positions[node.id],
          id = `node:${node.id}`,
          visited =
            selected.includes(node.id) ||
            current?.data?.node === node.id ||
            (execution?.pathNodeIds?.includes(node.id) && current?.kind === 'finish');
        return (
          <g
            key={node.id}
            className={`graph-node ${visited ? 'selected' : ''} ${active.includes(node.id) ? 'active' : ''} ${hovered === id ? 'hovered' : ''}`}
            tabIndex={0}
            role="button"
            aria-label={`节点 ${node.id}${node.id === instance.source ? '，起点' : node.id === instance.target ? '，终点' : ''}${onChange ? '，可拖动或使用方向键移动' : ''}`}
            onClick={() => setHovered(id)}
            onMouseEnter={() => setHovered(id)}
            onMouseLeave={() => {
              if (!drag.current) setHovered(null);
            }}
            onFocus={() => setHovered(id)}
            onBlur={() => setHovered(null)}
            onKeyDown={(event) => {
              activateObject(event, id, setHovered);
              const delta: readonly number[] | undefined = (
                { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<
                  string,
                  readonly number[]
                >
              )[event.key];
              if (!onChange || !delta) return;
              event.preventDefault();
              const multiplier = event.shiftKey ? 5 : 1;
              const next = {
                ...instance,
                nodes: instance.nodes.map((item) =>
                  item.id === node.id
                    ? {
                        ...item,
                        x: clamp(
                          item.x + ((delta[0] * (projection.maxX - projection.minX)) / 50) * multiplier,
                          Math.max(-10000, projection.minX),
                          Math.min(10000, projection.maxX),
                        ),
                        y: clamp(
                          item.y + ((delta[1] * (projection.maxY - projection.minY)) / 50) * multiplier,
                          Math.max(-10000, projection.minY),
                          Math.min(10000, projection.maxY),
                        ),
                      }
                    : item,
                ),
              };
              pinned.current = { instance: next, projection };
              onChange(next);
            }}
            onPointerDown={(event) => {
              setHovered(id);
              if (onChange && event.button === 0) {
                event.preventDefault();
                drag.current = {
                  id: node.id,
                  pointerId: event.pointerId,
                  projection,
                  latest: instance,
                  target: event.currentTarget,
                };
                event.currentTarget.setPointerCapture(event.pointerId);
              }
            }}
          >
            <circle cx={position.x} cy={position.y} r="20" />
            <text x={position.x} y={position.y + 5} textAnchor="middle">
              {node.id}
            </text>
            <text className="node-label" x={position.x} y={position.y + 37} textAnchor="middle">
              {node.id === instance.source
                ? '起点'
                : node.id === instance.target
                  ? '终点'
                  : node.label !== node.id
                    ? node.label
                    : ''}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function TraceCanvas({
  instance,
  evaluation,
  step,
  hovered,
  setHovered,
}: {
  instance: Instance;
  evaluation: Evaluation | null;
  step: number;
  hovered: string | null;
  setHovered: (id: string | null) => void;
}) {
  const referenceCaption = !evaluation
    ? '等待计算与独立核验'
    : !evaluation.witnessVerified
      ? '结果未通过独立核验'
      : !evaluation.reference.complete
        ? instance.domain === 'graph' && evaluation.verdict === 'pass'
          ? '独立核验：目标不可达'
          : '参照计算未完成'
        : '独立核验的最优结果';
  const tracks = [
    {
      key: 'candidate',
      label: '候选策略',
      caption: evaluation?.strategy.name || '等待执行',
      execution: evaluation?.candidate,
    },
    { key: 'reference', label: '精确参照', caption: referenceCaption, execution: evaluation?.reference },
  ];
  return (
    <div className="twin-canvas">
      <div className="canvas-heading">
        <div>
          <span className="eyebrow">SYNCHRONIZED EXECUTION</span>
          <h2>
            同一个问题，两条执行路径
            <span className="live-dot" />
          </h2>
        </div>
        <div className="canvas-legend">
          <span>
            <i className="legend-dot coral" />
            候选
          </span>
          <span>
            <i className="legend-dot blue" />
            参照
          </span>
          <span>
            <i className="legend-outline" />
            未选
          </span>
        </div>
      </div>
      {tracks.map((track, index) => {
        const current = stage(track.execution, step);
        return (
          <section key={track.key} className={`trace-track ${track.key}`}>
            <div className="track-header">
              <div className="track-heading">
                <span className="track-index">0{index + 1}</span>
                <div>
                  <h3>{track.label}</h3>
                  <span>{track.caption}</span>
                </div>
              </div>
              <div className="track-value">
                <span>
                  {instance.domain === 'graph'
                    ? '路径代价'
                    : instance.domain === 'interval' && instance.objective === 'count'
                      ? '已选任务'
                      : '累计收益'}
                </span>
                <strong>
                  {track.execution
                    ? !track.execution.complete && current?.kind === 'finish'
                      ? '—'
                      : (current?.currentValue ?? 0)
                    : '—'}
                </strong>
              </div>
            </div>
            <div className="track-plot">
              {instance.domain === 'interval' ? (
                <IntervalTrack
                  instance={instance}
                  execution={track.execution}
                  step={step}
                  tone={track.key}
                  hovered={hovered}
                  setHovered={setHovered}
                />
              ) : instance.domain === 'knapsack' ? (
                <KnapsackTrack
                  instance={instance}
                  execution={track.execution}
                  step={step}
                  tone={track.key}
                  hovered={hovered}
                  setHovered={setHovered}
                />
              ) : (
                <GraphPlot
                  instance={instance}
                  execution={track.execution}
                  step={step}
                  tone={track.key}
                  hovered={hovered}
                  setHovered={setHovered}
                />
              )}
            </div>
            <div className="track-event">
              <CircleDot size={13} />
              <span>
                {current?.message ||
                  (evaluation ? '此轨迹没有更多步骤。' : '调整左侧策略与场景，然后运行实验。')}
              </span>
              <code>{current ? `STEP ${String(current.index + 1).padStart(2, '0')}` : 'READY'}</code>
            </div>
          </section>
        );
      })}
      <div className="canvas-foot">
        <span>
          <Crosshair size={13} />
          {hovered
            ? `对象 ${instance.domain === 'graph' ? hovered.replace(/^node:/, '节点 ').replace(/^edge:/, '边 ') : hovered} · 双轨联动高亮`
            : '悬停或聚焦对象，比较两条轨迹中的同一选择'}
        </span>
        <span>
          <ScanLine size={13} />
          真实执行轨迹
        </span>
      </div>
    </div>
  );
}

export function EventList({ steps, step }: { steps: TraceStep[]; step: number }) {
  return (
    <div className="event-list">
      {steps.map((event, index) => (
        <div key={index} className={`event-row ${index === step ? 'current' : ''}`}>
          <span>{String(index + 1).padStart(2, '0')}</span>
          <p>{event.message}</p>
          <b>{event.currentValue}</b>
        </div>
      ))}
    </div>
  );
}
