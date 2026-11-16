import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Line, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { api, Doc, fmt, useLab } from './core';
import Label from './SceneLabel';
import {
  layerData,
  modelTitle,
  networkCounts,
  nodePosition,
  parameterHandoff,
  ParameterHandoff,
} from './networkData';

function FitNetwork({ count, layers, reset }: { count: number; layers: number; reset: number }) {
  const { camera, size, invalidate } = useThree();
  useLayoutEffect(() => {
    const height = 7 + (count - 1) * 7.2;
    const width = (layers - 1) * 3.25 + 2.6;
    const distance = Math.max(height, width / (size.width / size.height)) / (2 * Math.tan(Math.PI / 9));
    camera.position.set(0, -distance * 1.08, 0.55);
    camera.up.set(0, 0, 1);
    (camera as THREE.PerspectiveCamera).fov = 40;
    (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
    camera.lookAt(0, 0, 0);
    invalidate();
  }, [count, layers, reset, size.width, size.height, camera]);
  return null;
}

function NeuronLayer({
  points,
  values,
  selected,
  onPick,
}: {
  points: [number, number, number][];
  values?: number[];
  selected: number;
  onPick: (index: number) => void;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const transform = new THREE.Matrix4();
    points.forEach((point, i) => {
      transform.makeScale(i === selected ? 1.35 : 1, i === selected ? 1.35 : 1, i === selected ? 1.35 : 1);
      transform.setPosition(...point);
      ref.current!.setMatrixAt(i, transform);
      const value = values?.[i];
      const color =
        i === selected ? '#e69b3f' : value == null ? '#c4d4dd' : value < 0 ? '#6d88d4' : '#25a695';
      ref.current!.setColorAt(i, new THREE.Color(color));
    });
    ref.current.instanceMatrix.needsUpdate = true;
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
    ref.current.computeBoundingSphere();
  }, [points, values, selected]);
  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, points.length]}
      onClick={(event) => {
        event.stopPropagation();
        if (event.instanceId != null) onPick(event.instanceId);
      }}
    >
      <sphereGeometry args={[0.085, 14, 12]} />
      <meshStandardMaterial roughness={0.3} metalness={0.08} />
    </instancedMesh>
  );
}

function DenseEdges({
  before,
  after,
  weight,
  focus,
  onPick,
}: {
  before: [number, number, number][];
  after: [number, number, number][];
  weight?: number[][];
  focus?: number;
  onPick: (neuron: number, input: number) => void;
}) {
  const geometry = useMemo(() => {
    const positions: number[] = [],
      colors: number[] = [];
    const rows = focus == null ? after.map((_, i) => i) : [focus];
    for (const n of rows)
      for (let j = 0; j < before.length; j++) {
        positions.push(...before[j], ...after[n]);
        const value = weight?.[n]?.[j];
        const color = new THREE.Color(value == null ? '#bac8d1' : value < 0 ? '#718ad0' : '#32a492');
        colors.push(...color.toArray(), ...color.toArray());
      }
    const result = new THREE.BufferGeometry();
    result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    result.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return result;
  }, [before, after, weight, focus]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <lineSegments
      geometry={geometry}
      onClick={(event) => {
        event.stopPropagation();
        const edge = Math.floor((event.index ?? 0) / 2);
        onPick(focus ?? Math.floor(edge / before.length), edge % before.length);
      }}
    >
      <lineBasicMaterial vertexColors transparent opacity={focus == null ? 0.16 : 0.7} depthWrite={false} />
    </lineSegments>
  );
}

