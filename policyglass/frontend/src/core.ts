import { create } from 'zustand';
export type Doc = Record<string, any>;
export type View = 'arm' | 'network' | 'q' | 'loss';
export async function api(path: string, body?: unknown, options: RequestInit = {}): Promise<any> {
  const response = await fetch('/api' + path, {
    ...options,
    ...(body !== undefined
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  if (!response.ok) {
    let message;
    try {
      const d = await response.json();
      message = typeof d.detail === 'string' ? d.detail : JSON.stringify(d.detail);
    } catch {
      message = response.statusText;
    }
    throw Error(`${response.status} · ${message}`);
  }
  return response.json();
}
export const fmt = (n: any) =>
  n == null
    ? '未计算'
    : typeof n === 'number'
      ? n === 0
        ? '0'
        : Math.abs(n) < 0.001 || Math.abs(n) > 10000
          ? n.toExponential(4)
          : n.toFixed(5)
      : String(n);
export function shape(v: any): number[] {
  return Array.isArray(v) ? [v.length, ...shape(v[0])] : [];
}
export function at(v: any, index: number[]) {
  return index.reduce((a, i) => a?.[i], v);
}
export function numeric(v: any): number[] {
  return Array.isArray(v)
    ? v.flat(Infinity).filter((x) => typeof x === 'number')
    : typeof v === 'number'
      ? [v]
      : [];
}
export const quaternion = (q: number[]) => [q[1], q[2], q[3], q[0]] as [number, number, number, number];
export function finalBias(architecture: Doc) {
  return 'actor/biases.' + (architecture.actor.sizes.length - 2);
}
export function surfaceVertices(x: number[], y: number[], z: number[][]) {
  return x.flatMap((xx, i) => y.flatMap((yy, j) => [xx, yy, z[i][j]]));
}
export function projectedUpdate(event: Doc, paths: string[], indices: number[][]) {
  const delta = paths.map((p, i) => at(event.parameters?.[p.split('/')[1]]?.delta, indices[i]) ?? 0);
  const all = numeric(Object.values(event.parameters ?? {}).map((p: any) => p.delta));
  const norm2 = all.reduce((s, x) => s + x * x, 0),
    plane = delta.reduce((s, x) => s + x * x, 0);
  return { delta, residual: Math.sqrt(Math.max(0, norm2 - plane)), norm: Math.sqrt(norm2) };
}
export interface Selection {
  sample: number;
  event: number;
  neuron: number;
  input: number;
  model: string;
  layer: number;
}
interface State {
  view: View;
  selection: Selection;
  setView: (v: View) => void;
  select: (s: Partial<Selection>) => void;
  reset: () => void;
}
const initial = { sample: 0, event: 0, neuron: 0, input: 0, model: 'actor', layer: 0 };
export const useLab = create<State>((set) => ({
  view: 'arm',
  selection: { ...initial },
  setView: (view) => set({ view }),
  select: (s) => set((x) => ({ selection: { ...x.selection, ...s } })),
  reset: () => set({ selection: { ...initial } }),
}));
export function download(name: string, value: Blob | object) {
  const blob =
    value instanceof Blob ? value : new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function encodeBlob(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let result = '';
  for (let i = 0; i < bytes.length; i += 32768)
    result += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(result);
}
export function decodeBlob(value: string) {
  const s = atob(value);
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
