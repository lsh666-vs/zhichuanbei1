import { Doc } from './core';

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
