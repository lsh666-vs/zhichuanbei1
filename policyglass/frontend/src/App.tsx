import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Box,
  Check,
  ChevronDown,
  Download,
  FlaskConical,
  GitBranch,
  Layers3,
  Network,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  Upload,
  X,
} from 'lucide-react';
import {
  api,
  at,
  decodeBlob,
  Doc,
  download,
  encodeBlob,
  finalBias,
  fmt,
  numeric,
  projectedUpdate,
  useLab,
  View,
  boundedIndex,
} from './core';
import Scenes from './Scenes';
import Inspector, { Formula, RawTree } from './Inspector';
import { courses } from './courses';
import { Explanation } from './Explanation';
import { StudyLibrary } from './StudyLibrary';
import { ParameterHandoff } from './networkData';
const tabs: { id: View; label: string; icon: any; caption: string }[] = [
  { id: 'arm', label: '物理实验', icon: Box, caption: '世界坐标 · MuJoCo' },
  { id: 'network', label: '计算网络', icon: Network, caption: '概念空间 · 实际张量' },
  { id: 'q', label: '双 Q 曲面', icon: Layers3, caption: '动作切片 · SAC' },
  { id: 'loss', label: '局部损失', icon: Activity, caption: '两个参数坐标 · 固定批次' },
];
const observationOf = (f: Doc) => [
  ...f.qpos_rad.map(Math.sin),
  ...f.qpos_rad.map(Math.cos),
  ...f.qvel_rad_s,
  ...f.tip_m,
  ...f.target_m,
];
const terminal = (status: string) => ['completed', 'cancelled', 'failed'].includes(status);
export default function App() {
  const { view, setView, selection: s, select, reset } = useLab();
  const [experiments, setExperiments] = useState<Doc[]>([]),
    [detail, setDetail] = useState<Doc>(),
    [checkpoints, setCheckpoints] = useState<Doc[]>([]),
    [history, setHistory] = useState<Doc[]>([]);
  const [trace, setTrace] = useState<Doc>(),
    [traceId, setTraceId] = useState(''),
    [cache, setCache] = useState<Record<number, Doc>>({}),
    [frames, setFrames] = useState<Doc[]>([]),
    [checkpoint, setCheckpoint] = useState('');
  const [prediction, setPrediction] = useState<Doc>(),
    [job, setJob] = useState<Doc>(),
    [connection, setConnection] = useState('正在连接'),
    [health, setHealth] = useState<Doc>();
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(''),
    [createOpen, setCreateOpen] = useState(false),
    [createAlgorithm, setCreateAlgorithm] = useState('ppo'),
    [course, setCourse] = useState(-1),
    [panel, setPanel] = useState('inspect');
  const [backward, setBackward] = useState(false),
    [expanded, setExpanded] = useState(true),
    [path, setPath] = useState('actor'),
    [playing, setPlaying] = useState(false),
    [networkFocus, setNetworkFocus] = useState(false),
    [missingPhase, setMissingPhase] = useState(''),
    [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [target, setTarget] = useState([0.45, 0.12, 0.45]),
    [drag, setDrag] = useState(false),
    [force, setForce] = useState([0, 0, 0]),
    [forceSteps, setForceSteps] = useState(4),
    [physicsDamping, setPhysicsDamping] = useState(0.15),
    [massScale, setMassScale] = useState(1),
    [resetEnvironment, setResetEnvironment] = useState(false),
    [physicsSteps, setPhysicsSteps] = useState(16);
  const [surfaceData, setSurface] = useState<Doc>(),
    [sliceAttempt, setSliceAttempt] = useState(''),
    [fields, setFields] = useState(['q1', 'q2']),
    [pick, setPick] = useState([0, 0]),
    [axes, setAxes] = useState([0, 1]),
    [fixed, setFixed] = useState([0, 0, 0]),
    [resolution, setResolution] = useState(15),
    [extent, setExtent] = useState(0.1),
    [lossX, setLossX] = useState(''),
    [lossY, setLossY] = useState(''),
    [lossIX, setLossIX] = useState('0'),
    [lossIY, setLossIY] = useState('1');
  const [observation, setObservation] = useState<number[]>([]),
    [noise, setNoise] = useState([0, 0, 0]),
    [branchKind, setBranchKind] = useState('hyperparameter'),
    [branchPath, setBranchPath] = useState('ppo.learning_rate'),
    [branchValue, setBranchValue] = useState(0.001),
    [branchIndex, setBranchIndex] = useState('0'),
    [resetOpt, setResetOpt] = useState(false);
  const [parameterEdit, setParameterEdit] = useState<ParameterHandoff & { context: string }>(),
    [parentParameters, setParentParameters] = useState<Doc>();
  const parameterContext = JSON.stringify([detail?.id, checkpoint, traceId, s]);
  const parameterEditStale = !!parameterEdit && parameterEdit.context !== parameterContext;
  const [iterations, setIterations] = useState(1),
    [mode, setMode] = useState('train'),
    [notes, setNotes] = useState<Doc[]>([]),
    [note, setNote] = useState(''),
    [guess, setGuess] = useState(''),
    [explain, setExplain] = useState(''),
    [rollout, setRollout] = useState<Doc>();
  const [comparison, setComparison] = useState<Doc>(),
    [compareId, setCompareId] = useState(''),
    [evaluation, setEvaluation] = useState<Doc>(),
    [pathProbe, setPathProbe] = useState<Doc>(),
    [study, setStudy] = useState<Doc[]>([]),
    [studySeeds, setStudySeeds] = useState('11,23,37,53,71'),
    [studyBudget, setStudyBudget] = useState(4),
    [studyRunning, setStudyRunning] = useState(false);
  const studyStop = useRef(false),
    generation = useRef(0),
    traceGen = useRef(0),
    importRef = useRef<HTMLInputElement>(null),
    sliceController = useRef<AbortController>(undefined),
    sliceTask = useRef<string>('');
  const eventRequests = useRef(new Map<string, Promise<void>>());
  const autoSlice = useRef('');
  const pendingOperations = useRef(new Map<number, string>()),
    operationId = useRef(0);
  const run = useCallback(async (label: string, action: () => Promise<void>, clearPreviousError = true) => {
    const id = ++operationId.current;
    pendingOperations.current.set(id, label);
    setBusy(label);
    if (clearPreviousError) setError('');
    try {
      await action();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      pendingOperations.current.delete(id);
      setBusy([...pendingOperations.current.values()].at(-1) ?? '');
    }
  }, []);
  const list = async () => {
    const d = await api('/experiments');
    setExperiments(d);
    return d;
  };
  const loadTrace = useCallback(async (id: string) => {
    const rev = ++traceGen.current;
    const [idx, fr] = await Promise.all([api(`/traces/${id}/index`), api(`/traces/${id}/frames`)]);
    if (rev !== traceGen.current) return;
    setTraceId(id);
    setTrace(idx);
    setCache({});
    setFrames(fr.frames);
    setPrediction(undefined);
    setCheckpoint(idx.origin_checkpoint);
    setEvaluation(undefined);
    setRollout(undefined);
    setSurface(undefined);
    setBackward(false);
    setMissingPhase('');
    reset();
  }, []);
  const open = useCallback(
    async (id: string) => {
      const rev = ++generation.current;
      ++traceGen.current;
      setPlaying(false);
      setPrediction(undefined);
      setTrace(undefined);
      setTraceId('');
      setCache({});
      setFrames([]);
      setSurface(undefined);
      setEvaluation(undefined);
      setPathProbe(undefined);
      setRollout(undefined);
      setComparison(undefined);
      reset();
      const [d, cp, tr, nb] = await Promise.all([
        api(`/experiments/${id}`),
        api(`/experiments/${id}/checkpoints`),
        api(`/experiments/${id}/traces`),
        api(`/experiments/${id}/notebook`),
      ]);
      if (rev !== generation.current) return;
      setDetail(d);
      setCheckpoints(cp);
      setHistory(tr);
      setNotes(nb.notes);
      setCheckpoint(d.checkpoint);
      setTarget(d.physics.target_m);
      setPhysicsDamping(d.config.environment.damping);
      setMassScale(d.config.environment.mass_scale ?? 1);
      setResetEnvironment(false);
      setObservation(d.observation);
      setBranchPath(d.config.algorithm + '.learning_rate');
      setLossX(finalBias(d.architecture));
      setLossY(finalBias(d.architecture));
      setPath('actor');
      setJob(undefined);
      historyUrl(id);
      if (tr.length) await loadTrace(tr.at(-1).id);
    },
    [loadTrace],
  );
  function historyUrl(id: string, jid?: string) {
    const diagnostics =
      new URLSearchParams(window.location.search).get('diagnostics') === '1' ? '&diagnostics=1' : '';
    window.history.replaceState(null, '', `?experiment=${id}${jid ? '&job=' + jid : ''}${diagnostics}`);
  }
  useEffect(() => {
    run('连接科学计算服务', async () => {
      setHealth(await api('/health'));
      setConnection('已连接');
      await list();
      const q = new URLSearchParams(location.search),
        id = q.get('experiment');
      if (id) {
        await open(id);
        if (q.get('job')) {
          setJob(await api('/jobs/' + q.get('job')));
          historyUrl(id, q.get('job'));
        }
      }
    });
  }, []);
  const refresh = async () => {
    if (!detail) return;
    const [d, cp, tr] = await Promise.all([
      api(`/experiments/${detail.id}`),
      api(`/experiments/${detail.id}/checkpoints`),
      api(`/experiments/${detail.id}/traces`),
    ]);
    setDetail(d);
    setCheckpoints(cp);
    setHistory(tr);
    await list();
    if (tr.length && tr.at(-1).id !== traceId) await loadTrace(tr.at(-1).id);
  };
  useEffect(() => {
    if (!job || terminal(job.status)) return;
    let alive = true;
    let timer: any;
    const poll = async () => {
      try {
        const next = await api('/jobs/' + job.id);
        if (!alive) return;
        setConnection('已连接 · 任务状态同步');
        setJob(next);
        if (terminal(next.status)) {
          await refresh();
          return;
        }
      } catch (e) {
        setError('任务状态/产物同步失败：' + String(e));
        if (alive) setConnection('连接中断 · 正在重连（不推断任务成功）');
      }
      if (alive) timer = setTimeout(poll, 650);
    };
    poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [job?.id, job?.status]);
  const events: Doc[] = prediction?.events ?? trace?.events ?? [],
    event = prediction?.events?.[s.event] ?? cache[s.event];
  const getEvent = useCallback(
    async (i: number) => {
      if (!traceId || cache[i]) return;
      const key = `${traceId}/${i}`;
      if (eventRequests.current.has(key)) return eventRequests.current.get(key);
      const revision = traceGen.current;
      const pending = (async () => {
        const e = await api(`/traces/${traceId}/events/${i}`);
        if (revision === traceGen.current) setCache((c) => ({ ...c, [i]: e }));
      })();
      eventRequests.current.set(key, pending);
      try {
        await pending;
      } finally {
        eventRequests.current.delete(key);
      }
    },
    [traceId, cache],
  );
  useEffect(() => {
    if (traceId && !prediction && !cache[s.event]) run('读取实际事件', () => getEvent(s.event), false);
  }, [traceId, s.event, prediction]);
  useEffect(() => {
    if (view !== 'network' || prediction || !trace) return;
    const indices = trace.events
      .map((e: Doc, i: number) =>
        e.kind === 'layer' &&
        (path === 'all' || e.label.startsWith(path + '/') || e.label.startsWith(path + '_actor_path/'))
          ? i
          : -1,
      )
      .filter((i) => i >= 0);
    Promise.all(indices.map(getEvent)).catch((e) => setError(String(e)));
  }, [view, path, traceId, prediction]);
  const loadedEvents = prediction?.events ?? events.map((e, i) => cache[i] ?? e),
    sampleIds = trace?.batch?.sample_id?.shape
      ? [...frames.map((f) => f.sample_id)]
      : frames.map((f) => f.sample_id);
  const selectedFrame = frames[s.sample],
    frame =
      selectedFrame?.after ??
      (selectedFrame?.schema === 'policyglass.physics.v1' ? selectedFrame : detail?.physics);
  // Snapshot every numerical condition. Display-only Q fields are deliberately
  // excluded. Raw index drafts remain safe to edit; validation runs on compute.
  const sliceRequest = {
    experiment: detail?.id,
    kind: view === 'q' ? 'q' : 'loss',
    sample: s.sample,
    traceId,
    body:
      view === 'q'
        ? {
            checkpoint,
            axes,
            fixed_action: fixed,
            observation: frame ? observationOf(selectedFrame?.before ?? frame) : detail?.observation,
            resolution,
          }
        : {
            checkpoint,
            path_x: lossX,
            index_x: lossIX.trim() ? lossIX.split(',').map(Number) : [],
            path_y: lossY,
            index_y: lossIY.trim() ? lossIY.split(',').map(Number) : [],
            ...(checkpoint === trace?.origin_checkpoint ? { trace_id: traceId } : {}),
            extent,
            resolution: Math.min(resolution, 31),
          },
  };
  const sliceKey = JSON.stringify({ view, ...sliceRequest });
  const currentSliceKey = useRef(sliceKey);
  currentSliceKey.current = sliceKey;
  const surface = surfaceData?.key === sliceKey ? surfaceData.result : undefined;
  const surfaceStale =
    (!!surfaceData && surfaceData.key !== sliceKey) || (!!sliceAttempt && sliceAttempt !== sliceKey);
  const surfaceRequest = surfaceData?.request;
  const surfaceLabels =
    surface &&
    (surfaceRequest.kind === 'q'
      ? surface.axes.map((axis: number) => `动作 a[${axis}] · Nm`)
      : surface.directions.map((d: Doc) => `Δ ${d.path}[${d.index.join(',')}]`));
  useEffect(() => {
    if (panel !== 'branch' || branchKind !== 'parameter' || !detail) return;
    let alive = true;
    setParentParameters(undefined);
    api(`/experiments/${detail.id}/parameters?checkpoint=${checkpoint}`)
      .then((parameters) => {
        if (alive) setParentParameters({ experiment: detail.id, checkpoint, parameters });
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, [panel, branchKind, detail?.id, checkpoint]);
  const parentParameter = (() => {
    if (parentParameters?.experiment !== detail?.id || parentParameters?.checkpoint !== checkpoint) return;
    try {
      const [model, parameter] = branchPath.split('/');
      return at(parentParameters.parameters[model]?.[parameter], parseIndex(branchIndex));
    } catch {
      return undefined;
    }
  })();
  useEffect(() => {
    if (!playing || reduced || frames.length < 2) return;
    const t = setInterval(
      () => select({ sample: (useLab.getState().selection.sample + 1) % frames.length }),
      400,
    );
    return () => clearInterval(t);
  }, [playing, reduced, frames.length]);
  useEffect(() => {
    sliceController.current?.abort();
    if (sliceTask.current) api(`/slice-jobs/${sliceTask.current}/cancel`, {}).catch(() => {});
  }, [sliceKey]);
  useEffect(() => {
    if (view === 'loss' && trace) {
      const index = trace.events.findIndex((e) => e.kind === 'optimizer' && e.label === 'actor');
      if (index >= 0) getEvent(index).catch((e) => setError(String(e)));
    }
  }, [view, traceId]);
  const chooseEvent = (i: number) => {
    const e = events[i];
    if (e?.kind === 'layer') {
      const [model, l] = e.label.split('/layer');
      select({ event: i, model, layer: +l });
      setPath(model.replace('_actor_path', ''));
    } else select({ event: i });
    if (e?.kind === 'backward' || e?.kind === 'optimizer' || e?.kind === 'sample_gradients')
      setBackward(true);
  };
  const start = async () => {
    if (!detail) return;
    setNotice('');
    setMissingPhase('');
    setPrediction(undefined);
    const j = await api(`/experiments/${detail.id}/jobs`, { iterations, record: true, mode });
    setJob(j);
    historyUrl(detail.id, j.id);
  };
  const startForward = () => {
    setNotice('');
    setPath('actor');
    select({ model: 'actor', layer: 0, neuron: 0, input: 0 });
    return run('实际 Actor 前向', predict);
  };
  const predict = async () => {
    const p = await api(`/experiments/${detail.id}/predict`, { observation, noise, checkpoint });
    setPrediction({ ...p, source_checkpoint: checkpoint });
    setTraceId(p.trace_id);
    setTrace(p);
    setCache({});
    setFrames([]);
    setHistory(await api(`/experiments/${detail.id}/traces`));
    select({ event: p.events.findIndex((e: Doc) => e.kind === 'policy_operation'), sample: 0 });
    setBackward(false);
    setMissingPhase('');
    setView('network');
    setNotice('实时前向已完成 · 参数与物理未更新');
  };
  const branch = async () => {
    if (branchKind === 'parameter' && (parameterEditStale || !Number.isFinite(parentParameter)))
      throw Error('参数来源已变化或父状态尚未加载；请从网络重新选择参数。');
    const child = await api(`/experiments/${detail.id}/branches`, {
      checkpoint,
      label: `${detail.label} · ${branchPath}=${branchValue}`,
      intervention: {
        kind: branchKind,
        path: branchPath,
        value: branchValue,
        index: branchKind === 'hyperparameter' ? [] : parseIndex(branchIndex),
        reset_optimizer: resetOpt,
      },
    });
    await list();
    await open(child.id);
    setNotice('已创建独立分支；选择 fixed_batch 隔离重算，或 train 重新采样续训。');
  };
  const physicsBranch = async () => {
    const result = await api(`/experiments/${detail.id}/physics-branches`, {
      target,
      force_newtons: force,
      force_steps: forceSteps,
      steps: physicsSteps,
      action: [0, 0, 0],
      label: detail.label + ' · 物理干预',
      ...(resetEnvironment
        ? { reset_environment: true, damping: physicsDamping, mass_scale: massScale }
        : {}),
    });
    await list();
    await open(result.experiment.id);
    setFrames(result.frames);
    setNotice('物理干预已记录为子分支；物理编辑使旧训练批次失效。');
  };
  const calculateSlice = async () => {
    if (view === 'loss') {
      parseIndex(lossIX);
      parseIndex(lossIY);
    }
    sliceController.current?.abort();
    const controller = new AbortController();
    sliceController.current = controller;
    setSurface(undefined);
    setSliceAttempt(sliceKey);
    const request = JSON.parse(JSON.stringify(sliceRequest));
    const key = sliceKey;
    const { kind, body } = request;
    let task: Doc | undefined;
    try {
      task = await api(`/experiments/${request.experiment}/slice-jobs`, { kind, [kind]: body });
      if (controller.signal.aborted || currentSliceKey.current !== key) {
        await api(`/slice-jobs/${task.id}/cancel`, {});
        return;
      }
      sliceTask.current = task.id;
      let current = task;
      while (!terminal(current.status)) {
        if (controller.signal.aborted) {
          await api(`/slice-jobs/${task.id}/cancel`, {});
          setNotice('已请求服务端取消；损失切片在网格点边界停止。');
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
        current = await api(`/slice-jobs/${task.id}`);
      }
      if (
        controller.signal.aborted ||
        currentSliceKey.current !== key ||
        sliceController.current !== controller
      )
        return;
      if (current.status === 'failed') throw Error(current.error);
      if (current.status === 'cancelled') return;
      setSurface({
        result: current.result,
        key,
        request,
      });
      setPick([Math.floor(current.result.x.length / 2), Math.floor(current.result.y.length / 2)]);
    } finally {
      if (sliceTask.current === task?.id) sliceTask.current = '';
    }
  };
  useEffect(() => {
    if (!detail || busy || (job && !terminal(job.status)) || surface) return;
    const lossSourceReady =
      detail.has_batch &&
      (checkpoint === detail.checkpoint || (traceId && checkpoint === trace?.origin_checkpoint));
    if (!(view === 'q' && detail.config.algorithm === 'sac') && !(view === 'loss' && lossSourceReady)) return;
    const key = [detail.id, checkpoint, traceId, s.sample, view].join(':');
    if (autoSlice.current === key) return;
    autoSlice.current = key;
    run('真实切片计算（固定条件）', calculateSlice);
  }, [view, detail?.id, detail?.has_batch, checkpoint, traceId, s.sample, busy, job?.status]);
  const saveNote = async () => {
    if (!note.trim() || !detail) return;
    if (course >= 0 && (!guess.trim() || !explain.trim() || !traceId || !event?.id))
      throw Error('课程记录需要预测、结合实际数字的解释，以及一个已计算并保存的来源事件。');
    const n = {
      text: note,
      prediction: guess,
      explanation: explain,
      course: course + 1,
      experiment_id: detail.id,
      checkpoint:
        prediction?.source_checkpoint ?? (event ? trace?.origin_checkpoint : checkpoint) ?? checkpoint,
      trace_id: traceId,
      event_id: event?.id ?? '',
      sample_id: sampleIds[s.sample] ?? 0,
      created: new Date().toISOString(),
    };
    const saved = await api(`/experiments/${detail.id}/notebook`, { notes: [...notes, n] });
    setNotes(saved.notes);
    setNote('');
    setNotice('已保存到 D 盘实验笔记，并保留事件引用。');
  };
  const exportWork = async () => {
    const response = await fetch(`/api/checkpoints/${checkpoint}/download`);
    if (!response.ok) throw Error('检查点下载失败');
    const blob = await response.blob();
    download(`${detail.label}.pgwork`, {
      schema: 'policyglass.workspace.v1',
      checkpoint: await encodeBlob(blob),
      notebook: { notes },
      source: { experiment: detail.id, checkpoint, trace: traceId },
      scope:
        'contains validated checkpoint and referenced notebook; historical trace IDs retain original provenance; recompute after import',
      forward_input: prediction
        ? { observation: prediction.observation, noise: prediction.noise[0] }
        : trace?.phase === 'forward_only_no_parameter_update'
          ? { observation: trace.observation, noise: trace.noise[0] }
          : undefined,
    });
    setNotice('工作包已导出：完整检查点与笔记；导入后可 fixed_batch 重新计算 Trace。');
  };
  const importWork = async (file: File) => {
    if (file.size > 180 * 1024 * 1024) throw Error('导入超过 180MB 预算');
    let bytes: Uint8Array, notebook: any, forwardInput: any;
    if (file.name.endsWith('.pgwork')) {
      const d = JSON.parse(await file.text());
      if (d.schema !== 'policyglass.workspace.v1' || typeof d.checkpoint !== 'string')
        throw Error('工作包 schema 错误');
      bytes = decodeBlob(d.checkpoint);
      notebook = d.notebook;
      forwardInput = d.forward_input;
    } else bytes = new Uint8Array(await file.arrayBuffer());
    const r = await fetch('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: bytes as any,
    });
    const result = await r.json();
    if (!r.ok) throw Error(JSON.stringify(result.detail));
    if (notebook) await api(`/experiments/${result.experiment.id}/notebook`, notebook);
    await list();
    await open(result.experiment.id);
    if (
      forwardInput &&
      Array.isArray(forwardInput.observation) &&
      forwardInput.observation.length === 15 &&
      Array.isArray(forwardInput.noise) &&
      forwardInput.noise.length === 3 &&
      [...forwardInput.observation, ...forwardInput.noise].every(Number.isFinite)
    ) {
      setObservation(forwardInput.observation);
      setNoise(forwardInput.noise);
      setPanel('predict');
    }
    setNotice('已验证并导入新实验。原笔记引用保留来源 ID；可重算生成此实验的新事件。');
  };
  const compare = async () => {
    const d = await api(`/experiments/${compareId}`),
      tr = await api(`/experiments/${compareId}/traces`);
    const idx = tr.length ? await api(`/traces/${tr.at(-1).id}/index`) : null;
    const objectives = idx
      ? await Promise.all(
          idx.events
            .map((e: Doc, i: number) =>
              e.kind === 'objective' ? api(`/traces/${tr.at(-1).id}/events/${i}`) : null,
            )
            .filter(Boolean),
        )
      : [];
    const [a, b] = await Promise.all([
      api(`/experiments/${detail.id}/parameters`),
      api(`/experiments/${compareId}/parameters`),
    ]);
    const av = numeric(Object.values(a).flatMap(Object.values)),
      bv = numeric(Object.values(b).flatMap(Object.values));
    setComparison({
      detail: d,
      index: idx,
      objectives,
      parameter_diff:
        av.length === bv.length && JSON.stringify(detail.architecture) === JSON.stringify(d.architecture)
          ? av.reduce((largest, v, i) => Math.max(largest, Math.abs(v - bv[i])), 0)
          : null,
    });
  };
  const evaluate = async () => {
    const result = await api(`/experiments/${detail.id}/evaluate`, {
      checkpoint,
      seeds: [701, 702, 703],
      steps: 64,
    });
    setEvaluation(result);
    setTrace(undefined);
    setTraceId('');
    setCache({});
    setPrediction(undefined);
    reset();
    setFrames(result.results[0].frames);
    select({ sample: 0 });
    setView('arm');
  };
  const launchStudy = async () => {
    const seeds = studySeeds.split(',').map(Number);
    if (
      seeds.length < 5 ||
      seeds.length > 5 ||
      seeds.some((v) => !Number.isInteger(v) || v < 0) ||
      new Set(seeds).size !== 5
    )
      throw Error('请预登记五个不同的非负整数种子');
    setStudyRunning(true);
    studyStop.current = false;
    const rows: Doc[] = [];
    setStudy([]);
    try {
      for (const seed of seeds)
        for (const ratio of [1, 4]) {
          if (studyStop.current) return;
          const started = performance.now(),
            row: Doc = { seed, ratio, status: '创建中' };
          rows.push(row);
          setStudy([...rows]);
          try {
            const config = JSON.parse(JSON.stringify(detail.config));
            config.algorithm = 'sac';
            config.seed = seed;
            config.sac.updates_per_step = ratio;
            const exp = await api('/experiments', { label: `复用实验 seed${seed} ratio${ratio}`, config });
            row.id = exp.id;
            const j = await api(`/experiments/${exp.id}/jobs`, {
              iterations: studyBudget,
              record: true,
              mode: 'train',
            });
            row.job = j.id;
            let current = j;
            while (!terminal(current.status)) {
              if (studyStop.current) {
                await api(`/jobs/${j.id}/control/cancel`, {});
                row.status = '已请求取消';
                setStudy([...rows]);
                return;
              }
              await new Promise((r) => setTimeout(r, 600));
              current = await api('/jobs/' + j.id);
              row.status = current.status;
              row.completed = current.completed;
              setStudy([...rows]);
            }
            row.summary = current.summary;
            row.status = current.status;
            row.error = current.error;
            if (current.status === 'completed') {
              row.evaluation = await api(`/experiments/${exp.id}/evaluate`, {
                seeds: [701, 702, 703],
                steps: 64,
              });
              row.distance = row.evaluation.results.reduce((a, r) => a + r.mean_distance_m, 0) / 3;
            }
            row.seconds = (performance.now() - started) / 1000;
          } catch (e) {
            row.status = 'failed';
            row.error = String(e);
          }
          setStudy([...rows]);
        }
      await list();
    } finally {
      setStudyRunning(false);
      download('replay-study-actual.json', {
        seeds,
        ratios: [1, 4],
        iterations: studyBudget,
        rows,
        scope: 'short-budget actual experiment; all failures included',
      });
    }
  };
  const actorOpt = loadedEvents.find((e) => e.kind === 'optimizer' && e.label === 'actor' && e.parameters),
    projection =
      surface && view === 'loss' && actorOpt && checkpoint === trace?.origin_checkpoint
        ? projectedUpdate(
            actorOpt,
            surface.directions.map((d) => d.path),
            surface.directions.map((d) => d.index),
          )
        : null;
  const active = job && !terminal(job.status),
    origin = trace?.origin_checkpoint === checkpoint;
  const sourceLabel = prediction
    ? '实时前向 · 不更新'
    : evaluation
      ? '冻结策略评估 · 无学习'
      : trace?.phase === 'forward_only_no_parameter_update'
        ? '历史前向记录 · 不更新'
        : traceId
          ? '历史 Trace 回放'
          : frames.length
            ? '物理分支记录'
            : '完整检查点状态';
  const forwardOnly = !!prediction || trace?.phase === 'forward_only_no_parameter_update';
  const nextEvent = events.findIndex((e) =>
    forwardOnly ? e.kind === 'layer' && e.label === 'actor/layer0' : e.kind === 'optimizer',
  );
  const inspectComputed = async () => {
    if (nextEvent < 0) return;
    if (!prediction) await getEvent(nextEvent);
    chooseEvent(nextEvent);
    setView('network');
    setPanel('inspect');
    setMissingPhase('');
  };
  const computeState = busy.includes('前向')
    ? '前向计算中'
    : busy.includes('提交')
      ? '正在提交真实更新'
      : busy
        ? busy
        : active
          ? job.status === 'paused'
            ? '已暂停'
            : '真实任务计算中'
          : forwardOnly && nextEvent >= 0
            ? '前向可检查 · 无参数更新'
            : job?.status === 'failed'
              ? '任务失败，可重试'
              : job?.status === 'cancelled'
                ? '任务已取消'
                : nextEvent >= 0
                  ? forwardOnly
                    ? '前向可检查 · 无参数更新'
                    : '真实更新可检查'
                  : '待运行';
  return (
    <div
      className={
        'app' + (reduced ? ' reduced' : '') + (networkFocus && view === 'network' ? ' network-focus' : '')
      }
    >
      <a className="skip-link" href="#experiment-content">
        跳到实验内容
      </a>
      <header className="topbar">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            setDetail(undefined);
            historyUrl('');
          }}
        >
          <span className="brand-mark">
            <Layers3 size={23} />
          </span>
          <span>
            策镜 <b>PolicyGlass</b>
          </span>
          <span className="beta">LAB 03</span>
        </a>
        <nav aria-label="主导航">
          <button className={panel === 'inspect' ? 'nav-active' : ''} onClick={() => setPanel('inspect')}>
            实验工作台
          </button>
          <button className={panel === 'courses' ? 'nav-active' : ''} onClick={() => setPanel('courses')}>
            <BookOpen size={15} />
            机制课程 <small>8</small>
          </button>
          <button onClick={() => setPanel('notes')}>实验笔记</button>
        </nav>
        <div className="connection">
          <i className={health ? 'dot' : ''} />
          {connection}
          <span>CPU · Float64</span>
        </div>
      </header>
      <div className="pagebar">
        <div>
          <span className="eyebrow">REINFORCEMENT LEARNING / MECHANISM LAB</span>
          <h1>{detail ? detail.label : '从一个动作，看见学习的内部。'}</h1>
          <p>
            {detail
              ? `${detail.config.algorithm.toUpperCase()} · ${detail.config.network.hidden.join(' × ')} · seed ${detail.config.seed} · 理想刚体实验`
              : '连接真实行为、计算张量与参数更新，用数值检验你的解释。'}
          </p>
        </div>
        <div className="actions">
          <input
            ref={importRef}
            type="file"
            accept=".pgz,.pgwork"
            hidden
            onChange={(e) => {
              if (e.target.files?.[0]) run('校验并导入', () => importWork(e.target.files![0]));
              e.target.value = '';
            }}
          />
          <button onClick={() => importRef.current?.click()}>
            <Upload size={15} />
            导入实验
          </button>
          {detail && (
            <button onClick={() => run('导出工作包', exportWork)} disabled={!!busy}>
              <Download size={15} />
              导出
            </button>
          )}
          <button className="primary" onClick={() => setCreateOpen(true)}>
            <Plus size={16} />
            新建实验
          </button>
        </div>
      </div>
      {error && !detail && (
        <div className="alert error" role="alert">
          <strong>操作未完成</strong> {error}
          <button onClick={() => setError('')} aria-label="关闭错误">
            <X size={14} />
          </button>
        </div>
      )}
      {notice && (
        <div className="alert" role="status">
          <Check size={15} />
          {notice}
          <button onClick={() => setNotice('')} aria-label="关闭提示">
            <X size={14} />
          </button>
        </div>
      )}
      {busy && (
        <div className="busy" role="status">
          <span className="spinner" />
          {busy}
        </div>
      )}
      {!detail ? (
        <main className="home" id="experiment-content" tabIndex={-1}>
          <section className="intro">
            <div className="eyebrow">MAKE EVERY UPDATE EXPLAINABLE</div>
            <h2>
              动作有来源。
              <br />
              更新有证据。
            </h2>
            <p>暂停一次真实计算，把样本、网络、损失和优化器放在同一条证据链上。再改变一个条件，重新计算。</p>
            <button className="primary" onClick={() => setCreateOpen(true)}>
              <FlaskConical size={17} />
              创建第一个实验 <ArrowRight size={17} />
            </button>
            <div className="intro-foot">PPO / SAC · PyTorch · MuJoCo 4.0.1 · 本地运行</div>
          </section>
          <section className="recent">
            <div className="section-heading">
              <h2>最近实验</h2>
              <span>{experiments.length} 个</span>
            </div>
            {experiments.length ? (
              experiments.slice(0, 8).map((e) => (
                <button
                  className="experiment-card"
                  key={e.id}
                  onClick={() => run('打开检查点', () => open(e.id))}
                >
                  <span className="algo">{e.config.algorithm.toUpperCase()}</span>
                  <span>
                    <b>{e.label}</b>
                    <small>
                      seed {e.config.seed} · {e.config.network.hidden.join(' × ')} ·{' '}
                      {new Date(e.created * 1000).toLocaleString('zh-CN')}
                    </small>
                  </span>
                  <ArrowRight size={18} />
                </button>
              ))
            ) : (
              <div className="empty">
                <Box size={36} />
                <p>还没有实验。创建时会生成真实网络与物理状态。</p>
              </div>
            )}
          </section>
          <section className="home-courses">
            <div className="section-heading">
              <h2>八个机制实验</h2>
              <span>预测 → 操作 → 证据 → 解释</span>
            </div>
            <div className="course-grid">
              {courses.map((c, i) => (
                <button
                  key={c.title}
                  onClick={() => {
                    setCourse(i);
                    setPanel('courses');
                    setCreateOpen(true);
                  }}
                >
                  <small>{c.tag}</small>
                  <h3>{c.title}</h3>
                  <span>
                    {c.algorithm.toUpperCase()} <ArrowRight size={15} />
                  </span>
                </button>
              ))}
            </div>
          </section>
          <StudyLibrary
            onOpen={async (id) => {
              await list();
              await open(id);
            }}
          />
        </main>
      ) : (
        <>
          <div className="experiment-strip">
            <label>
              打开实验
              <select
                aria-label="打开实验"
                value={detail.id}
                onChange={(e) => run('切换实验', () => open(e.target.value))}
              >
                {experiments.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="metric">
              <small>环境交互</small>
              <b>{detail.env_steps}</b>
              <span>steps</span>
            </div>
            <div className="metric">
              <small>优化更新</small>
              <b>{detail.updates}</b>
              <span>updates</span>
            </div>
            <div className="metric">
              <small>物理时间</small>
              <b>{fmt(frame?.time_s)}</b>
              <span>s</span>
            </div>
            <div className="metric source-metric">
              <small>当前来源</small>
              <b>{sourceLabel}</b>
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={reduced}
                onChange={(e) => {
                  setReduced(e.target.checked);
                  setPlaying(false);
                }}
              />
              减弱动效
            </label>
          </div>
          <section className="runbar" aria-label="真实计算控制" data-testid="compute-bar">
            <div className="run-state" role="status" data-testid="compute-state">
              <strong>{computeState}</strong>
              <small>
                {sourceLabel} · {checkpoint.slice(0, 10)} · {connection}
              </small>
            </div>
            <button disabled={!!busy || active} onClick={startForward} data-testid="first-forward">
              <Network size={17} />
              <span>
                看一次 Actor 前向<small>参数不更新 · 不推进物理</small>
              </span>
            </button>
            <button
              className="primary"
              disabled={!!busy || active}
              data-testid="first-update"
              onClick={() => run(mode === 'train' ? '提交真实训练任务' : '提交固定批次反事实', start)}
            >
              <Play size={17} />
              <span>
                {detail.env_steps ? '继续计算' : '启动计算'}
                <small>记录真实更新 · 会更新当前实验</small>
              </span>
            </button>
            <button
              disabled={!!busy || active || nextEvent < 0}
              onClick={() => run('定位实际计算事件', inspectComputed)}
              data-testid="inspect-computed"
            >
              {forwardOnly ? '检查 Actor 前向' : '检查实际参数更新'}
              <ArrowRight size={16} />
            </button>
            <div className="run-secondary">
              <details className="run-options">
                <summary>预算与计算模式</summary>
                <div className="run-controls">
                  <select
                    aria-label="计算模式"
                    disabled={active}
                    value={mode}
                    onChange={(e) => setMode(e.target.value)}
                  >
                    <option value="train">train · 重新采样续训</option>
                    <option value="fixed_batch">fixed_batch · 固定批次反事实</option>
                  </select>
                  <input
                    aria-label="训练迭代预算"
                    type="number"
                    min="1"
                    max="100"
                    value={iterations}
                    disabled={active}
                    onChange={(e) => setIterations(+e.target.value)}
                  />
                  <span>迭代 · 按当前预算计算</span>
                </div>
              </details>
              <div className="job-state" data-testid="job-status">
                {job ? `${job.status} · ${job.completed}/${job.iterations} · ${job.mode}` : '尚无更新任务'}
                {job?.control === 'pause' && job.status !== 'paused' ? ' · 等待安全边界暂停' : ''}
                {job?.error && <strong>{job.error}</strong>}
              </div>
              <div className="run-controls">
                <button
                  aria-label="暂停任务"
                  disabled={!active || job?.status === 'paused'}
                  onClick={() =>
                    run('请求安全边界暂停', async () =>
                      setJob(await api(`/jobs/${job.id}/control/pause`, {})),
                    )
                  }
                >
                  <Pause size={16} />
                </button>
                <button
                  aria-label="恢复任务"
                  disabled={job?.status !== 'paused'}
                  onClick={() =>
                    run('恢复同一任务', async () => setJob(await api(`/jobs/${job.id}/control/run`, {})))
                  }
                >
                  <Play size={16} />
                </button>
                <button
                  aria-label="取消任务"
                  disabled={!active}
                  onClick={() =>
                    run('请求安全边界取消', async () =>
                      setJob(await api(`/jobs/${job.id}/control/cancel`, {})),
                    )
                  }
                >
                  <X size={16} />
                </button>
                <button aria-label="重连并刷新" onClick={() => run('重连并读取完整状态', refresh)}>
                  <RotateCcw size={15} />
                </button>
              </div>
            </div>
            {error && (
              <div className="run-error" role="alert">
                <strong>操作未完成</strong> {error}
                <button aria-label="关闭错误" onClick={() => setError('')}>
                  <X size={14} />
                </button>
              </div>
            )}
          </section>
          <main className="workspace" id="experiment-content" tabIndex={-1}>
            <aside className="leftbar">
              <div className="section-heading">
                <h3>计算导航</h3>
                <Settings2 size={15} />
              </div>
              <div className="steps">
                {['forward', 'loss', 'backward', 'optimizer'].map((phase, i) => (
                  <button
                    key={phase}
                    disabled={!!busy}
                    aria-label={['前向传播', '目标与损失', '梯度反传', '参数更新'][i]}
                    onClick={() => {
                      const index = events.findIndex((e) =>
                        phase === 'forward'
                          ? e.kind === 'observation_transform'
                          : phase === 'loss'
                            ? e.kind === 'objective'
                            : e.kind === phase,
                      );
                      if (index >= 0) chooseEvent(index);
                      else {
                        setNotice('');
                        setMissingPhase(phase);
                      }
                    }}
                  >
                    <span>0{i + 1}</span>
                    {['前向传播', '目标与损失', '梯度反传', '参数更新'][i]}
                  </button>
                ))}
              </div>
              {missingPhase && (
                <div className="phase-guide" role="status" data-testid="phase-guide">
                  <b>{missingPhase === 'forward' ? '前向尚未计算' : '此阶段需要一次带梯度的真实更新'}</b>
                  <p>
                    {missingPhase === 'forward'
                      ? '只运行 Actor 前向即可检查网络；参数和环境交互计数不增长。'
                      : '仅前向记录不含学习目标、反传或 Adam 更新。记录一次真实更新后再检查。'}
                  </p>
                  <button
                    disabled={!!busy || active}
                    onClick={missingPhase === 'forward' ? startForward : () => run('提交真实训练任务', start)}
                  >
                    {missingPhase === 'forward' ? '运行 Actor 前向' : '记录真实更新'}
                  </button>
                </div>
              )}
              <div className="section-heading">
                <h3>事件时间线</h3>
                <span>{events.length}</span>
              </div>
              <select
                aria-label="选择历史Trace"
                value={traceId}
                onChange={(e) => run('读取历史 Trace', () => loadTrace(e.target.value))}
              >
                <option value="">选择一次真实更新</option>
                {history.map((h, i) => (
                  <option key={h.id} value={h.id}>
                    #{i + 1} · {h.id.slice(0, 8)}
                  </option>
                ))}
              </select>
              <div className="event-list">
                {events.length ? (
                  events.map((e, i) => (
                    <button
                      key={e.id}
                      className={s.event === i ? 'selected' : ''}
                      onClick={() => chooseEvent(i)}
                    >
                      <span className={'event-dot ' + e.kind} />
                      <span>
                        <b>{e.label}</b>
                        <small>
                          {e.kind} · {e.id}
                        </small>
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="muted">启动训练或执行前向预测后，事件将从真实计算生成。</p>
                )}
              </div>
              <div className="boundary-note">环境轨迹提供奖励和观测。标准 PPO / SAC 不穿过物理引擎反传。</div>
            </aside>
            <section className="central">
              <div
                className="view-tabs"
                role="tablist"
                aria-label="可视化视图"
                onKeyDown={(e) => {
                  const buttons = Array.from(
                    e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
                  );
                  const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
                  const target =
                    e.key === 'Home'
                      ? 0
                      : e.key === 'End'
                        ? buttons.length - 1
                        : e.key === 'ArrowRight'
                          ? (current + 1) % buttons.length
                          : e.key === 'ArrowLeft'
                            ? (current + buttons.length - 1) % buttons.length
                            : -1;
                  if (target >= 0) {
                    e.preventDefault();
                    buttons[target].focus();
                    buttons[target].click();
                  }
                }}
              >
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    role="tab"
                    id={'view-tab-' + t.id}
                    aria-controls={'view-panel-' + t.id}
                    tabIndex={view === t.id ? 0 : -1}
                    aria-selected={view === t.id}
                    className={view === t.id ? 'active' : ''}
                    onClick={() => setView(t.id)}
                  >
                    <t.icon size={17} />
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="viewport-heading">
                <div>
                  <span className="eyebrow">{tabs.find((t) => t.id === view)?.caption}</span>
                  <h2>
                    {view === 'arm'
                      ? '空间机械臂'
                      : view === 'network'
                        ? 'Actor–Critic 计算结构'
                        : view === 'q'
                          ? '双 Q 的动作切片'
                          : '局部损失的坐标切片'}
                  </h2>
                </div>
                <span className="status-pill">{sourceLabel}</span>
              </div>
              {(view === 'q' || view === 'loss') && surfaceStale && (
                <div className="callout surface-status" role="status" data-testid="surface-stale">
                  设置已变更，待重算。旧结果已隐藏；点击“计算真实切片”生成当前条件的网格。
                </div>
              )}
              {surface && (
                <div className="surface-provenance" data-testid="surface-provenance">
                  <b>
                    已计算结果：x = {surfaceLabels[0]}；y = {surfaceLabels[1]}
                  </b>
                  <span>
                    结果检查点 {surfaceRequest.body.checkpoint} · 样本 {surfaceRequest.sample} ·{' '}
                    {surface.x.length} × {surface.y.length} 网格
                  </span>
                  <span>
                    x：{fmt(surface.x[0])} … {fmt(surface.x.at(-1))}；y：{fmt(surface.y[0])} …{' '}
                    {fmt(surface.y.at(-1))}
                  </span>
                  {view === 'q' ? (
                    <>
                      <span>
                        未绘动作固定：
                        {surface.fixed_action
                          .map((v: number, i: number) =>
                            surface.axes.includes(i) ? null : `a[${i}]=${v} Nm`,
                          )
                          .filter(Boolean)
                          .join('；')}
                      </span>
                      <details>
                        <summary>固定状态 observation（来自所选经验 before 或实验状态）</summary>
                        <p>{surface.observation.join(', ')}</p>
                      </details>
                    </>
                  ) : (
                    <>
                      <span>
                        参数偏移 ±{surfaceRequest.body.extent}；批次、目标、噪声、其余参数、Critic / α 固定。
                      </span>
                      <span>
                        {surfaceRequest.body.trace_id
                          ? `Trace ${surfaceRequest.body.trace_id}；Actor / α 与批次来自 origin。${surface.critic_version === 'after_recorded_critic_step' ? 'SAC Critic 来自该 Trace 的实际 critic 更新后阶段。' : '独立 Value 不参与 Actor 目标。'}`
                          : '批次与全部模型来自该完整检查点。'}
                      </span>
                    </>
                  )}
                </div>
              )}
              <Scenes
                {...{
                  view,
                  frame,
                  geometry: detail.geometry,
                  frames,
                  compare: comparison?.detail.physics,
                  target,
                  onTarget: setTarget,
                  drag,
                  architecture: detail.architecture,
                  events: loadedEvents,
                  onEvent: chooseEvent,
                  expanded,
                  path,
                  surface,
                  surfaceLabels,
                  surfaceRequest,
                  onFields: setFields,
                  fields: view === 'loss' ? ['loss'] : fields,
                  onPick: (i, j) => {
                    if (surface)
                      setPick([boundedIndex(i, surface.x.length), boundedIndex(j, surface.y.length)]);
                  },
                  gridPick: pick,
                  marker: projection?.delta,
                  gradient: projection
                    ? surface.directions.map(
                        (d) =>
                          -actorOpt.lr *
                          at(actorOpt.parameters?.[d.path.split('/')[1]]?.raw_gradient, d.index),
                      )
                    : undefined,
                  backward,
                  onExpanded: setExpanded,
                  onPath: setPath,
                  experiment: detail.id,
                  checkpoint,
                  traceId,
                  traceMeta: trace,
                  focused: networkFocus,
                  onFocused: setNetworkFocus,
                  onDeepInspect: () => {
                    setNetworkFocus(false);
                    requestAnimationFrame(() => document.querySelector<HTMLElement>('.inspector')?.focus());
                  },
                  onParameter: (handoff: ParameterHandoff) => {
                    setNetworkFocus(false);
                    setBranchKind('parameter');
                    setBranchPath(handoff.path);
                    setBranchIndex(handoff.index.join(','));
                    setBranchValue(handoff.value);
                    setParameterEdit({ ...handoff, context: parameterContext });
                    setPanel('branch');
                    requestAnimationFrame(() =>
                      document
                        .querySelector<HTMLElement>('.branch-provenance')
                        ?.scrollIntoView({ block: 'center' }),
                    );
                  },
                  busy: !!busy || !!active,
                  onForward: startForward,
                  empty: (
                    <>
                      <span className="eyebrow">
                        {view === 'q' ? 'ACTION VALUE · SAC' : 'LOCAL LOSS · FIXED BATCH'}
                      </span>
                      <h3>
                        {busy.includes('切片')
                          ? '正在计算真实曲面…'
                          : view === 'q' && detail.config.algorithm !== 'sac'
                            ? '双 Q 属于 SAC'
                            : view === 'loss' && !detail.has_batch
                              ? '先记录一批真实学习数据'
                              : '从当前检查点计算曲面'}
                      </h3>
                      <p>
                        {view === 'q' && detail.config.algorithm !== 'sac'
                          ? '当前是 PPO，使用状态价值 V(s)。SAC 的两个 Critic 才定义 Q₁ / Q₂。'
                          : view === 'loss' && !detail.has_batch
                            ? '局部损失需要固定的真实批次、目标和噪声。记录一次更新后即可计算。'
                            : '每个网格点都会重新运行网络。坐标和高度来自当前实验的实际数值。'}
                      </p>
                      {busy.includes('切片') ? (
                        <button onClick={() => sliceController.current?.abort()}>取消曲面计算</button>
                      ) : view === 'q' && detail.config.algorithm !== 'sac' ? (
                        <button
                          className="primary"
                          onClick={() => {
                            setCourse(-1);
                            setCreateAlgorithm('sac');
                            setCreateOpen(true);
                          }}
                        >
                          新建 SAC 查看双 Q
                        </button>
                      ) : view === 'loss' && !detail.has_batch ? (
                        <button
                          className="primary"
                          disabled={!!busy || !!active}
                          onClick={() =>
                            run('记录真实批次', async () => {
                              const j = await api('/experiments/' + detail.id + '/jobs', {
                                iterations: 1,
                                record: true,
                                mode: 'train',
                              });
                              setJob(j);
                              historyUrl(detail.id, j.id);
                            })
                          }
                        >
                          {active ? '正在记录真实更新…' : '记录一次真实更新'}
                        </button>
                      ) : (
                        <button
                          className="primary"
                          disabled={!!busy}
                          onClick={() => run('真实切片计算（固定条件）', calculateSlice)}
                        >
                          计算并显示曲面
                        </button>
                      )}
                    </>
                  ),
                }}
              />
              <div className="viewport-footer">
                <span>
                  {view === 'arm'
                    ? '世界 Z 向上 · 长度 m · 力矩 Nm · 刚体位姿来自 MuJoCo'
                    : view === 'network'
                      ? '概念布局，非物理坐标。颜色：正值 + 青绿 / 负值 − 蓝；橙色为选择。'
                      : '图形轴按范围缩放；真实坐标与高度以数值表为准。'}
                </span>
                <span className="mono">
                  {frame?.engine_version && view === 'arm'
                    ? 'MUJOCO ' + frame.engine_version
                    : 'REAL COMPUTATION'}
                </span>
              </div>
              <div className="playback">
                <button aria-label="上一个样本" onClick={() => select({ sample: Math.max(0, s.sample - 1) })}>
                  <ArrowLeft size={16} />
                </button>
                <button
                  aria-label="播放历史样本"
                  disabled={!frames.length || reduced}
                  onClick={() => setPlaying(!playing)}
                >
                  {playing ? <Pause size={17} /> : <Play size={17} />}
                </button>
                <input
                  aria-label="样本回放位置"
                  type="range"
                  min="0"
                  max={Math.max(frames.length - 1, 0)}
                  value={s.sample}
                  onChange={(e) => {
                    setPlaying(false);
                    select({ sample: +e.target.value });
                  }}
                />
                <button
                  aria-label="下一个样本"
                  onClick={() => select({ sample: Math.min(Math.max(frames.length - 1, 0), s.sample + 1) })}
                >
                  <ArrowRight size={16} />
                </button>
                <code>
                  行 {s.sample} / {Math.max(frames.length - 1, 0)} · sample_id {sampleIds[s.sample] ?? '—'}
                </code>
              </div>
              <div className="tools">
                <div className="tool-tabs">
                  {[
                    ['inspect', '视图控制'],
                    ['predict', '前向实验'],
                    ['branch', '受控分支'],
                    ['compare', '对照比较'],
                    ['courses', '机制课程'],
                    ['notes', '引用与笔记'],
                    ['explanation', '数值讲解'],
                  ].map(([id, name]) => (
                    <button key={id} className={panel === id ? 'active' : ''} onClick={() => setPanel(id)}>
                      {name}
                    </button>
                  ))}
                </div>
                <div className="tool-content">
                  {panel === 'explanation' && (
                    <Explanation
                      experimentId={detail.id}
                      traceId={traceId}
                      eventIndex={s.event}
                      onLocate={chooseEvent}
                    />
                  )}
                  {panel === 'inspect' && (
                    <>
                      {view === 'arm' ? (
                        <>
                          <div className="section-heading">
                            <h3>物理干预 · 总是创建子分支</h3>
                            <label className="check">
                              <input
                                type="checkbox"
                                checked={drag}
                                onChange={(e) => setDrag(e.target.checked)}
                              />
                              在 3D 中拖动目标
                            </label>
                          </div>
                          <label className="check">
                            <input
                              type="checkbox"
                              checked={resetEnvironment}
                              onChange={(e) => setResetEnvironment(e.target.checked)}
                            />
                            更改质量/阻尼并显式重置环境（清除旧批次）
                          </label>
                          {resetEnvironment && (
                            <div className="field-row">
                              <NumberField
                                label="质量倍率"
                                value={massScale}
                                onChange={setMassScale}
                                min={0.25}
                                max={3}
                                step={0.1}
                              />
                              <NumberField
                                label="重置后阻尼 Nm·s/rad"
                                value={physicsDamping}
                                onChange={setPhysicsDamping}
                                min={0}
                                max={5}
                                step={0.05}
                              />
                            </div>
                          )}
                          <Vector label="目标位置 m" values={target} onChange={setTarget} />
                          <Vector label="外力 N · 世界轴 · 前臂质心" values={force} onChange={setForce} />
                          <div className="field-row">
                            <NumberField
                              label="力持续控制步"
                              value={forceSteps}
                              onChange={setForceSteps}
                              min={1}
                              max={128}
                            />
                            <NumberField
                              label="实际仿真控制步"
                              value={physicsSteps}
                              onChange={setPhysicsSteps}
                              min={0}
                              max={128}
                            />
                            <button onClick={() => run('执行真实物理分支', physicsBranch)} disabled={!!busy}>
                              记录并计算干预
                            </button>
                          </div>
                          <p className="small muted">
                            先拖动预览标记，再记录干预。目标须通过可达性检查；无驱动力矩为
                            [0,0,0]。质量/阻尼改变必须显式重置，不能伪装成连续运动。模型没有地面/自碰撞；屏幕网格仅为标尺。
                          </p>
                          <details>
                            <summary>二维物理状态与奖励分解</summary>
                            <RawTree
                              value={{
                                frame,
                                reward_parts: selectedFrame?.reward_parts,
                                geometry: detail.geometry,
                              }}
                            />
                          </details>
                          <button onClick={() => run('冻结策略独立评估', evaluate)}>
                            运行无学习评估（3 个登记种子）
                          </button>
                          {evaluation && (
                            <>
                              <p>真实冻结策略 · {fmt(evaluation.seconds)} s · 不改变训练状态</p>
                              <RawTree
                                value={{
                                  checkpoint: evaluation.checkpoint,
                                  action_rule: evaluation.action_rule,
                                  results: evaluation.results.map(({ frames, ...r }) => r),
                                }}
                              />
                            </>
                          )}
                        </>
                      ) : view === 'network' ? (
                        <>
                          <div className="field-row">
                            <label>
                              路径筛选
                              <select
                                aria-label="网络路径"
                                value={path}
                                onChange={(e) => setPath(e.target.value)}
                              >
                                <option value="all">所有模型</option>
                                {Object.keys(detail.architecture).map((k) => (
                                  <option key={k}>{k}</option>
                                ))}
                              </select>
                            </label>
                            <label className="check">
                              <input
                                type="checkbox"
                                checked={expanded}
                                onChange={(e) => setExpanded(e.target.checked)}
                              />
                              显示全部层间连接
                            </label>
                          </div>
                          <p className="muted small">
                            默认绘制各层的全部神经元和权重连线。单击节点或连接可检查
                            W[j,i]、b[j]、激活和来源；取消全部连线后仍保留神经元与选中单元的入边。
                          </p>
                          <RawTree value={detail.architecture} />
                        </>
                      ) : (
                        <>
                          <div className="field-row">
                            {view === 'q' ? (
                              <>
                                <label>
                                  动作轴 x
                                  <select
                                    aria-label="动作轴 x"
                                    value={axes[0]}
                                    onChange={(e) => setAxes([+e.target.value, axes[1]])}
                                  >
                                    {[0, 1, 2].map((n) => (
                                      <option key={n} value={n}>
                                        {n} · Nm
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label>
                                  动作轴 y
                                  <select
                                    aria-label="动作轴 y"
                                    value={axes[1]}
                                    onChange={(e) => setAxes([axes[0], +e.target.value])}
                                  >
                                    {[0, 1, 2].map((n) => (
                                      <option key={n} value={n}>
                                        {n} · Nm
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label>
                                  显示
                                  <select
                                    aria-label="显示"
                                    value={fields.join(',')}
                                    onChange={(e) => setFields(e.target.value.split(','))}
                                  >
                                    <option value="q1,q2">Q1 + Q2</option>
                                    <option value="q1">Q1</option>
                                    <option value="q2">Q2</option>
                                    <option value="minimum">min(Q1,Q2)</option>
                                  </select>
                                </label>
                              </>
                            ) : (
                              <>
                                <label>
                                  x 参数
                                  <input
                                    aria-label="x 参数"
                                    value={lossX}
                                    onChange={(e) => setLossX(e.target.value)}
                                  />
                                </label>
                                <label>
                                  x 坐标
                                  <input
                                    aria-label="x 坐标"
                                    value={lossIX}
                                    onChange={(e) => setLossIX(e.target.value)}
                                  />
                                </label>
                                <label>
                                  y 参数
                                  <input
                                    aria-label="y 参数"
                                    value={lossY}
                                    onChange={(e) => setLossY(e.target.value)}
                                  />
                                </label>
                                <label>
                                  y 坐标
                                  <input
                                    aria-label="y 坐标"
                                    value={lossIY}
                                    onChange={(e) => setLossIY(e.target.value)}
                                  />
                                </label>
                                <NumberField
                                  label="参数偏移范围 ±"
                                  value={extent}
                                  onChange={setExtent}
                                  min={0.001}
                                  max={1}
                                  step={0.01}
                                />
                              </>
                            )}
                            <NumberField
                              label="网格分辨率"
                              value={resolution}
                              onChange={setResolution}
                              min={2}
                              max={view === 'q' ? 65 : 31}
                            />
                            <button
                              className="primary"
                              disabled={!!busy || (view === 'q' && detail.config.algorithm !== 'sac')}
                              onClick={() => run('真实切片计算（固定条件）', calculateSlice)}
                            >
                              计算真实切片
                            </button>
                            {busy.includes('切片') && (
                              <button onClick={() => sliceController.current?.abort()}>取消切片计算</button>
                            )}
                          </div>
                          {view === 'q' && (
                            <Vector
                              label="未绘动作维固定值 Nm（所选两维由网格覆盖）"
                              values={fixed}
                              onChange={setFixed}
                            />
                          )}
                          <p className="muted small">
                            {view === 'q'
                              ? '状态取所选经验 before；其他动作固定。PPO 没有双 Q，请创建 SAC 实验。'
                              : 'θ=θ₀+u·d₁+v·d₂，d 是两个独立标量参数坐标。批次、目标、噪声、其他参数与 Critic/α 全部冻结；不是整个损失地形。'}
                            {busy.includes('切片')
                              ? ' 可取消服务端任务；损失计算在网格点安全边界停止，Q 网格在一次有界批量推断边界停止。'
                              : ''}
                          </p>
                          {surface && (
                            <>
                              <div className="field-row">
                                <NumberField
                                  label="网格 i"
                                  value={pick[0]}
                                  onChange={(n) => setPick([boundedIndex(n, surface.x.length), pick[1]])}
                                  min={0}
                                  max={surface.x.length - 1}
                                />
                                <NumberField
                                  label="网格 j"
                                  value={pick[1]}
                                  onChange={(n) => setPick([pick[0], boundedIndex(n, surface.y.length)])}
                                  min={0}
                                  max={surface.y.length - 1}
                                />
                              </div>
                              <dl>
                                <dt>x, y 实际坐标</dt>
                                <dd>
                                  {fmt(surface.x[pick[0]])}, {fmt(surface.y[pick[1]])}
                                </dd>
                                {(view === 'q' ? ['q1', 'q2', 'minimum'] : ['loss']).map((k) => (
                                  <React.Fragment key={k}>
                                    <dt>{k}</dt>
                                    <dd data-testid={'value-' + k}>
                                      {fmt(surface[k]?.[pick[0]]?.[pick[1]])}
                                    </dd>
                                  </React.Fragment>
                                ))}
                              </dl>
                              {projection && (
                                <div className="callout">
                                  橙线为实际 Adam Δθ 的二维投影：[{projection.delta.map(fmt).join(', ')}
                                  ]；离面残差 ‖Δθ⊥‖ = {fmt(projection.residual)}，全更新范数 ={' '}
                                  {fmt(projection.norm)}。源更新 {actorOpt.id}；只在 origin
                                  与方向一致时可作一步解释。 蓝线为 −η∇L
                                  的二维投影（普通梯度下降对照，未执行）；两条线固定在原点损失高度，仅表达参数平面方向，端点高度不代表新损失。
                                </div>
                              )}
                              <details>
                                <summary>完整网格与冻结条件（二维替代）</summary>
                                <RawTree value={surface} />
                              </details>
                              {view === 'loss' && (
                                <div className="field-row">
                                  <NumberField
                                    label="对照学习率"
                                    value={branchValue}
                                    onChange={setBranchValue}
                                    min={0.000001}
                                    max={0.05}
                                    step={0.0001}
                                  />
                                  <button
                                    disabled={!!busy || active}
                                    onClick={() =>
                                      run('学习率分支实际重算', async () => {
                                        const parent = detail.id;
                                        const child = await api(`/experiments/${parent}/branches`, {
                                          checkpoint,
                                          label: detail.label + ' · lr=' + branchValue,
                                          intervention: {
                                            kind: 'hyperparameter',
                                            path: detail.config.algorithm + '.learning_rate',
                                            value: branchValue,
                                          },
                                        });
                                        await list();
                                        await open(child.id);
                                        setCompareId(parent);
                                        setMode('fixed_batch');
                                        const j = await api(`/experiments/${child.id}/jobs`, {
                                          iterations: 1,
                                          record: true,
                                          mode: 'fixed_batch',
                                        });
                                        setJob(j);
                                        historyUrl(child.id, j.id);
                                      })
                                    }
                                  >
                                    创建学习率对照并实际重算
                                  </button>
                                </div>
                              )}
                              <button
                                onClick={() =>
                                  download('actual-' + view + '-slice.json', {
                                    ...surface,
                                    checkpoint: surfaceRequest.body.checkpoint,
                                    request: surfaceRequest,
                                    selected_point: {
                                      index: [...pick],
                                      x: surface.x[pick[0]],
                                      y: surface.y[pick[1]],
                                      values: Object.fromEntries(
                                        (view === 'q' ? ['q1', 'q2', 'minimum'] : ['loss']).map((key) => [
                                          key,
                                          surface[key][pick[0]][pick[1]],
                                        ]),
                                      ),
                                    },
                                  })
                                }
                              >
                                导出真实网格
                              </button>
                            </>
                          )}
                        </>
                      )}
                    </>
                  )}
                  {panel === 'predict' && (
                    <>
                      <h3>固定噪声的实时前向</h3>
                      <p className="muted small">
                        改变输入不会改变真实物理状态；输入可能不在物理流形上。来源为所选检查点。
                      </p>
                      <div className="observation-grid">
                        {detail.geometry.observation_labels.map((label, i) => (
                          <NumberField
                            key={label}
                            label={label}
                            value={observation[i]}
                            onChange={(v) => setObservation((o) => o.map((n, j) => (j === i ? v : n)))}
                            step={0.01}
                          />
                        ))}
                      </div>
                      <Vector label="固定标准高斯噪声 ε" values={noise} onChange={setNoise} />
                      <button
                        onClick={() =>
                          setObservation(
                            selectedFrame ? observationOf(selectedFrame.before) : detail.observation,
                          )
                        }
                      >
                        从所选真实样本填入
                      </button>
                      <button
                        className="primary"
                        disabled={!!busy}
                        onClick={() => run('执行真实前向', predict)}
                      >
                        只运行前向
                      </button>
                      {prediction && (
                        <>
                          <p className="callout">
                            action = [{prediction.action[0].map(fmt).join(', ')}] Nm；logp ={' '}
                            {fmt(prediction.logp[0])}。无参数更新。
                          </p>
                          <button
                            onClick={() =>
                              history.length && run('回到已存更新', () => loadTrace(history.at(-1).id))
                            }
                            disabled={!history.length}
                          >
                            回到已存更新
                          </button>
                        </>
                      )}
                    </>
                  )}
                  {panel === 'branch' && (
                    <>
                      <h3>从完整状态建立单变量对照</h3>
                      <div className="callout branch-provenance" data-testid="branch-provenance">
                        <span>父检查点：{checkpoint}</span>
                        {branchKind === 'parameter' && (
                          <>
                            <span>
                              父状态原值：
                              <b data-testid="branch-original">
                                {parentParameter == null ? '正在读取 / 坐标无效' : String(parentParameter)}
                              </b>
                            </span>
                            <span>拟写入绝对值：{String(branchValue)}</span>
                            {parameterEdit?.source.eventId && (
                              <span>
                                入口历史来源：Trace {parameterEdit.source.traceId} ·{' '}
                                {parameterEdit.source.eventLabel} · {parameterEdit.source.eventId}；历史值{' '}
                                {String(parameterEdit.source.recordedValue)}。本次从完整父状态修改。
                              </span>
                            )}
                            {parameterEditStale && (
                              <strong role="alert">
                                参数来源已变化，此交接已失效。请从网络重新选择参数。
                              </strong>
                            )}
                          </>
                        )}
                      </div>
                      <p className="small muted">
                        建议选择 Trace origin，先 fixed_batch 隔离一次更新。train
                        会按算法重新采集有效数据。参数编辑后可保留或重置优化器历史。
                      </p>
                      <div className="field-row">
                        <label>
                          干预类型
                          <select
                            aria-label="干预类型"
                            value={branchKind}
                            onChange={(e) => {
                              setBranchKind(e.target.value);
                              setParameterEdit(undefined);
                              setBranchPath(
                                e.target.value === 'reward'
                                  ? 'rollout.reward'
                                  : e.target.value === 'parameter'
                                    ? finalBias(detail.architecture)
                                    : detail.config.algorithm + '.learning_rate',
                              );
                            }}
                          >
                            <option value="hyperparameter">一个超参数</option>
                            <option value="parameter">一个参数坐标</option>
                            <option value="reward">一个历史奖励（PPO 反事实）</option>
                          </select>
                        </label>
                        <label>
                          路径
                          <input
                            aria-label="干预路径"
                            value={branchPath}
                            onChange={(e) => {
                              setBranchPath(e.target.value);
                              setParameterEdit(undefined);
                            }}
                          />
                        </label>
                        <label>
                          索引（逗号分隔）
                          <input
                            aria-label="干预索引"
                            disabled={branchKind === 'hyperparameter'}
                            value={branchIndex}
                            onChange={(e) => {
                              setBranchIndex(e.target.value);
                              setParameterEdit(undefined);
                            }}
                          />
                        </label>
                        <NumberField
                          label="新的绝对值"
                          value={branchValue}
                          onChange={setBranchValue}
                          step={0.001}
                        />
                      </div>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={resetOpt}
                          onChange={(e) => setResetOpt(e.target.checked)}
                        />
                        参数编辑后重置该模型 Adam 矩（仅参数干预）
                      </label>
                      <button
                        className="primary"
                        disabled={
                          !!busy ||
                          active ||
                          (branchKind === 'parameter' &&
                            (parameterEditStale || !Number.isFinite(parentParameter)))
                        }
                        onClick={() => run('建立完整状态分支', branch)}
                      >
                        <GitBranch size={16} />
                        创建受控分支
                      </button>
                      <details>
                        <summary>允许的常用路径</summary>
                        <p className="mono">
                          {detail.config.algorithm}.learning_rate / gamma / max_gradient_norm；PPO: gae_lambda
                          / clip_epsilon / entropy_coefficient / epochs；SAC: tau /
                          updates_per_step；参数：actor/weights.0 或 {finalBias(detail.architecture)}。reward
                          索引是完整时序位置，改动是反事实奖励，不声称来自修改后的物理奖励。
                        </p>
                      </details>
                      {detail.parent && (
                        <div className="callout">
                          父实验 {detail.parent}
                          <br />
                          父检查点 {detail.parent_checkpoint}
                          <RawTree value={detail.intervention} />
                        </div>
                      )}
                    </>
                  )}
                  {panel === 'compare' && (
                    <>
                      <h3>分支与数值对照</h3>
                      <div className="field-row">
                        <label>
                          对照实验
                          <select
                            aria-label="对照实验"
                            value={compareId}
                            onChange={(e) => setCompareId(e.target.value)}
                          >
                            <option value="">请选择</option>
                            {experiments
                              .filter((e) => e.id !== detail.id)
                              .map((e) => (
                                <option key={e.id} value={e.id}>
                                  {e.label}
                                </option>
                              ))}
                          </select>
                        </label>
                        <button disabled={!compareId || !!busy} onClick={() => run('读取真实对照', compare)}>
                          加载对照
                        </button>
                      </div>
                      {comparison && (
                        <>
                          <p className="callout">
                            主实验与对照的“当前完整检查点”参数 max|Δ|：{fmt(comparison.parameter_diff)}
                            。与历史 Trace 的精确单次更新版本分别标注；不同架构不强行相减。
                          </p>
                          <table>
                            <thead>
                              <tr>
                                <th>对象</th>
                                <th>主实验</th>
                                <th>对照</th>
                              </tr>
                            </thead>
                            <tbody>
                              {['env_steps', 'updates', 'checkpoint', 'parent_checkpoint'].map((k) => (
                                <tr key={k}>
                                  <td>{k}</td>
                                  <td>{String(detail[k])}</td>
                                  <td>{String(comparison.detail[k])}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <details open>
                            <summary>对照的最新 Trace 目标（真实原值）</summary>
                            <RawTree
                              value={{
                                origin: comparison.index?.origin_checkpoint,
                                output: comparison.index?.output_checkpoint,
                                objectives: comparison.objectives,
                              }}
                            />
                          </details>
                          <p className="small muted">
                            机械臂橙色透明模型显示对照当前状态。继续训练的分支会独立采样；不同路径不是物理时间同步的因果证明。
                          </p>
                        </>
                      )}
                    </>
                  )}
                  {panel === 'courses' && (
                    <>
                      <div className="course-picker">
                        {courses.map((c, i) => (
                          <button
                            key={c.title}
                            className={course === i ? 'active' : ''}
                            onClick={() => {
                              setCourse(i);
                              setGuess('');
                              setExplain('');
                            }}
                          >
                            {i + 1}
                          </button>
                        ))}
                      </div>
                      {course >= 0 ? (
                        <>
                          <span className="eyebrow">
                            {courses[course].tag} · {courses[course].algorithm.toUpperCase()}
                          </span>
                          <h3>{courses[course].title}</h3>
                          <p>{courses[course].background}</p>
                          <label>
                            先写下预测：{courses[course].prediction}
                            <textarea
                              aria-label="课程预测"
                              value={guess}
                              onChange={(e) => setGuess(e.target.value)}
                            />
                          </label>
                          {detail.config.algorithm !== courses[course].algorithm && (
                            <div className="callout">
                              本课需要 {courses[course].algorithm.toUpperCase()}。
                              <button onClick={() => setCreateOpen(true)}>创建对应实验</button>
                            </div>
                          )}
                          <ol>
                            {courses[course].steps.map((t) => (
                              <li key={t}>{t}</li>
                            ))}
                          </ol>
                          <button
                            onClick={() => {
                              setView(courses[course].view as View);
                              setPanel(
                                courses[course].kind === 'predict'
                                  ? 'predict'
                                  : ['gae', 'clip', 'neuron'].includes(courses[course].kind)
                                    ? 'branch'
                                    : 'inspect',
                              );
                            }}
                          >
                            进入本课操作 <ArrowRight size={14} />
                          </button>
                          <p className="small">
                            <b>需要的证据：</b>
                            {courses[course].evidence.join('；')}
                          </p>
                          <details>
                            <summary>完成操作后查看机制解释</summary>
                            <p>{courses[course].explanation}</p>
                          </details>
                          <label>
                            结合实际数字解释
                            <textarea
                              aria-label="课程解释"
                              value={explain}
                              onChange={(e) => setExplain(e.target.value)}
                            />
                          </label>
                          <button
                            onClick={() => {
                              setNote(
                                `课程 ${course + 1}：${courses[course].title}\n证据：${event?.id ?? '待选择'}；checkpoint ${checkpoint}`,
                              );
                              setPanel('notes');
                            }}
                          >
                            引用当前事件并保存课程记录
                          </button>
                          <button
                            onClick={() => {
                              setCourse(-1);
                              setPanel('inspect');
                            }}
                          >
                            自由探索
                          </button>
                          {course === 1 && (
                            <button
                              onClick={() =>
                                run('读取完整时间序列', async () => {
                                  setRollout(await api(`/traces/${traceId}/rollout`));
                                })
                              }
                              disabled={!traceId}
                            >
                              完整时间序列与 GAE
                            </button>
                          )}
                          {course === 4 && (
                            <>
                              <button
                                disabled={!traceId || detail.config.algorithm !== 'sac' || !!busy}
                                onClick={() =>
                                  run('实际比较冻结参数与 detach Q', async () =>
                                    setPathProbe(
                                      await api(`/experiments/${detail.id}/actor-path-probe`, { checkpoint }),
                                    ),
                                  )
                                }
                              >
                                固定批次比较冻结参数 / detach Q
                              </button>
                              {pathProbe && (
                                <>
                                  <div className="callout">
                                    两次使用同批次、同噪声与同一 Critic 版本；均未更新参数。detach 只切断 Q
                                    对动作路径，熵路径保留。来源检查点 {pathProbe.checkpoint}
                                  </div>
                                  <RawTree value={pathProbe} />
                                  <button onClick={() => download('actual-actor-path-probe.json', pathProbe)}>
                                    导出导数对照
                                  </button>
                                </>
                              )}
                            </>
                          )}
                          {course === 6 && (
                            <>
                              <div className="field-row">
                                <label>
                                  预登记种子（恰好 5 个）
                                  <input
                                    aria-label="研究种子"
                                    value={studySeeds}
                                    disabled={studyRunning}
                                    onChange={(e) => setStudySeeds(e.target.value)}
                                  />
                                </label>
                                <NumberField
                                  label="每个实验 train 迭代数"
                                  value={studyBudget}
                                  onChange={setStudyBudget}
                                  min={1}
                                  max={20}
                                />
                                <button
                                  disabled={studyRunning || !!busy}
                                  onClick={() => run('多种子真实经验复用实验', launchStudy)}
                                >
                                  登记并依次运行 10 个实验
                                </button>
                                <button
                                  disabled={!studyRunning}
                                  onClick={() => {
                                    studyStop.current = true;
                                  }}
                                >
                                  取消研究队列
                                </button>
                              </div>
                              <p className="small muted">
                                ratio 1 / 4，各种子各一次；完整失败和实际耗时一并导出。评估固定 seed
                                701–703，64 步。短预算不保证学会任务。
                              </p>
                              <table>
                                <thead>
                                  <tr>
                                    <th>seed / ratio</th>
                                    <th>状态</th>
                                    <th>mean distance m</th>
                                    <th>秒</th>
                                    <th>实验</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {study.map((r) => (
                                    <tr key={r.seed + ':' + r.ratio}>
                                      <td>
                                        {r.seed} / {r.ratio}
                                      </td>
                                      <td>
                                        {r.status}
                                        <small>{r.error}</small>
                                      </td>
                                      <td>{fmt(r.distance)}</td>
                                      <td>{fmt(r.seconds)}</td>
                                      <td>
                                        {r.id && (
                                          <button onClick={() => run('打开研究实验', () => open(r.id))}>
                                            打开
                                          </button>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              {[1, 4].map((ratio) => {
                                const values = study
                                  .filter((r) => r.ratio === ratio && r.distance != null)
                                  .map((r) => r.distance)
                                  .sort((a, b) => a - b);
                                return (
                                  <p key={ratio}>
                                    ratio {ratio}：有效 {values.length}/5；中位数{' '}
                                    {fmt(values[Math.floor(values.length / 2)])} m；范围 {fmt(values[0])}–
                                    {fmt(values.at(-1))} m
                                  </p>
                                );
                              })}
                            </>
                          )}
                        </>
                      ) : (
                        <p>选择一个机制实验开始。每课都需要预测、实际操作、数值证据与解释。</p>
                      )}
                    </>
                  )}
                  {panel === 'notes' && (
                    <>
                      <h3>把解释保存在证据旁</h3>
                      <p className="small muted">
                        当前引用：{traceId || '无 Trace'} / {event?.id ?? '无事件'} / sample_id{' '}
                        {sampleIds[s.sample] ?? 0}。笔记保存到服务端 D 盘，工作包同时携带检查点与笔记。
                      </p>
                      <textarea
                        aria-label="实验笔记"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="写下实际观察到的数值、解释和仍未解决的问题…"
                      />
                      <button
                        className="primary"
                        disabled={!note.trim() || !!busy}
                        onClick={() => run('保存证据笔记', saveNote)}
                      >
                        <Save size={15} />
                        保存引用笔记
                      </button>
                      {notes.map((n, i) => (
                        <article className="note" key={i}>
                          <small>
                            课程 {n.course || '自由实验'} · {n.created} · sample {n.sample_id}
                          </small>
                          <p>{n.text}</p>
                          {n.prediction && <p>预测：{n.prediction}</p>}
                          {n.explanation && <p>解释：{n.explanation}</p>}
                          <code>
                            {n.trace_id} / {n.event_id} / {n.checkpoint}
                          </code>
                          <button
                            disabled={n.experiment_id !== detail.id || !n.trace_id}
                            onClick={() =>
                              run('定位笔记证据', async () => {
                                await loadTrace(n.trace_id);
                                const idx = await api(`/traces/${n.trace_id}/index`);
                                select({ event: idx.events.findIndex((e) => e.id === n.event_id) });
                              })
                            }
                          >
                            定位来源事件
                          </button>
                        </article>
                      ))}
                    </>
                  )}
                  {rollout && (
                    <details open>
                      <summary>原始时序（不是 minibatch 行序）</summary>
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>t / sample</th>
                              <th>reward</th>
                              <th>δ</th>
                              <th>GAE</th>
                              <th>return</th>
                              <th>终止 / 边界</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rollout.rollout.sample_id.map((id, i) => (
                              <tr key={i}>
                                <td>
                                  <button
                                    onClick={() => {
                                      setBranchKind('reward');
                                      setBranchPath('rollout.reward');
                                      setBranchIndex(String(i));
                                      setBranchValue(rollout.rollout.reward[i] + 1);
                                      setPanel('branch');
                                    }}
                                  >
                                    {i} / {id}
                                  </button>
                                </td>
                                {['reward', 'delta', 'raw_advantage', 'returns'].map((k) => (
                                  <td key={k}>{fmt(rollout.rollout[k][i])}</td>
                                ))}
                                <td>
                                  {String(rollout.rollout.terminated[i])} /{' '}
                                  {String(rollout.rollout.boundary[i])}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  )}
                </div>
              </div>
            </section>
            <Inspector
              {...{
                event,
                traceId,
                checkpoint: prediction ? prediction.source_checkpoint : trace?.origin_checkpoint,
                backward,
                forwardOnly: !!prediction || trace?.phase === 'forward_only_no_parameter_update',
                onBackward: () => setBackward(!backward),
              }}
            />
          </main>
          <section className="checkpoint-bar">
            <label>
              来源检查点
              <select
                aria-label="来源检查点"
                value={checkpoint}
                onChange={(e) => setCheckpoint(e.target.value)}
              >
                {checkpoints.map((cp) => (
                  <option key={cp.id} value={cp.id}>
                    {cp.reason} · u{cp.updates} / env{cp.env_steps} · {cp.id.slice(0, 10)}
                  </option>
                ))}
              </select>
            </label>
            <span>
              {origin
                ? '精确选中更新前 origin'
                : checkpoint === trace?.output_checkpoint
                  ? '精确选中更新后 output'
                  : '所选完整检查点，与 Trace 版本分别标注'}
            </span>
            <button
              onClick={() =>
                run('下载原生检查点', async () => {
                  const r = await fetch(`/api/checkpoints/${checkpoint}/download`);
                  if (!r.ok) throw Error('下载失败');
                  download(checkpoint + '.pgz', await r.blob());
                })
              }
            >
              保存检查点 .pgz
            </button>
            <details>
              <summary>全部任务指标</summary>
              <RawTree value={job?.summary ?? []} />
            </details>
          </section>
        </>
      )}
      <div className="site-foot">
        <span>策镜 · PolicyGlass</span>
        <span>真实计算 / 可恢复状态 / 受控解释</span>
        <span>真实实验与独立技术核验 · 用户研究待真实参与</span>
      </div>
      {createOpen && (
        <CreateDialog
          course={course}
          initialAlgorithm={createAlgorithm}
          busy={!!busy}
          onClose={() => setCreateOpen(false)}
          onCreate={(config) =>
            run('创建真实实验', async () => {
              const { label, ...rest } = config;
              const result = await api('/experiments', { label, config: rest });
              await list();
              await open(result.id);
              setCreateOpen(false);
              if (course >= 0) {
                setPanel('courses');
                setView(courses[course].view as View);
              }
            })
          }
        />
      )}
    </div>
  );
}
function parseIndex(v: string) {
  const a = v.trim() ? v.split(',').map(Number) : [];
  if (a.some((n) => !Number.isInteger(n) || n < 0)) throw Error('坐标必须是非负整数');
  return a;
}
function NumberField({ label, value, onChange, min, max, step = 1 }: any) {
  return (
    <label>
      {label}
      <input
        type="number"
        aria-label={label}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        {...{ min, max, step: step === 1 ? 1 : 'any' }}
      />
    </label>
  );
}
function Vector({ label, values, onChange }: any) {
  return (
    <fieldset className="vector">
      <legend>{label}</legend>
      {values.map((n, i) => (
        <label key={i}>
          {['x', 'y', 'z'][i]}
          <input
            aria-label={`${label} ${i}`}
            type="number"
            value={n}
            step="0.01"
            onChange={(e) => onChange(values.map((v, j) => (j === i ? +e.target.value : v)))}
          />
        </label>
      ))}
    </fieldset>
  );
}
function CreateDialog({ course, initialAlgorithm, busy, onClose, onCreate }: any) {
  const dialog = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const form = dialog.current!;
    const backdrop = form.parentElement!;
    const background = Array.from(backdrop.parentElement!.children).filter(
      (node) => node !== backdrop,
    ) as HTMLElement[];
    const priorInert = background.map((node) => node.inert);
    background.forEach((node) => {
      node.inert = true;
    });
    form.querySelector<HTMLInputElement>('[aria-label="实验名称"]')?.focus();
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
      if (event.key !== 'Tab') return;
      const controls = Array.from(
        form.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]',
        ),
      ).filter((node) => node.getClientRects().length > 0);
      const first = controls[0],
        last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    form.addEventListener('keydown', keys);
    return () => {
      form.removeEventListener('keydown', keys);
      background.forEach((node, i) => {
        node.inert = priorInert[i];
      });
      previous?.focus();
    };
  }, []);
  const [label, setLabel] = useState(course >= 0 ? courses[course].title : '空间机械臂 · 机制实验'),
    [algorithm, setAlgorithm] = useState(
      course >= 0 ? courses[course].algorithm : (initialAlgorithm ?? 'ppo'),
    ),
    [seed, setSeed] = useState(17),
    [hidden, setHidden] = useState('64,64'),
    [activation, setActivation] = useState('tanh'),
    [lr, setLr] = useState(0.0003),
    [gamma, setGamma] = useState(0.99),
    [steps, setSteps] = useState(32),
    [epochs, setEpochs] = useState(4),
    [ratio, setRatio] = useState(1),
    [damping, setDamping] = useState(0.15),
    [advanced, setAdvanced] = useState('');
  const [localError, setLocalError] = useState('');
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const extra = advanced.trim() ? JSON.parse(advanced) : {};
      const cfg = {
        ...extra,
        label,
        algorithm,
        seed,
        network: { hidden: hidden.split(',').map(Number), activation, ...extra.network },
        environment: { damping, ...extra.environment },
        [algorithm]: {
          learning_rate: lr,
          gamma,
          ...(algorithm === 'ppo'
            ? { rollout_steps: steps, minibatch_size: steps, epochs }
            : { warmup_steps: steps, updates_per_step: ratio }),
          ...extra[algorithm],
        },
      };
      onCreate(cfg);
    } catch (e) {
      setLocalError(String(e));
    }
  };
  return (
    <div className="modal-backdrop">
      <form
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-title"
        className="modal"
        onSubmit={submit}
      >
        <div className="section-heading">
          <div>
            <span className="eyebrow">NEW EXPERIMENT</span>
            <h2 id="new-title">建立一个可复现的起点</h2>
          </div>
          <button type="button" aria-label="关闭新建" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <p className="muted">真实随机初始化策略。固定 CPU 双精度、种子与完整状态；不预设已训练成功。</p>
        <label>
          实验名称
          <input
            aria-label="实验名称"
            value={label}
            maxLength={120}
            required
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <div className="field-row">
          <label>
            算法
            <select aria-label="算法" value={algorithm} onChange={(e) => setAlgorithm(e.target.value as any)}>
              <option value="ppo">PPO-Clip + GAE</option>
              <option value="sac">SAC · Double Q</option>
            </select>
          </label>
          <NumberField label="随机种子" value={seed} onChange={setSeed} min={0} />
          <label>
            隐藏层宽度
            <input aria-label="隐藏层宽度" value={hidden} onChange={(e) => setHidden(e.target.value)} />
          </label>
          <label>
            激活
            <select value={activation} onChange={(e) => setActivation(e.target.value)}>
              <option>tanh</option>
              <option>relu</option>
            </select>
          </label>
        </div>
        <div className="field-row">
          <NumberField label="学习率" value={lr} onChange={setLr} min={0.000001} max={0.05} step={0.0001} />
          <NumberField label="折扣 gamma" value={gamma} onChange={setGamma} min={0} max={1} step={0.01} />
          <NumberField
            label={algorithm === 'ppo' ? 'rollout / minibatch' : 'warmup 交互步'}
            value={steps}
            onChange={setSteps}
            min={2}
            max={512}
          />
          {algorithm === 'ppo' ? (
            <NumberField label="PPO epochs" value={epochs} onChange={setEpochs} min={1} max={20} />
          ) : (
            <NumberField label="每步 replay updates" value={ratio} onChange={setRatio} min={1} max={32} />
          )}
          <NumberField
            label="关节阻尼 Nm·s/rad"
            value={damping}
            onChange={setDamping}
            min={0}
            max={5}
            step={0.05}
          />
        </div>
        <details>
          <summary>完整结构化配置（服务端验证资源上限）</summary>
          <p className="small">
            可填写 environment、ppo、sac、network
            等合法配置覆盖项。未知字段、非有限值与超预算被拒绝；不执行代码。
          </p>
          <textarea
            aria-label="完整配置 JSON"
            placeholder={'{"environment":{"target":[0.45,0.12,0.45]},"ppo":{"entropy_coefficient":0.01}}'}
            value={advanced}
            onChange={(e) => setAdvanced(e.target.value)}
          />
        </details>
        {localError && <p role="alert">{localError}</p>}
        <div className="modal-foot">
          <span>所有物理量使用 SI · 1–3 隐藏层 · 每层 2–128 单元</span>
          <button className="primary" type="submit" disabled={busy}>
            创建实验 <ArrowRight size={16} />
          </button>
        </div>
      </form>
    </div>
  );
}
