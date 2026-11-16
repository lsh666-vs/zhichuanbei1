import { describe, it, expect } from 'vitest';
import { Vector3, Quaternion } from 'three';
import { quaternion, surfaceVertices, projectedUpdate, finalBias, optimizerIndex } from '../src/core';
import { nearestFaceVertex, surfaceIdentity } from '../src/surfaceData';
describe('scientific rendering bridge', () => {
  it('keeps matrix/vector/scalar optimizer coordinates within actual recorded shapes', () => {
    expect(
      optimizerIndex(
        [
          [1, 2],
          [3, 4],
        ],
        999,
        -1,
      ),
    ).toEqual([1, 0]);
    expect(optimizerIndex([1, 2], 999, 7)).toEqual([1]);
    expect(optimizerIndex(0.2, 7, 7)).toEqual([]);
    expect(optimizerIndex([[1, 2]], NaN, Infinity)).toEqual([0, 0]);
  });
  it('chooses every corner of the actually hit triangle, including its third vertex', () => {
    const vertices = [
      { index: 10, position: [0, 0, 0] },
      { index: 25, position: [1, 0, 0] },
      { index: 11, position: [0, 1, 1] },
    ];
    expect(nearestFaceVertex([0.05, 0.05, 0.05], vertices)).toBe(10);
    expect(nearestFaceVertex([0.9, 0.05, 0.05], vertices)).toBe(25);
    expect(nearestFaceVertex([0.05, 0.9, 0.9], vertices)).toBe(11);
    expect(surfaceIdentity.q2.color).toBe('#687dcb');
    expect(new Set(Object.values(surfaceIdentity).map((v) => v.color)).size).toBe(4);
  });
  it('converts engine wxyz to a right-handed quarter turn', () => {
    const q = quaternion([Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
    const v = new Vector3(1, 0, 0).applyQuaternion(new Quaternion(...q));
    expect(v.x).toBeCloseTo(0, 14);
    expect(v.y).toBeCloseTo(1, 14);
    expect(v.z).toBe(0);
  });
  it('preserves asymmetric i,j indexing and actual heights', () => {
    expect(
      surfaceVertices(
        [2, 7],
        [-4, 1, 3],
        [
          [10, 11, 12],
          [20, 21, 22],
        ],
      ),
    ).toEqual([2, -4, 10, 2, 1, 11, 2, 3, 12, 7, -4, 20, 7, 1, 21, 7, 3, 22]);
  });
  it('reports full off-plane Adam residual instead of inventing planar motion', () => {
    const p = projectedUpdate(
      { parameters: { 'biases.1': { delta: [3, 4, 12] } } },
      ['actor/biases.1', 'actor/biases.1'],
      [[0], [1]],
    );
    expect(p.delta).toEqual([3, 4]);
    expect(p.residual).toBe(12);
    expect(p.norm).toBe(13);
  });
  it('derives output parameter for all permitted network depths', () => {
    for (let depth = 1; depth <= 3; depth++)
      expect(finalBias({ actor: { sizes: [15, ...Array(depth).fill(8), 6] } })).toBe('actor/biases.' + depth);
  });
});
