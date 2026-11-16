export const surfaceIdentity: Record<string, { label: string; color: string }> = {
  q1: { label: 'Q₁', color: '#2eaaa0' },
  q2: { label: 'Q₂', color: '#687dcb' },
  minimum: { label: 'min(Q₁,Q₂)', color: '#c28b35' },
  loss: { label: 'loss', color: '#b76891' },
};

// Distances are in the mesh's displayed local coordinates. Only choose among
// actual vertices of the hit face; no interpolation or scientific evaluation.
export function nearestFaceVertex(point: number[], vertices: { index: number; position: number[] }[]) {
  let best = vertices[0],
    distance = Infinity;
  for (const vertex of vertices) {
    const d = vertex.position.reduce((sum, value, i) => sum + (value - point[i]) ** 2, 0);
    if (d < distance) {
      best = vertex;
      distance = d;
    }
  }
  return best.index;
}
