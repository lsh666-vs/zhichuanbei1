import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Line, TransformControls } from '@react-three/drei';
import * as THREE from 'three';
import { Doc, fmt, quaternion, surfaceVertices } from './core';
import Label from './SceneLabel';
import NetworkExplorer from './NetworkExplorer';

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
function Surface({
  data,
  fields,
  onPick,
  marker,
  gradient,
  pick,
}: {
  data: Doc;
  fields: string[];
  onPick: (i: number, j: number) => void;
  marker?: number[];
  gradient?: number[];
  pick?: number[];
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
      {pick &&
        fields.map((key, i) => {
          const value = data[key]?.[pick[0]]?.[pick[1]];
          if (!Number.isFinite(value)) return null;
          const point: [number, number, number] = [
            data.x[pick[0]] / extent,
            data.y[pick[1]] / extent,
            (value - stats.lo) / range + 0.01,
          ];
          return (
            <group key={'pick-' + key}>
              <mesh position={point}>
                <sphereGeometry args={[0.035, 16, 14]} />
                <meshBasicMaterial color={i === 0 ? '#dc9139' : '#6578c8'} />
              </mesh>
              <Line
                points={[[point[0], point[1], -0.04], point]}
                color="#d3a35a"
                dashed
                dashSize={0.035}
                gapSize={0.02}
              />
            </group>
          );
        })}
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
  onExpanded,
  onPath,
  experiment,
  checkpoint,
  traceId,
  empty,
  onParameter,
  onForward,
  busy,
  gridPick,
}: any) {
  if (view === 'network')
    return (
      <SceneBoundary key="network">
        <NetworkExplorer
          {...{
            architecture,
            events,
            onEvent,
            expanded,
            onExpanded,
            path,
            onPath,
            backward,
            experiment,
            checkpoint,
            traceId,
            onParameter,
            onForward,
            busy,
          }}
          probe={<FrameProbe />}
        />
      </SceneBoundary>
    );
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
          {(view === 'q' || view === 'loss') && surface && (
            <Surface data={surface} {...{ fields, onPick, marker, gradient }} pick={gridPick} />
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
      {(view === 'q' || view === 'loss') && !surface && <div className="surface-empty">{empty}</div>}
      <div className="scene-hint">拖动旋转 · 滚轮缩放 · Shift 平移</div>
    </div>
  );
}