// Read-only diagnostic projection of the very same drawn nodes for actual
// canvas-picking tests. It creates no log in ordinary product mode.
function PickProbe({ models, architecture, selection }: any) {
  const { camera, size } = useThree();
  const previous = useRef('');
  useFrame(() => {
    if (new URLSearchParams(location.search).get('diagnostics') !== '1') return;
    const key =
      models.join() + ':' + selection.model + ':' + selection.layer + ':' + size.width + ':' + size.height;
    if (previous.current === key) return;
    previous.current = key;
    const name = models.find((n: string) => n === selection.model.replace('_actor_path', '')) ?? models[0];
    if (!name) return;
    const spec = architecture[name],
      mi = models.indexOf(name);
    const base = ((models.length - 1) / 2 - mi) * 7.2;
    const layer = Math.min(selection.layer + 1, spec.sizes.length - 1);
    const project = (position: number[]) => {
      const p = new THREE.Vector3(...(position as [number, number, number])).project(camera);
      return { x: ((p.x + 1) * size.width) / 2, y: ((1 - p.y) * size.height) / 2 };
    };
    (window as any).__policyglassNetworkPick = {
      name,
      layer: layer - 1,
      nodes: Array.from({ length: spec.sizes[layer] }, (_, i) => ({
        neuron: i,
        ...project(nodePosition(layer, i, spec.sizes[layer], spec.sizes.length, base)),
      })),
    };
  });
  return null;
}

