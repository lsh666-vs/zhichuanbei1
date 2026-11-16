import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Line, TransformControls } from '@react-three/drei';
import * as THREE from 'three';
import { Doc, fmt, quaternion, surfaceVertices, useLab } from './core';

function Label({ at, children }: { at: number[]; children: React.ReactNode }) {
  const text = React.Children.toArray(children)
    .map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : ''))
    .join('');
  const sprite = useRef<THREE.Sprite>(null);
  const { texture, aspect } = useMemo(() => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    ctx.font = '20px "Segoe UI", "Microsoft YaHei",sans-serif';
    canvas.width = Math.ceil(ctx.measureText(text).width) + 24;
    canvas.height = 42;
    ctx.fillStyle = '#ffffffeb';
    ctx.fillRect(0, 0, canvas.width, 42);
    ctx.strokeStyle = '#dce6e9';
    ctx.strokeRect(1, 1, canvas.width - 2, 40);
    ctx.font = '20px "Segoe UI", "Microsoft YaHei",sans-serif';
    ctx.fillStyle = '#607e8b';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 12, 21);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return { texture, aspect: canvas.width / 42 };
  }, [text]);
  useEffect(() => () => texture.dispose(), [texture]);
  useFrame(({ camera, size }) => {
    if (!sprite.current) return;
    const distance = camera.position.distanceTo(new THREE.Vector3(...(at as [number, number, number])));
    const height =
      (2 * Math.tan(THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov / 2)) * distance * 18) /
      size.height;
    sprite.current.scale.set(height * aspect, height, 1);
  });
  return (
    <sprite ref={sprite} position={at as any} renderOrder={20}>
      <spriteMaterial map={texture} transparent depthTest={false} depthWrite={false} />
    </sprite>
  );
}
function CameraPose({ view, count }: { view: string; count: number }) {
  const { camera, invalidate } = useThree();
  useLayoutEffect(() => {
    const networkHeight = Math.max(1, ((count - 1) * 2.7) / 2);
    const position =
      view === 'arm'
        ? [1, -1.1, 0.9]
        : view === 'network'
          ? [4, -Math.max(6, count * 2), networkHeight + 4]
          : [3, -3, 2.7];
    camera.position.set(...(position as [number, number, number]));
    camera.up.set(0, 0, 1);
    (camera as THREE.PerspectiveCamera).fov = view === 'arm' ? 40 : 45;
    (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
    camera.lookAt(
      view === 'arm'
        ? new THREE.Vector3(0.18, 0, 0.2)
        : view === 'network'
          ? new THREE.Vector3(0, 0, networkHeight)
          : new THREE.Vector3(0, 0, 0.35),
    );
    invalidate();
  }, [view, count, camera]);
  return null;
}
function Rod({
  a,
  b,
  color = '#2c8d88',
  radius = 0.025,
  opacity = 1,
}: {
  a: number[];
  b: number[];
  color?: string;
  radius?: number;
  opacity?: number;
}) {
  const mid = a.map((v, i) => (v + b[i]) / 2),
    dir = new THREE.Vector3(...(b as [number, number, number])).sub(
      new THREE.Vector3(...(a as [number, number, number])),
    );
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  return (
    <mesh position={mid as any} quaternion={q}>
      <capsuleGeometry args={[radius, dir.length(), 6, 14]} />
      <meshStandardMaterial
        color={color}
        transparent={opacity < 1}
        opacity={opacity}
        metalness={0.35}
        roughness={0.32}
      />
    </mesh>
  );
}
export function ArmBodies({
  frame,
  geometry,
  ghost = false,
}: {
  frame: Doc;
  geometry: Doc;
  ghost?: boolean;
}) {
  const lengths = geometry.link_lengths_m;
  return (
    <group>
      {frame.bodies.map((b: Doc, i: number) => (
        <group key={b.name} position={b.position_m} quaternion={quaternion(b.quaternion_wxyz)}>
          {i === 0 ? (
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry
                args={[
                  geometry.base_cylinder_radius_m,
                  geometry.base_cylinder_radius_m,
                  geometry.base_cylinder_half_height_m * 2,
                  32,
                ]}
              />
              <meshStandardMaterial
                color={ghost ? '#e4ac60' : '#384d5c'}
                transparent={ghost}
                opacity={ghost ? 0.3 : 1}
              />
            </mesh>
          ) : (
            <Rod
              a={[0, 0, 0]}
              b={[lengths[i - 1], 0, 0]}
              radius={geometry.capsule_radius_m}
              color={ghost ? '#e4ac60' : i === 1 ? '#327d91' : '#44b5a0'}
              opacity={ghost ? 0.3 : 1}
            />
          )}
          <mesh>
            <sphereGeometry args={[0.031, 16, 16]} />
            <meshStandardMaterial
              color={ghost ? '#e4ac60' : '#d6e4e7'}
              transparent={ghost}
              opacity={ghost ? 0.3 : 1}
            />
          </mesh>
        </group>
      ))}
      <mesh position={frame.tip_m}>
        <sphereGeometry args={[0.018, 18, 18]} />
        <meshStandardMaterial color={ghost ? '#d88d3f' : '#245c70'} />
      </mesh>
    </group>
  );
}
function Arm({
  frame,
  geometry,
  frames,
  compare,
  target,
  onTarget,
  drag,
}: {
  frame: Doc;
  geometry: Doc;
  frames: Doc[];
  compare?: Doc;
  target: number[];
  onTarget: (p: number[]) => void;
  drag: boolean;
}) {
  const ref = useRef<THREE.Mesh>(null);
  // Sampled minibatch rows are not chronological; connect only real transitions.
  const segments = frames.flatMap((f, i) =>
    f.before && f.after
      ? [[f.before.tip_m, f.after.tip_m]]
      : i > 0 &&
          f.tip_m &&
          frames[i - 1].tip_m &&
          f.time_s > frames[i - 1].time_s &&
          f.time_s - frames[i - 1].time_s <= geometry.timestep_s * geometry.substeps + 1e-9
        ? [[frames[i - 1].tip_m, f.tip_m]]
        : [],
  );
  useEffect(() => {
    ref.current?.position.set(...(target as [number, number, number]));
  }, [target]);
  return (
    <>
      <gridHelper
        args={[2, 20, '#bacbd0', '#e1e8e9']}
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, 0, -0.025]}
      />
      <axesHelper args={[0.22]} />
      <Label at={[0.26, 0, 0.02]}>X · m</Label>
      <Label at={[0, 0.26, 0.02]}>Y · m</Label>
      <Label at={[0, 0, 0.28]}>Z · m</Label>
      <ArmBodies frame={frame} geometry={geometry} />
      {compare && <ArmBodies frame={compare} geometry={geometry} ghost />}
      {segments.map((points, i) => (
        <Line key={i} points={points} color="#288e88" lineWidth={1.5} dashed dashSize={0.02} gapSize={0.01} />
      ))}
      <Line
        points={[frame.tip_m, frame.target_m]}
        color="#d9a65f"
        lineWidth={1}
        dashed
        dashSize={0.015}
        gapSize={0.008}
      />
      <mesh position={frame.target_m}>
        <sphereGeometry args={[0.032, 24, 24]} />
        <meshStandardMaterial color="#e7a54c" wireframe />
      </mesh>
      <Label at={frame.target_m.map((n: number, i: number) => n + (i === 2 ? 0.075 : 0))}>
        目标 · 真实坐标
      </Label>
      <mesh ref={ref} position={target as any}>
        <octahedronGeometry args={[0.026]} />
        <meshStandardMaterial color="#e0903e" transparent opacity={0.6} />
      </mesh>
      {drag && (
        <TransformControls
          object={ref as any}
          mode="translate"
          size={0.6}
          onMouseUp={() => {
            if (ref.current) onTarget(ref.current.position.toArray());
          }}
        />
      )}
    </>
  );
}
function Neurons({
  points,
  values,
  selected,
  onPick,
}: {
  points: number[][];
  values: number[];
  selected: number;
  onPick: (i: number) => void;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const mat = new THREE.Matrix4();
    points.forEach((p, i) => {
      mat.makeTranslation(...(p as [number, number, number]));
      ref.current!.setMatrixAt(i, mat);
      const v = values?.[i];
      ref.current!.setColorAt(
        i,
        new THREE.Color(i === selected ? '#eaa048' : v == null ? '#b6c8d1' : v < 0 ? '#547cbe' : '#36a89b'),
      );
    });
    ref.current.instanceMatrix.needsUpdate = true;
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
  }, [points, values, selected]);
  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, points.length]}
      onClick={(e) => {
        e.stopPropagation();
        if (e.instanceId != null) onPick(e.instanceId);
      }}
    >
      <sphereGeometry args={[0.062, 10, 10]} />
      <meshStandardMaterial roughness={0.35} metalness={0.2} />
    </instancedMesh>
  );
}
const nodePosition = (layer: number, i: number, n: number, offset = 0): [number, number, number] => [
  layer * 1.75 - 2.5,
  ((i % 8) - Math.min(n - 1, 7) / 2) * 0.23,
  Math.floor(i / 8) * 0.23 + offset,
];
function Connections({ event, layer, width, base, sample, neuron, input, backward, onPick }: any) {
  const edges = useMemo(
    () =>
      Array.from({ length: width }, (_, j) => {
        const a = nodePosition(layer - 1, j, width, base),
          b = nodePosition(layer, neuron, event.weight.length, base);
        const value = backward
          ? event.weight[neuron]?.[j] * event.preactivation_gradient?.[sample]?.[neuron]
          : event.weight[neuron]?.[j] * event.input?.[sample]?.[j];
        return { a, b, value };
      }),
    [event, layer, width, base, sample, neuron, backward],
  );
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        edges.flatMap(({ a, b }) => [...a, ...b]),
        3,
      ),
    );
    g.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(
        edges.flatMap(({ value }) => {
          const c = new THREE.Color(value < 0 ? '#547cbe' : '#2b9e8e');
          return [...c.toArray(), ...c.toArray()];
        }),
        3,
      ),
    );
    return g;
  }, [edges]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const selected = edges[Math.min(input, edges.length - 1)];
  if (!selected) return null;
  const start = new THREE.Vector3(...((backward ? selected.b : selected.a) as [number, number, number]));
  const end = new THREE.Vector3(...((backward ? selected.a : selected.b) as [number, number, number]));
  const direction = end.clone().sub(start),
    color = selected.value < 0 ? '#547cbe' : '#2b9e8e';
  return (
    <>
      <lineSegments
        geometry={geometry}
        onClick={(e) => {
          e.stopPropagation();
          onPick(Math.floor((e.index ?? 0) / 2));
        }}
      >
        <lineBasicMaterial vertexColors transparent opacity={0.45} />
      </lineSegments>
      <Line points={[selected.a, selected.b]} color={color} lineWidth={2.5} />
      {Number.isFinite(selected.value) && (
        <>
          <arrowHelper args={[direction.clone().normalize(), start, direction.length(), color, 0.15, 0.08]} />
          <Label at={start.clone().lerp(end, 0.5).toArray()}>
            {backward ? 'W·dL/dz' : 'W·x'} = {fmt(selected.value)}
          </Label>
        </>
      )}
    </>
  );
}
function Network({
  architecture,
  events,
  onEvent,
  expanded,
  path,
  backward,
  onExpand,
}: {
  architecture: Doc;
  events: Doc[];
  onEvent: (i: number) => void;
  expanded: boolean;
  path: string;
  backward: boolean;
  onExpand: () => void;
}) {
  const s = useLab((x) => x.selection),
    select = useLab((x) => x.select);
  const models = Object.keys(architecture).filter((k) => path === 'all' || k === path);
  return (
    <>
      {models.map((name, mi) => {
        const spec = architecture[name],
          base = (models.length - 1 - mi) * 2.7;
        return (
          <group key={name}>
            <Label at={[-3.1, -1, base + 0.8]}>
              {name} · {spec.sizes.join(' → ')}
            </Label>
            {!expanded ? (
              <mesh
                position={[0, 0, base + 0.3]}
                onClick={() => {
                  select({ model: name, layer: 0 });
                  onExpand();
                }}
              >
                <boxGeometry args={[4.4, 1.3, 0.5]} />
                <meshStandardMaterial
                  color={s.model === name ? '#288e88' : '#8ba5b6'}
                  transparent
                  opacity={0.75}
                />
              </mesh>
            ) : (
              spec.sizes.map((n: number, l: number) => {
                const modelLabel =
                  path === 'q1' &&
                  events.some((e) => e.label?.startsWith('q1_actor_path/')) &&
                  s.model === 'q1_actor_path'
                    ? 'q1_actor_path'
                    : name;
                const ei = events.findIndex(
                  (e) =>
                    e.kind === 'layer' &&
                    e.label ===
                      `${s.model === name + '_actor_path' ? s.model : modelLabel}/layer${Math.max(0, l - 1)}`,
                );
                const ev = events[ei];
                const values = backward
                  ? l === 0
                    ? ev?.input_gradient?.[s.sample]
                    : ev?.output_gradient?.[s.sample]
                  : l === 0
                    ? ev?.input?.[s.sample]
                    : ev?.output?.[s.sample];
                const positions = Array.from({ length: n }, (_, i) => nodePosition(l, i, n, base));
                return (
                  <group key={l}>
                    <Label at={[l * 1.75 - 2.5, -1.3, base + 0.1]}>
                      {l === 0 ? '输入' : l === spec.sizes.length - 1 ? '输出' : `隐藏 ${l}`} · {n}
                    </Label>
                    <Neurons
                      points={positions}
                      values={values}
                      selected={
                        s.model.replace('_actor_path', '') === name
                          ? l === 0 && s.layer === 0
                            ? s.input
                            : s.layer === l - 1
                              ? s.neuron
                              : -1
                          : -1
                      }
                      onPick={(i) => {
                        select(
                          l === 0
                            ? { model: name, layer: 0, input: i }
                            : { model: name, layer: l - 1, neuron: i },
                        );
                        if (ei >= 0) onEvent(ei);
                      }}
                    />
                    {l > 0 &&
                      s.model.replace('_actor_path', '') === name &&
                      s.layer === l - 1 &&
                      ev?.weight && (
                        <Connections
                          event={ev}
                          layer={l}
                          width={spec.sizes[l - 1]}
                          base={base}
                          sample={s.sample}
                          neuron={Math.min(s.neuron, n - 1)}
                          input={s.input}
                          backward={backward}
                          onPick={(input) => select({ input })}
                        />
                      )}
                  </group>
                );
              })
            )}
          </group>
        );
      })}
    </>
  );
}
function Surface({
  data,
  fields,
  onPick,
  marker,
  gradient,
}: {
  data: Doc;
  fields: string[];
  onPick: (i: number, j: number) => void;
  marker?: number[];
  gradient?: number[];
}) {
  const stats = useMemo(() => {
    const vals = fields.flatMap((k) => data[k].flat());
    return { lo: Math.min(...vals), hi: Math.max(...vals) };
  }, [data, fields]);
  const extent = Math.max(...data.x.map(Math.abs), ...data.y.map(Math.abs)) || 1;
  const range = Math.max(stats.hi - stats.lo, 1e-12);
  return (
    <>
      <gridHelper
        args={[2.4, 12, '#bdcdd2', '#e1e8e9']}
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, 0, -0.05]}
      />
      {fields.map((key, si) => (
        <SurfaceMesh
          key={key}
          x={data.x}
          y={data.y}
          values={data[key]}
          lo={stats.lo}
          range={range}
          extent={extent}
          color={['#2eaaa0', '#687dcb', '#dfab68'][si]}
          transparent={fields.length > 1}
          onPick={onPick}
        />
      ))}
      <Label at={[0, -1.3, 0]}>
        x: {fmt(data.x[0])} … {fmt(data.x.at(-1))}
      </Label>
      <Label at={[1.4, 0, 0]}>
        y: {fmt(data.y[0])} … {fmt(data.y.at(-1))}
      </Label>
      <Label at={[-1.3, 0, 1]}>
        高度 {fmt(stats.lo)} … {fmt(stats.hi)}
      </Label>
      {marker &&
        [marker, gradient].filter(Boolean).map((vector, i) => (
          <Line
            key={i}
            points={[
              [0, 0, (data.origin_loss - stats.lo) / range + 0.015],
              [vector[0] / extent, vector[1] / extent, (data.origin_loss - stats.lo) / range + 0.015],
            ]}
            color={i === 0 ? '#cf643f' : '#547cbe'}
            lineWidth={i === 0 ? 4 : 2}
          />
        ))}
    </>
  );
}
function SurfaceMesh({ x, y, values, lo, range, extent, color, transparent, onPick }: any) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const v = surfaceVertices(
      x.map((v: number) => v / extent),
      y.map((v: number) => v / extent),
      values.map((row: number[]) => row.map((v) => (v - lo) / range)),
    );
    const ids = [];
    for (let i = 0; i < x.length - 1; i++)
      for (let j = 0; j < y.length - 1; j++) {
        const a = i * y.length + j;
        ids.push(a, a + y.length, a + 1, a + 1, a + y.length, a + y.length + 1);
      }
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.setIndex(ids);
    g.computeVertexNormals();
    return g;
  }, [x, y, values, lo, range, extent]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <group>
      <mesh
        geometry={geometry}
        onClick={(e) => {
          e.stopPropagation();
          const vertex = geometry.index!.getX((e.faceIndex ?? 0) * 3);
          onPick(Math.floor(vertex / y.length), vertex % y.length);
        }}
      >
        <meshStandardMaterial
          color={color}
          side={THREE.DoubleSide}
          transparent={transparent}
          opacity={transparent ? 0.55 : 0.85}
          roughness={0.65}
        />
      </mesh>
      <mesh geometry={geometry}>
        <meshBasicMaterial color={color} wireframe transparent opacity={0.25} />
      </mesh>
    </group>
  );
}
class SceneBoundary extends React.Component<{ children: React.ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <div className="empty">3D 渲染不可用，请使用下方二维数值表。检查浏览器 WebGL 支持。</div>
    ) : (
      this.props.children
    );
  }
}

