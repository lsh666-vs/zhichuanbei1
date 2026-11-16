import { Doc } from './core';

export interface ParameterHandoff {
  experiment: string;
  checkpoint: string;
  path: string;
  index: number[];
  value: number;
  source: {
    traceId: string;
    eventId?: string;
    eventLabel?: string;
    phase?: string;
    originCheckpoint?: string;
    outputCheckpoint?: string;
    sample: number;
    recordedValue?: number;
  };
}

// Editing always starts from one complete, owned checkpoint. A layer event
// (especially SAC's post-critic path) is never a substitute for that state.
export function parameterHandoff(
  experiment: string,
  checkpoint: string,
  parameters: Doc | undefined,
  path: string,
  index: number[],
  source: ParameterHandoff['source'],
): ParameterHandoff | undefined {
  const [model, parameter] = path.split('/');
  const value = index.reduce((v, i) => v?.[i], parameters?.[model]?.[parameter]);
  if (!Number.isFinite(value)) return;
  return { experiment, checkpoint, path, index: [...index], value, source: { ...source } };
}

export const modelTitle = (name: string) =>
  ({
    actor: 'Actor · 策略网络',
    value: 'Value · 状态价值',
    q1: 'Critic · Q₁',
    q2: 'Critic · Q₂',
    target_q1: 'Target · Q₁',
    target_q2: 'Target · Q₂',
  })[name] ?? name;

export function nodePosition(layer: number, index: number, size: number, layers: number, base = 0) {
  const rows = Math.min(size, 16);
  const columns = Math.ceil(size / rows);
  return [
    (layer - (layers - 1) / 2) * 3.25 + (Math.floor(index / rows) - (columns - 1) / 2) * 0.22,
    Math.floor(index / rows) * 0.035,
    ((rows - 1) / 2 - (index % rows)) * (size <= 8 ? 0.5 : 0.29) + base,
  ] as [number, number, number];
}

export function networkCounts(spec: Doc) {
  return {
    neurons: spec.sizes.reduce((a: number, n: number) => a + n, 0),
    weights: spec.sizes.slice(1).reduce((a: number, n: number, l: number) => a + n * spec.sizes[l], 0),
    biases: spec.sizes.slice(1).reduce((a: number, n: number) => a + n, 0),
  };
}

export function networkBounds(points: number[][], margin = 0.8) {
  const lo = [0, 1, 2].map((axis) => Math.min(...points.map((p) => p[axis])) - margin);
  const hi = [0, 1, 2].map((axis) => Math.max(...points.map((p) => p[axis])) + margin);
  return { center: lo.map((v, i) => (v + hi[i]) / 2), width: hi[0] - lo[0], height: hi[2] - lo[2] };
}

export function modelOffset(index: number, count: number) {
  if (count === 1) return { x: 0, z: 0 };
  const rows = Math.ceil(count / 2),
    lastSingle = count % 2 === 1 && index === count - 1;
  return {
    x: lastSingle ? 0 : ((index % 2) - 0.5) * 13.5,
    z: ((rows - 1) / 2 - Math.floor(index / 2)) * 7.2,
  };
}

export function layerData(
  name: string,
  layer: number,
  events: Doc[],
  parameters: Doc | undefined,
  selectedModel: string,
) {
  const prefix = selectedModel === name + '_actor_path' ? selectedModel : name;
  const eventIndex = events.findIndex(
    (event) => event.kind === 'layer' && event.label === prefix + '/layer' + layer,
  );
  const event = events[eventIndex];
  // A Trace carries the exact stage-specific parameters (including post-critic
  // actor paths). Never combine its activations with another checkpoint's W/b.
  const recorded = Array.isArray(event?.weight);
  return {
    event: recorded ? event : undefined,
    eventIndex,
    weight: recorded ? event.weight : parameters?.[name]?.['weights.' + layer],
    bias: recorded ? event.bias : parameters?.[name]?.['biases.' + layer],
    source: recorded ? event.label + ' · ' + event.id : '检查点参数',
  };
}