export default function NetworkExplorer({
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
  traceMeta,
  probe,
  onParameter,
  onForward,
  busy,
}: {
  architecture: Doc;
  events: Doc[];
  onEvent: (index: number) => void;
  expanded: boolean;
  onExpanded: (value: boolean) => void;
  path: string;
  onPath: (value: string) => void;
  backward: boolean;
  experiment: string;
  checkpoint: string;
  traceId: string;
  traceMeta?: Doc;
  probe: React.ReactNode;
  onParameter: (handoff: ParameterHandoff) => void;
  onForward: () => void;
  busy: boolean;
}) {
  const selection = useLab((state) => state.selection),
    select = useLab((state) => state.select);
  const [snapshot, setSnapshot] = useState<Doc>(),
    [error, setError] = useState(''),
    [reset, setReset] = useState(0),
    [checkpointSource, setCheckpointSource] = useState('');
  const sourceKey = [experiment, checkpoint, traceId, selection.event].join(':');
  const checkpointOnly = checkpointSource === sourceKey;
  const shownEvents = checkpointOnly ? [] : events;
  useEffect(() => {
    let current = true;
    setError('');
    api('/experiments/' + experiment + '/parameters?checkpoint=' + encodeURIComponent(checkpoint))
      .then((parameters) => {
        if (current) setSnapshot({ experiment, checkpoint, parameters });
      })
      .catch((reason) => {
        if (current) setError(String(reason));
      });
    return () => {
      current = false;
    };
  }, [experiment, checkpoint]);
  const parameters =
    snapshot?.experiment === experiment && snapshot?.checkpoint === checkpoint
      ? snapshot.parameters
      : undefined;
  const models = useMemo(
    () => Object.keys(architecture).filter((name) => path === 'all' || name === path),
    [architecture, path],
  );
  const positionsByModel = useMemo(
    () =>
      Object.fromEntries(
        models.map((name, mi) => {
          const model = architecture[name],
            base = ((models.length - 1) / 2 - mi) * 7.2;
          return [
            name,
            model.sizes.map((n: number, l: number) =>
              Array.from({ length: n }, (_, i) => nodePosition(l, i, n, model.sizes.length, base)),
            ),
          ];
        }),
      ),
    [architecture, models],
  );
  const active = models.find((name) => name === selection.model.replace('_actor_path', '')) ?? models[0];
  const spec = architecture[active];
  const layer = Math.max(0, Math.min(selection.layer, spec.sizes.length - 2));
  const data = layerData(active, layer, shownEvents, parameters, selection.model);
  const neuron = Math.max(0, Math.min(selection.neuron, spec.sizes[layer + 1] - 1));
  const input = Math.max(0, Math.min(selection.input, spec.sizes[layer] - 1));
  const weight = data.weight?.[neuron]?.[input],
    bias = data.bias?.[neuron];
  const inputValue = data.event?.input?.[selection.sample]?.[input];
  const output = data.event?.output?.[selection.sample]?.[neuron];
  const z = data.event?.preactivation?.[selection.sample]?.[neuron];
  const gradient = data.event?.preactivation_gradient?.[selection.sample]?.[neuron];
  const counts = models.reduce(
    (sum, name) => {
      const current = networkCounts(architecture[name]);
      return {
        neurons: sum.neurons + current.neurons,
        weights: sum.weights + current.weights,
        biases: sum.biases + current.biases,
      };
    },
    { neurons: 0, weights: 0, biases: 0 },
  );
  const pick = (name: string, l: number, n: number, j: number) => {
    const item = layerData(name, l, shownEvents, parameters, selection.model);
    if (item.eventIndex >= 0) onEvent(item.eventIndex);
    select({ model: item.event?.label.split('/layer')[0] ?? name, layer: l, neuron: n, input: j });
  };
  const edit = (path: string, index: number[], recordedValue: number) => {
    const handoff = parameterHandoff(experiment, checkpoint, parameters, path, index, {
      traceId,
      eventId: data.event?.id,
      eventLabel: data.event?.label,
      phase: traceMeta?.phase,
      originCheckpoint: traceMeta?.origin_checkpoint,
      outputCheckpoint: traceMeta?.output_checkpoint,
      sample: selection.sample,
      recordedValue,
    });
    if (!handoff) return;
    setCheckpointSource(sourceKey);
    onParameter(handoff);
  };
  return (
    <div className="network-explorer">
      <div className="network-toolbar">
        <label>
          网络{' '}
          <select
            aria-label="可视网络"
            value={path}
            onChange={(e) => {
              onPath(e.target.value);
              if (e.target.value !== 'all') select({ model: e.target.value, layer: 0, neuron: 0, input: 0 });
            }}
          >
            {Object.keys(architecture).map((name) => (
              <option key={name} value={name}>
                {modelTitle(name)}
              </option>
            ))}
            <option value="all">所有网络</option>
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={expanded} onChange={(e) => onExpanded(e.target.checked)} />
          全部权重连线
        </label>
        <button disabled={busy} onClick={onForward}>
          计算 Actor 前向
        </button>
        <button onClick={() => setReset((value) => value + 1)}>复位视角</button>
      </div>
      <div
        className="network-summary"
        data-testid="network-summary"
        data-neurons={counts.neurons}
        data-weights={counts.weights}
        data-biases={counts.biases}
      >
        <span>
          <b>{counts.neurons}</b> 个神经元
        </span>
        <span>
          <b>{counts.weights.toLocaleString()}</b> 条权重连接
        </span>
        <span>
          <b>{counts.biases}</b> 个偏置
        </span>
        <span>
          连线：
          <i className="positive" />
          正权重 <i className="negative" />
          负权重
        </span>
      </div>
      <div
        className="scene network-scene"
        data-testid="scene-network"
        role="tabpanel"
        id="view-panel-network"
        aria-labelledby="view-tab-network"
      >
        <Canvas
          camera={{ position: [0, -12, 0.5], up: [0, 0, 1], near: 0.01, far: 180, fov: 40 }}
          dpr={[1, 1.5]}
          frameloop="demand"
          gl={{ antialias: true, powerPreference: 'high-performance' }}
          raycaster={{ params: { Line: { threshold: 0.035 } } } as any}
        >
          {probe}
          <color attach="background" args={['#f6f9fb']} />
          <ambientLight intensity={1.8} />
          <directionalLight position={[-2, -8, 6]} intensity={2.5} />
          <FitNetwork
            count={models.length}
            layers={Math.max(...models.map((name) => architecture[name].sizes.length))}
            reset={reset}
          />
          {models.map((name, mi) => {
            const model = architecture[name],
              base = ((models.length - 1) / 2 - mi) * 7.2;
            const positions = positionsByModel[name];
            const isActive = name === active;
            return (
              <group key={name}>
                <Label at={[0, 0, base + 3.05]}>
                  {modelTitle(name)} · {model.sizes.join(' → ')}
                </Label>
                {model.sizes.map((n: number, l: number) => {
                  const item = layerData(name, Math.max(0, l - 1), shownEvents, parameters, selection.model);
                  const values = backward
                    ? l === 0
                      ? item.event?.input_gradient?.[selection.sample]
                      : item.event?.output_gradient?.[selection.sample]
                    : l === 0
                      ? item.event?.input?.[selection.sample]
                      : item.event?.output?.[selection.sample];
                  return (
                    <group key={l}>
                      {l > 0 && expanded && (
                        <DenseEdges
                          before={positions[l - 1]}
                          after={positions[l]}
                          weight={item.weight}
                          onPick={(n, j) => pick(name, l - 1, n, j)}
                        />
                      )}
                      {l > 0 && isActive && layer === l - 1 && (
                        <DenseEdges
                          before={positions[l - 1]}
                          after={positions[l]}
                          weight={item.weight}
                          focus={neuron}
                          onPick={(n, j) => pick(name, l - 1, n, j)}
                        />
                      )}
                      <NeuronLayer
                        points={positions[l]}
                        values={values}
                        selected={
                          isActive ? (l === 0 && layer === 0 ? input : layer === l - 1 ? neuron : -1) : -1
                        }
                        onPick={(index) =>
                          pick(name, Math.max(0, l - 1), l === 0 ? neuron : index, l === 0 ? index : input)
                        }
                      />
                      <Label at={[nodePosition(l, 0, n, model.sizes.length, base)[0], 0, base - 2.95]}>
                        {l === 0 ? '输入' : l === model.sizes.length - 1 ? '输出' : '隐藏层 ' + l} · {n}
                      </Label>
                      {l === model.sizes.length - 1 &&
                        positions[l].map((point: number[], i: number) => (
                          <Label key={'output-' + i} at={[point[0] + 0.67, point[1], point[2]]}>
                            {name === 'actor'
                              ? i < n / 2
                                ? 'μ[' + i + ']'
                                : 'raw logσ[' + (i - n / 2) + ']'
                              : name === 'value'
                                ? 'V(s)'
                                : name.includes('q1')
                                  ? 'Q₁(s,a)'
                                  : 'Q₂(s,a)'}
                          </Label>
                        ))}
                      {l > 0 &&
                        isActive &&
                        layer === l - 1 &&
                        (() => {
                          const target = positions[l][neuron],
                            source = positions[l - 1][input];
                          const one: [number, number, number] = [target[0] - 0.5, -0.2, target[2] + 0.43];
                          return (
                            <>
                              <Line points={[source, target]} color="#db9239" lineWidth={3} />
                              <Label
                                at={source.map((value: number, axis: number) => (value + target[axis]) / 2)}
                              >
                                W[{neuron},{input}] = {fmt(item.weight?.[neuron]?.[input])}
                              </Label>
                              <mesh position={one}>
                                <sphereGeometry args={[0.07, 12, 10]} />
                                <meshBasicMaterial color="#e2ad66" />
                              </mesh>
                              <Line
                                points={[one, target]}
                                color="#d39a4c"
                                dashed
                                dashSize={0.06}
                                gapSize={0.035}
                                lineWidth={1.5}
                              />
                              <Label at={[one[0] - 0.22, one[1], one[2] + 0.16]}>
                                1 · b[{neuron}] = {fmt(item.bias?.[neuron])}
                              </Label>
                            </>
                          );
                        })()}
                    </group>
                  );
                })}
              </group>
            );
          })}
          <OrbitControls
            key={models.join() + ':' + reset}
            makeDefault
            target={[0, 0, 0]}
            minDistance={2}
            maxDistance={100}
            enableDamping={false}
          />
          <PickProbe models={models} architecture={architecture} selection={selection} />
        </Canvas>
        <div className="scene-hint">单击神经元 / 连线检查参数 · 拖动旋转 · 滚轮缩放</div>
      </div>
      <section className="network-readout" aria-label="网络参数检查" data-testid="network-readout">
        <div className="network-selection">
          <span className="eyebrow">SELECTED CONNECTION</span>
          <strong>
            {active} / 第 {layer + 1} 层
          </strong>
          <div className="network-coordinates">
            <label>
              层{' '}
              <select
                aria-label="图中检查层"
                value={layer}
                onChange={(e) => pick(active, +e.target.value, 0, 0)}
              >
                {spec.sizes.slice(1).map((n: number, l: number) => (
                  <option value={l} key={l}>
                    {l + 1} · {spec.sizes[l]} → {n}
                  </option>
                ))}
              </select>
            </label>
            <label>
              单元 j{' '}
              <input
                aria-label="图中检查单元"
                type="number"
                min={0}
                max={spec.sizes[layer + 1] - 1}
                value={neuron}
                onChange={(e) =>
                  pick(
                    active,
                    layer,
                    Math.max(0, Math.min(+e.target.value, spec.sizes[layer + 1] - 1)),
                    input,
                  )
                }
              />
            </label>
            <label>
              输入 i{' '}
              <input
                aria-label="图中检查输入"
                type="number"
                min={0}
                max={spec.sizes[layer] - 1}
                value={input}
                onChange={(e) =>
                  pick(active, layer, neuron, Math.max(0, Math.min(+e.target.value, spec.sizes[layer] - 1)))
                }
              />
            </label>
          </div>
        </div>
        <div className="network-numbers">
          <div>
            <small>
              权重 W[{neuron},{input}]
            </small>
            <b data-testid="network-weight">{fmt(weight)}</b>
          </div>
          <div>
            <small>偏置 b[{neuron}]</small>
            <b data-testid="network-bias">{fmt(bias)}</b>
          </div>
          <div>
            <small>输入 x[{input}]</small>
            <b data-testid="network-input">{fmt(inputValue)}</b>
          </div>
          <div>
            <small>输出 h[{neuron}]</small>
            <b data-testid="network-output">{fmt(output)}</b>
          </div>
        </div>
        <div className="network-equation">
          <b>
            z[{neuron}] = Σᵢ W[{neuron},i] x[i] + b[{neuron}]
          </b>
          <span>
            选中项 W × x = {weight != null && inputValue != null ? fmt(weight * inputValue) : '未执行前向'} ·
            z = {fmt(z)}
          </span>
          {backward && (
            <span>
              dL/dz = {fmt(gradient)} · 该输入路径 dL/dz × x ={' '}
              {gradient != null && inputValue != null ? fmt(gradient * inputValue) : '未执行反向'}
            </span>
          )}
          <small>
            来源：{data.source} · {data.event ? traceId : checkpoint.slice(0, 12)}
          </small>
          {!data.event && <small>已加载检查点的真实 W / b；激活值需要一次前向或已记录的训练事件。</small>}
          {data.event && (
            <p className="callout" data-testid="parameter-source-warning">
              正在回放历史事件。快捷修改将先切换为所选完整检查点 {checkpoint} 的真实参数，并清除事件激活。
              {data.event.label.includes('_actor_path') &&
                ' SAC post-critic 是更新中间阶段，没有可直接分支的完整检查点；不会拼接或合成状态。'}
            </p>
          )}
          {checkpointOnly && (
            <p className="callout">
              已切换为完整检查点参数；修改从该父状态开始。
              <button onClick={() => setCheckpointSource('')}>返回历史事件参数</button>
            </p>
          )}
          <div className="network-parameters">
            <button
              disabled={weight == null || !parameters || busy}
              onClick={() => edit(active + '/weights.' + layer, [neuron, input], weight)}
            >
              修改此权重…
            </button>
            <button
              disabled={bias == null || !parameters || busy}
              onClick={() => edit(active + '/biases.' + layer, [neuron], bias)}
            >
              修改此偏置…
            </button>
          </div>
          {error && <span role="alert">参数读取失败：{error}</span>}
        </div>
      </section>
      <details className="network-incoming">
        <summary>该单元的全部入边 · {spec.sizes[layer]} 个权重</summary>
        <div className="network-weight-list">
          {Array.from({ length: spec.sizes[layer] }, (_, j) => (
            <button
              key={j}
              className={j === input ? 'selected' : ''}
              onClick={() => pick(active, layer, neuron, j)}
            >
              W[{neuron},{j}] = {fmt(data.weight?.[neuron]?.[j])}
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}
