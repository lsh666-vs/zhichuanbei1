import { describe, expect, it } from 'vitest';
import { layerData, networkCounts, nodePosition, parameterHandoff } from '../src/networkData';

describe('network topology and parameter provenance', () => {
  it('binds shortcuts to a complete parent value while retaining the different historical source', () => {
    const source = {
      traceId: 'trace',
      eventId: 'u1/e17',
      eventLabel: 'q1_actor_path/layer0',
      sample: 2,
      recordedValue: 0,
      originCheckpoint: 'origin',
      outputCheckpoint: 'output',
    };
    const parameters = { q1: { 'biases.0': [-0.0003], 'weights.0': [[0.4]] } };
    const edit = parameterHandoff('experiment', 'output', parameters, 'q1/biases.0', [0], source)!;
    expect(edit.value).toBe(-0.0003);
    expect(edit.checkpoint).toBe('output');
    expect(edit.source).toEqual(source);
    expect(parameterHandoff('experiment', 'output', parameters, 'q1/weights.0', [0, 0], source)?.value).toBe(
      0.4,
    );
    expect(parameterHandoff('experiment', 'output', undefined, 'q1/biases.0', [0], source)).toBeUndefined();
    expect(parameterHandoff('experiment', 'output', parameters, 'q1/biases.0', [1], source)).toBeUndefined();
  });
  it('retains every node and every dense connection in the actual reference architecture', () => {
    expect(networkCounts({ sizes: [15, 64, 64, 6] })).toEqual({
      neurons: 149,
      weights: 5440,
      biases: 134,
    });
    const positions = Array.from({ length: 64 }, (_, n) => nodePosition(1, n, 64, 4).join(','));
    expect(new Set(positions).size).toBe(64);
  });

  it('uses the post-critic actor-path W and b together instead of mixing checkpoint parameters', () => {
    const recorded = {
      kind: 'layer',
      label: 'q1_actor_path/layer0',
      id: 'u1/e17',
      weight: [[2, -3]],
      bias: [4],
      input: [[5, 6]],
      output: [[-4]],
    };
    const parameters = { q1: { 'weights.0': [[100, 200]], 'biases.0': [300] } };
    const data = layerData('q1', 0, [recorded], parameters, 'q1_actor_path');
    expect(data.weight).toBe(recorded.weight);
    expect(data.bias).toBe(recorded.bias);
    expect(data.event).toBe(recorded);
    expect(data.source).toContain('q1_actor_path/layer0');
  });

  it('does not invent activations or gradients for an unloaded Trace layer', () => {
    const metadata = { kind: 'layer', label: 'actor/layer0', id: 'u1/e0' };
    const parameters = { actor: { 'weights.0': [[0.25, -0.5]], 'biases.0': [0.125] } };
    const data = layerData('actor', 0, [metadata], parameters, 'actor');
    expect(data.event).toBeUndefined();
    expect(data.weight).toEqual([[0.25, -0.5]]);
    expect(data.bias).toEqual([0.125]);
    expect(data.source).toBe('检查点参数');
  });
});