// Opt-in local benchmark. Normal workbench keeps demand rendering and allocates no log.
function FrameProbe() {
  const { gl, invalidate } = useThree();
  const enabled = new URLSearchParams(window.location.search).get('diagnostics') === '1';
  useEffect(() => {
    if (!enabled) return;
    let request = 0;
    const draw = () => {
      invalidate();
      request = requestAnimationFrame(draw);
    };
    request = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(request);
  }, [enabled, invalidate]);
  useFrame(() => {
    if (!enabled) return;
    const target = window as any;
    const frames = (target.__policyglassFrames ??= []);
    if (frames.length < 7200)
      frames.push({
        time: performance.now(),
        calls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        geometries: gl.info.memory.geometries,
        textures: gl.info.memory.textures,
      });
    const context = gl.getContext();
    target.__policyglassRenderer ??= {
      renderer: context.getParameter(context.RENDERER),
      vendor: context.getParameter(context.VENDOR),
      pixelRatio: gl.getPixelRatio(),
      width: gl.domElement.width,
      height: gl.domElement.height,
    };
  });
  return null;
}
export default function Scenes({
  view,
  frame,
  geometry,
  frames,
  compare,
  target,
  onTarget,
  drag,
  architecture,
  events,
  onEvent,
  expanded,
  path,
  surface,
  fields,
  onPick,
  marker,
  gradient,
  backward,
  onExpand,
}: any) {
  const camera =
    view === 'arm'
      ? { position: [1.2, -1.3, 0.95], zoom: 1 }
      : view === 'network'
        ? { position: [6, -8, 7], zoom: 1 }
        : { position: [3, -3, 2.7], zoom: 1 };
  const modelCount = path === 'all' ? Object.keys(architecture ?? {}).length : 1;
  return (
    <div
      className="scene"
      data-testid={`scene-${view}`}
      role="tabpanel"
      id={'view-panel-' + view}
      aria-labelledby={'view-tab-' + view}
    >
      <SceneBoundary>
        <Canvas
          camera={{ ...camera, up: [0, 0, 1], near: 0.01, far: 100 } as any}
          dpr={[1, 1.5]}
          frameloop="demand"
          gl={{ antialias: true, powerPreference: 'high-performance' }}
          fallback={<div>WebGL 不可用；二维数据仍可检查。</div>}
        >
          <FrameProbe />
          <color attach="background" args={['#f1f5f6']} />
          <CameraPose view={view} count={modelCount} />
          <ambientLight intensity={1.7} />
          <directionalLight position={[3, -3, 7]} intensity={2.2} />
          {view === 'arm' && frame && (
            <Arm {...{ frame, geometry, frames, compare, target, onTarget, drag }} />
          )}
          {view === 'network' && (
            <Network {...{ architecture, events, onEvent, expanded, path, backward, onExpand }} />
          )}
          {(view === 'q' || view === 'loss') && surface && (
            <Surface data={surface} {...{ fields, onPick, marker, gradient }} />
          )}
          <OrbitControls
            key={view + ':' + modelCount}
            makeDefault
            target={
              view === 'arm'
                ? [0.18, 0, 0.2]
                : view === 'network'
                  ? [0, 0, Math.max(1, ((modelCount - 1) * 2.7) / 2)]
                  : [0, 0, 0.35]
            }
            minDistance={view === 'arm' ? 0.3 : 1}
            maxDistance={view === 'arm' ? 4 : 25}
          />
        </Canvas>
      </SceneBoundary>
      <div className="scene-hint">拖动旋转 · 滚轮缩放 · Shift 平移</div>
    </div>
  );
}
