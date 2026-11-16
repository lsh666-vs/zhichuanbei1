import { describe, expect, it } from 'vitest';
import { layerData, networkCounts, nodePosition } from '../src/networkData';

describe('network topology and parameter provenance', () => {
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
