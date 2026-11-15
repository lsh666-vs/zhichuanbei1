import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Beaker,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  FlaskConical,
  FolderOpen,
  History,
  Lightbulb,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  SkipBack,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import type {
  AiProposal,
  AiStatus,
  Domain,
  Evaluation,
  Experiment,
  ExperimentPackage,
  Instance,
  JobStatus,
  RegressionResult,
  SearchResult,
  ShrinkResult,
  Strategy,
} from '../shared/types';
import { validateInstance, validateStrategy } from '../engine/validation';
import { api, ApiError, clone, domainLabels, initialInstance, initialStrategy, type Catalog } from './api';
import { Modal } from './components/Modal';
import { InstanceEditor } from './components/InstanceEditor';
import { EventList, GraphPlot, TraceCanvas } from './components/TraceCanvas';

interface Draft {
  id?: string;
  title: string;
  instance: Instance;
  strategy: Strategy;
  versions: Experiment['versions'];
  evaluation?: Evaluation;
  search?: SearchResult;
  shrink?: ShrinkResult;
  regression?: RegressionResult;
}
type Panel = 'editor' | 'library' | 'versions' | 'help' | 'events' | 'shrink' | 'regression' | null;
const blank = (): Draft => ({
  title: '我的第一个反例实验',
  instance: clone(initialInstance),
  strategy: clone(initialStrategy),
  versions: [],
});
const verdictText = {
  counterexample: '发现了一个反例',
  pass: '当前实例通过',
  invalid: '策略无法执行',
  incomplete: '计算未完成',
};
const sizeOf = (i: Instance) => (i.domain === 'graph' ? i.nodes.length + i.edges.length : i.items.length);
const valueOf = (e: Evaluation, side: 'candidate' | 'reference') =>
  e.instance.domain === 'graph' && !e[side].complete
    ? side === 'candidate' && e.reference.complete
      ? '未到达'
      : '不可达'
    : e[side].value;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const DRAFT_KEY = 'counterlab.draft.v1';
const DOMAIN_DRAFTS_KEY = 'counterlab.domain-drafts.v1';
function validateDraftStrategy(strategy: Strategy) {
  if (typeof strategy.score !== 'string' || strategy.score.length > 160 || typeof strategy.name !== 'string')
    throw new Error('草稿字段无效');
  // Preserve unfinished editing text; execution still validates the real expression.
  validateStrategy({
    ...strategy,
    name: strategy.name || '未命名策略',
    score: strategy.domain === 'graph' ? 'weight' : 'value',
  });
}
function draftInput(draft: Draft) {
  return { id: draft.id, title: draft.title, instance: draft.instance, strategy: draft.strategy };
}
function storeDraft(draft: Draft, otherDrafts: Partial<Record<Domain, Draft>>) {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draftInput(draft)));
  localStorage.setItem(
    DOMAIN_DRAFTS_KEY,
    JSON.stringify(
      Object.fromEntries(
        Object.entries({ ...otherDrafts, [draft.instance.domain]: draft }).map(([domain, value]) => [
          domain,
          draftInput(value),
        ]),
      ),
    ),
  );
}

export default function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [draft, setDraft] = useState<Draft>(blank);
  const [library, setLibrary] = useState<Experiment[]>([]);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [editor, setEditor] = useState<Instance>(clone(initialInstance));
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [intent, setIntent] = useState('');
  const [proposal, setProposal] = useState<AiProposal | null>(null);
  const [explanation, setExplanation] = useState('');
  const [baseline, setBaseline] = useState<Evaluation | null>(null);
  const [seed, setSeed] = useState(20261115);
  const [attempts, setAttempts] = useState(300);
  const [searchSize, setSearchSize] = useState(7);
  const [holdout, setHoldout] = useState(30);
  const [draftReady, setDraftReady] = useState(false);
  const [autosave, setAutosave] = useState('草稿仅保存在此浏览器');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editorError, setEditorError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const draftRef = useRef(draft);
  const domainDrafts = useRef<Partial<Record<Domain, Draft>>>({});
  const connectionSequence = useRef(0);
  draftRef.current = draft;
  const running = job?.state === 'queued' || job?.state === 'running';
  const locked = Boolean(busy || running);
  const entry = catalog?.domains.find((item) => item.domain === draft.instance.domain);
  const evaluation = draft.evaluation ?? null;
  const maxStep = Math.max(
    0,
    Math.max(evaluation?.candidate.steps.length ?? 0, evaluation?.reference.steps.length ?? 0) - 1,
  );
  const variables =
    draft.instance.domain === 'interval'
      ? ['start', 'end', 'duration', 'value']
      : draft.instance.domain === 'knapsack'
        ? ['weight', 'value']
        : ['weight'];
  const ties =
    draft.instance.domain === 'interval'
      ? ['id', 'value', 'start', 'end']
      : draft.instance.domain === 'knapsack'
        ? ['id', 'value', 'weight']
        : ['id', 'weight'];

  async function connect() {
    const sequence = ++connectionSequence.current;
    setBusy('连接本地服务');
    setNotice(null);
    try {
      const [nextCatalog, saved, status] = await Promise.all([
        api.catalog(),
        api.experiments(),
        api.aiStatus(),
      ]);
      if (sequence !== connectionSequence.current) return;
      setCatalog(nextCatalog);
      setLibrary(saved);
      setAi(status);
      if (!draftReady) {
        let restored = false;
        try {
          const domainRaw = localStorage.getItem(DOMAIN_DRAFTS_KEY);
          if (domainRaw) {
            const cached = JSON.parse(domainRaw);
            for (const domain of ['interval', 'knapsack', 'graph'] as Domain[]) {
              const value = cached[domain];
              if (!value) continue;
              try {
                validateInstance(value.instance);
                validateDraftStrategy(value.strategy);
                if (
                  value.instance.domain !== domain ||
                  value.strategy.domain !== domain ||
                  typeof value.title !== 'string' ||
                  value.title.length > 120
                )
                  continue;
                const stored = saved.find((item) => item.id === value.id && item.domain === domain);
                domainDrafts.current[domain] = {
                  ...draftInput(value),
                  id: stored?.id,
                  versions: stored?.versions ?? [],
                };
              } catch {
                /* Ignore only the malformed domain draft; keep other valid work. */
              }
            }
          }
          const raw = localStorage.getItem(DRAFT_KEY);
          if (raw) {
            const value = JSON.parse(raw);
            validateInstance(value.instance);
            validateDraftStrategy(value.strategy);
            if (
              value.instance.domain !== value.strategy.domain ||
              typeof value.title !== 'string' ||
              value.title.length > 120
            )
              throw new Error();
            const stored = saved.find((e) => e.id === value.id);
            setDraft({
              title: value.title,
              instance: value.instance,
              strategy: value.strategy,
              versions: stored?.versions ?? [],
              id: stored?.id,
            });
            setNotice({ text: '已恢复本地草稿。请重新运行以更新计算结论。' });
            restored = true;
          }
        } catch {
          setNotice({ text: '旧草稿无法恢复，已保留保存的实验，可从实验档案打开。', error: true });
        }
        if (!restored) {
          const first = nextCatalog.domains[0];
          setDraft({ ...blank(), instance: first.instance, strategy: first.strategy });
        }
        setDraftReady(true);
      }
    } catch (error) {
      if (sequence === connectionSequence.current)
        setNotice({ text: error instanceof Error ? error.message : '连接失败', error: true });
    } finally {
      if (sequence === connectionSequence.current) setBusy(null);
    }
  }
  useEffect(() => {
    void connect();
  }, []);
  useEffect(() => {
    if (!draftReady) return;
    setAutosave('草稿保存中…');
    const timer = window.setTimeout(() => {
      try {
        storeDraft(draft, domainDrafts.current);
        setAutosave('草稿已自动保存');
      } catch {
        setAutosave('草稿存储不可用，请保存到实验档案');
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [draft.id, draft.title, draft.instance, draft.strategy, draftReady]);
  useEffect(() => {
    if (!draftReady) return;
    const flush = () => {
      try {
        storeDraft(draftRef.current, domainDrafts.current);
      } catch {
        /* The persistent UI warning already advises saving to the database. */
      }
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
    };
  }, [draftReady]);
  useEffect(() => {
    setExplanation('');
  }, [evaluation]);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(
      () =>
        setStep((current) => {
          if (current >= maxStep) {
            setPlaying(false);
            return maxStep;
          }
          return current + 1;
        }),
      800,
    );
    return () => clearInterval(timer);
  }, [playing, maxStep]);
  useEffect(() => {
    if (!job || !['queued', 'running'].includes(job.state)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api.job(job.id);
        if (cancelled) return;
        setJob(next);
        if (next.state === 'completed' && next.result) {
          setPlaying(false);
          setStep(0);
          if (next.kind === 'search') {
            const result = next.result as SearchResult;
            setDraft((current) => ({
              ...current,
              search: result,
              shrink: undefined,
              regression: undefined,
              ...(result.evaluation
                ? { instance: result.evaluation.instance, evaluation: result.evaluation }
                : {}),
            }));
            if (result.evaluation) setBaseline(result.evaluation);
            setNotice({
              text:
                result.status === 'counterexample'
                  ? `第 ${result.checked} 个样本找到并核验了反例。`
                  : result.status === 'incomplete'
                    ? `搜索未完成：${result.reason || '样本计算没有得到完整结论。'}`
                    : '本轮采样未找到反例，不代表策略普遍正确。',
              error: result.status === 'incomplete',
            });
          }
          if (next.kind === 'shrink') {
            const result = next.result as ShrinkResult;
            setDraft((current) => ({
              ...current,
              instance: result.final.instance,
              evaluation: result.final,
              shrink: result,
              regression: undefined,
            }));
            setBaseline(result.final);
            setNotice({ text: `完成 ${result.steps.length} 个有效缩减步骤，每一步保持同一失败条件。` });
          }
          if (next.kind === 'regression') {
            const result = next.result as RegressionResult;
            setDraft((current) => ({
              ...current,
              regression: result,
              evaluation: result.rows[0]?.after ?? current.evaluation,
            }));
            setPanel('regression');
          }
        } else if (next.state === 'failed' || next.state === 'cancelled')
          setNotice({ text: next.error || '计算未完成，请重新运行。', error: next.state === 'failed' });
        else timer = setTimeout(poll, 250);
      } catch (error) {
        if (!cancelled) {
          if (error instanceof ApiError && error.status === 404) {
            setJob((current) =>
              current?.id === job.id
                ? { ...current, state: 'failed', error: '服务中已找不到这个任务，请重新运行。' }
                : current,
            );
            setNotice({ text: '服务中已找不到这个任务，计算未完成。请重新运行。', error: true });
            return;
          }
          setNotice({
            text: `${error instanceof Error ? error.message : '连接中断'}；任务状态将在连接恢复后重试。`,
            error: true,
          });
          timer = setTimeout(poll, 1500);
        }
      }
    };
    timer = setTimeout(poll, 100);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [job?.id, job?.state]);
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (locked) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [locked]);

  async function action<T>(label: string, work: () => Promise<T>): Promise<T | undefined> {
    setBusy(label);
    setNotice(null);
    try {
      return await work();
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : '操作失败，请重试。', error: true });
      return undefined;
    } finally {
      setBusy(null);
    }
  }
  function changeStrategy(strategy: Strategy) {
    if (locked) return;
    if (draft.evaluation) setBaseline(draft.evaluation);
    setDraft((current) => ({
      ...current,
      strategy,
      evaluation: undefined,
      search: undefined,
      shrink: undefined,
      regression: undefined,
    }));
    setExplanation('');
    setPlaying(false);
    setStep(0);
  }
  function newDomain(domain: Domain, fresh = false) {
    const next = catalog?.domains.find((d) => d.domain === domain);
    if (!next || locked) return;
    if (domain === draft.instance.domain && !fresh) return;
    domainDrafts.current[draft.instance.domain] = clone(draft);
    const cached = !fresh ? domainDrafts.current[domain] : undefined;
    const nextDraft = cached ?? {
      title: `${next.title} · 新实验`,
      instance: clone(next.instance),
      strategy: clone(next.strategy),
      versions: [],
    };
    setDraft(nextDraft);
    domainDrafts.current[domain] = clone(nextDraft);
    setBaseline(nextDraft.evaluation ?? null);
    setExplanation('');
    setJob(null);
    setHovered(null);
    setPlaying(false);
    setStep(0);
    setNotice(null);
  }
  async function run() {
    const result = await action('执行并独立核验', () => api.evaluate(draft.instance, draft.strategy));
    if (result) {
      setDraft((current) => ({ ...current, evaluation: result }));
      setBaseline((current) => (current && !same(current.strategy, result.strategy) ? current : result));
      setStep(0);
      setPlaying(false);
      setExplanation('');
    }
  }
  async function save(): Promise<Experiment | undefined> {
    return action('保存实验快照', async () => {
      const current = draftRef.current;
      const saved = await api.save(
        {
          title: current.title,
          instance: current.instance,
          strategy: current.strategy,
          evaluation: current.evaluation,
          search: current.search,
          shrink: current.shrink,
          regression: current.regression,
        },
        current.id,
      );
      setDraft(saved);
      setLibrary((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      setNotice({ text: `已保存「${saved.title}」，共 ${saved.versions.length} 个版本。` });
      return saved;
    });
  }
  function openSaved(saved: Experiment) {
    setDraft(clone(saved));
    setBaseline(saved.evaluation ?? null);
    setStep(0);
    setPlaying(false);
    setExplanation('');
    setJob(null);
    setPanel(null);
    setNotice({ text: `已打开「${saved.title}」。` });
  }
  async function startSearch() {
    const next = await action('启动反例搜索', () =>
      api.search({
        domain: draft.instance.domain,
        strategy: draft.strategy,
        seed,
        attempts,
        size: searchSize,
        maxValue: 20,
        ...(draft.instance.domain === 'interval' ? { objective: draft.instance.objective } : {}),
      }),
    );
    if (next) {
      setJob(next);
      setExplanation('');
    }
  }
  async function startShrink() {
    if (!evaluation) return;
    const next = await action('启动性质保持缩减', () => api.shrink(evaluation));
    if (next) setJob(next);
  }
  async function startRegression() {
    const before = baseline?.strategy ?? draft.versions.at(-2)?.strategy;
    if (!before) return;
    const next = await action('启动历史与保留集回归', () =>
      api.regression(draft.instance, before, draft.strategy, seed, holdout),
    );
    if (next) setJob(next);
  }
  async function cancelJob() {
    if (!job) return;
    const next = await action('取消计算', () => api.cancel(job.id));
    if (next) {
      setJob(next);
      setNotice({
        text: next.state === 'cancelled' ? '计算已取消。不能把取消解释为没有反例。' : '任务已经结束。',
      });
    }
  }
  async function download(kind: 'export' | 'report') {
    const saved = await save();
    if (!saved) return;
    const link = document.createElement('a');
    link.href = `/api/experiments/${encodeURIComponent(saved.id)}/${kind}`;
    link.download = '';
    document.body.append(link);
    link.click();
    link.remove();
  }
  async function importFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 16 * 1024 * 1024) {
      setNotice({ text: '实验包不能超过 16 MiB。', error: true });
      return;
    }
    const saved = await action('校验实验包并重新计算', async () =>
      api.import(JSON.parse(await file.text()) as ExperimentPackage),
    );
    if (saved) {
      openSaved(saved);
      setLibrary((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      setNotice({ text: '实验包已导入，输入与结论已重新计算。' });
    }
  }
  async function propose() {
    const result = await action('AI 正在整理策略契约', () =>
      api.propose(draft.instance.domain, intent, draft.strategy),
    );
    if (result) setProposal(result);
    void api
      .aiStatus()
      .then(setAi)
      .catch(() => {});
  }
  async function explain() {
    if (!evaluation) return;
    const result = await action('AI 正在阅读计算证据', () => api.explain(evaluation));
    if (result) setExplanation(result.text);
    void api
      .aiStatus()
      .then(setAi)
      .catch(() => {});
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#workspace" aria-label="CounterLab 工作台">
          <span className="brand-mark">
            <FlaskConical size={24} />
          </span>
          <span>
            CounterLab<small>反例实验室</small>
          </span>
        </a>
        <span className="sidebar-label">YOUR RESEARCH DESK</span>
        <nav className="sidebar-nav" aria-label="工作区导航">
          <button className="nav-item active" onClick={() => setPanel(null)}>
            <Beaker size={18} />
            实验工作台<span>01</span>
          </button>
          <button className="nav-item" disabled={locked} onClick={() => setPanel('library')}>
            <FolderOpen size={18} />
            实验档案<span>{library.length}</span>
          </button>
          <button className="nav-item" disabled={locked} onClick={() => setPanel('versions')}>
            <History size={18} />
            版本与复验
          </button>
          <button className="nav-item" onClick={() => setPanel('help')}>
            <BookOpen size={18} />
            实验手册
          </button>
        </nav>
        <div className="sidebar-foot">
          <span className={`connection-dot ${catalog ? 'connected' : ''}`} />
          {catalog ? '本地引擎已就绪' : '等待本地连接'}
          <small>{catalog ? `ENGINE ${catalog.engineVersion}` : '请保持服务运行'}</small>
          <p>
            好的想法，
            <br />
            也经得起一个反例。
          </p>
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            实验空间 <span>/</span> <b>策略验证</b>
          </div>
          <div className="topbar-actions">
            <span className="save-state">
              <Check size={12} />
              {autosave}
            </span>
            <button
              className="secondary-button"
              disabled={locked || !catalog}
              onClick={() => fileInput.current?.click()}
            >
              <Upload size={14} />
              导入
            </button>
            <button className="primary-button" disabled={locked || !catalog} onClick={() => void save()}>
              <Save size={14} />
              保存实验
            </button>
          </div>
        </header>
        <main id="workspace" className="workspace">
          <section className="hero">
            <div className="hero-copy">
              <span className="eyebrow">A LAB FOR BETTER QUESTIONS</span>
              <h1>
                让直觉，<em>接受检验。</em>
              </h1>
              <p>把一个「应该没问题」的策略，变成可以验证、解释和改进的实验。</p>
              <div className="hero-meta">
                <span>
                  <ShieldCheck size={14} />
                  本地计算 · 独立核验
                </span>
                <span>
                  <Sparkles size={14} />
                  AI 辅助意图表达
                </span>
              </div>
            </div>
            <img className="hero-art" src="/assets/counterlab-hero.png" alt="" />
          </section>
          {notice && (
            <div
              className={`notice ${notice.error ? 'error' : 'success'}`}
              role={notice.error ? 'alert' : 'status'}
            >
              <span>{notice.text}</span>
              {!catalog && (
                <button className="text-button" disabled={Boolean(busy)} onClick={() => void connect()}>
                  重新连接
                </button>
              )}
              <button className="icon-button" aria-label="关闭提示" onClick={() => setNotice(null)}>
                <X size={15} />
              </button>
            </div>
          )}
          <div className="experiment-heading">
            <div>
              <span className="eyebrow">
                EXPERIMENT {draft.id ? draft.id.slice(0, 6).toUpperCase() : 'UNSAVED'}
              </span>
              <input
                aria-label="实验名称"
                value={draft.title}
                maxLength={120}
                disabled={locked}
                onChange={(e) => setDraft((current) => ({ ...current, title: e.target.value }))}
              />
            </div>
            <button
              className="text-button"
              disabled={locked || !catalog}
              onClick={() => newDomain(draft.instance.domain, true)}
            >
              <Plus size={15} />
              新建实验
            </button>
          </div>
          <div className="domain-tabs" role="tablist" aria-label="选择实验领域">
            {(['interval', 'knapsack', 'graph'] as Domain[]).map((domain, index) => (
              <button
                role="tab"
                aria-selected={draft.instance.domain === domain}
                className={`domain-tab ${draft.instance.domain === domain ? 'active' : ''}`}
                key={domain}
                disabled={locked || !catalog}
                onClick={() => newDomain(domain)}
              >
                <span>0{index + 1}</span>
                {domainLabels[domain]}
                <ArrowRight size={14} />
              </button>
            ))}
          </div>
          <div className="workbench-grid">
            <section className="strategy-panel">
              <div className="panel-title">
                <span className="eyebrow">01 / DEFINE</span>
                <h2>定义你的策略</h2>
                <Settings2 size={16} />
              </div>
              <fieldset className="strategy-fields" disabled={locked || !catalog}>
                <label className="field">
                  从常用策略开始
                  <select
                    aria-label="策略预设"
                    value={entry?.presets.some((p) => same(p, draft.strategy)) ? draft.strategy.id : ''}
                    onChange={(e) => {
                      const next = entry?.presets.find((p) => p.id === e.target.value);
                      if (next) changeStrategy(clone(next));
                    }}
                  >
                    <option value="" disabled>
                      自定义策略
                    </option>
                    {entry?.presets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  策略名称
                  <input
                    value={draft.strategy.name}
                    maxLength={120}
                    onChange={(e) => changeStrategy({ ...draft.strategy, name: e.target.value })}
                  />
                </label>
                <label className="field">
                  执行方法
                  <select
                    value={draft.strategy.algorithm}
                    onChange={(e) =>
                      changeStrategy({
                        ...draft.strategy,
                        algorithm: e.target.value as Strategy['algorithm'],
                      })
                    }
                  >
                    {draft.instance.domain === 'graph' ? (
                      <>
                        <option value="local">局部选择，不回溯</option>
                        <option value="dijkstra">Dijkstra 全局距离</option>
                      </>
                    ) : (
                      <>
                        <option value="greedy">按评分依次贪心选择</option>
                        <option value="optimal">精确动态规划</option>
                      </>
                    )}
                  </select>
                </label>
                <label className="field">
                  评分表达式
                  <input
                    className="expression-input"
                    aria-label="评分表达式"
                    value={draft.strategy.score}
                    maxLength={160}
                    disabled={['optimal', 'dijkstra'].includes(draft.strategy.algorithm)}
                    onChange={(e) => changeStrategy({ ...draft.strategy, score: e.target.value })}
                    spellCheck={false}
                  />
                </label>
                <p className="field-note">
                  可用变量 {variables.join(' · ')}
                  <br />
                  支持 + − × ÷ 和括号，不执行代码。
                </p>
                <div className="field-pair">
                  <label className="field">
                    优先方向
                    <select
                      value={draft.strategy.direction}
                      disabled={['optimal', 'dijkstra'].includes(draft.strategy.algorithm)}
                      onChange={(e) =>
                        changeStrategy({ ...draft.strategy, direction: e.target.value as 'asc' | 'desc' })
                      }
                    >
                      <option value="desc">评分高者优先</option>
                      <option value="asc">评分低者优先</option>
                    </select>
                  </label>
                  <label className="field">
                    平局规则
                    <select
                      value={draft.strategy.tieBreak}
                      disabled={['optimal', 'dijkstra'].includes(draft.strategy.algorithm)}
                      onChange={(e) =>
                        changeStrategy({
                          ...draft.strategy,
                          tieBreak: e.target.value as Strategy['tieBreak'],
                        })
                      }
                    >
                      {ties.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="field-note">
                  {['optimal', 'dijkstra'].includes(draft.strategy.algorithm)
                    ? '精确算法按固定顺序确定等优解，评分、方向和平局字段不参与计算。'
                    : 'value 平局按收益降序；其余字段升序，最终按 ID 升序。'}
                </p>
                <button
                  className="secondary-button full-width"
                  onClick={() => {
                    setEditor(clone(draft.instance));
                    setEditorError('');
                    setPanel('editor');
                  }}
                >
                  <Settings2 size={15} />
                  编辑实验输入 <span>{sizeOf(draft.instance)} 个元素</span>
                </button>
                <button className="primary-button full-width run-button" onClick={() => void run()}>
                  <Play size={16} />
                  运行当前实例
                </button>
              </fieldset>
              <div className="intent-box">
                <div>
                  <Sparkles size={15} />
                  <h3>用语言描述你的想法</h3>
                  <span className="badge">AI</span>
                </div>
                <textarea
                  aria-label="自然语言策略"
                  rows={3}
                  maxLength={4000}
                  value={intent}
                  disabled={locked || !ai?.configured}
                  onChange={(e) => setIntent(e.target.value)}
                  placeholder={
                    ai?.configured ? '例如：优先选择结束最早的任务…' : 'AI 未配置，手工规则仍可完整运行'
                  }
                />
                <button
                  className="text-button"
                  disabled={locked || !ai?.configured || !intent.trim()}
                  onClick={() => void propose()}
                >
                  生成策略提案 <ArrowRight size={14} />
                </button>
                <p className="field-note">
                  {ai?.configured
                    ? `${ai.provider} · ${ai.model} · 提案经确认后应用`
                    : '可选功能 · 本地计算无需 API 密钥'}
                </p>
              </div>
            </section>
            <div className="center-column">
              <TraceCanvas
                instance={draft.instance}
                evaluation={evaluation}
                step={Math.min(step, maxStep)}
                hovered={hovered}
                setHovered={setHovered}
              />
              <div className="player">
                <div className="player-controls">
                  <button
                    className="icon-button"
                    aria-label="回到第一步"
                    disabled={!evaluation}
                    onClick={() => {
                      setStep(0);
                      setPlaying(false);
                    }}
                  >
                    <SkipBack size={16} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="上一步"
                    disabled={!evaluation || step === 0}
                    onClick={() => {
                      setStep((s) => Math.max(0, s - 1));
                      setPlaying(false);
                    }}
                  >
                    <ChevronLeft size={17} />
                  </button>
                  <button
                    className="player-play"
                    aria-label={playing ? '暂停回放' : '播放轨迹'}
                    disabled={!evaluation}
                    onClick={() => {
                      if (step === maxStep) setStep(0);
                      setPlaying(!playing);
                    }}
                  >
                    {playing ? <Pause size={17} /> : <Play size={17} />}
                  </button>
                  <button
                    className="icon-button"
                    aria-label="下一步"
                    disabled={!evaluation || step === maxStep}
                    onClick={() => {
                      setStep((s) => Math.min(maxStep, s + 1));
                      setPlaying(false);
                    }}
                  >
                    <ChevronRight size={17} />
                  </button>
                </div>
                <input
                  aria-label="回放进度"
                  type="range"
                  min={0}
                  max={maxStep}
                  value={Math.min(step, maxStep)}
                  disabled={!evaluation}
                  onChange={(e) => {
                    setStep(Number(e.target.value));
                    setPlaying(false);
                  }}
                />
                <span className="step-count">
                  {evaluation ? step + 1 : 0} / {evaluation ? maxStep + 1 : 0}
                </span>
                <button className="text-button" disabled={!evaluation} onClick={() => setPanel('events')}>
                  事件记录
                </button>
              </div>
              <section className="section-card search-section">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">02 / CHALLENGE</span>
                    <h2>让更多情况，挑战这个规则</h2>
                  </div>
                  <Search size={18} />
                </div>
                <p className="muted">固定种子生成新实例，找到反例就停下。没有找到，只代表这批样本通过。</p>
                <fieldset className="search-controls" disabled={locked || !catalog}>
                  <label>
                    随机种子
                    <input
                      aria-label="随机种子"
                      type="number"
                      value={seed}
                      onChange={(e) => setSeed(Number(e.target.value))}
                    />
                  </label>
                  <label>
                    样本预算
                    <input
                      aria-label="样本预算"
                      type="number"
                      min={1}
                      max={2000}
                      value={attempts}
                      onChange={(e) => setAttempts(Number(e.target.value))}
                    />
                  </label>
                  <label>
                    实例规模
                    <input
                      aria-label="实例规模"
                      type="number"
                      min={2}
                      max={
                        draft.instance.domain === 'graph'
                          ? 12
                          : draft.instance.domain === 'interval'
                            ? 16
                            : 18
                      }
                      value={searchSize}
                      onChange={(e) => setSearchSize(Number(e.target.value))}
                    />
                  </label>
                  <button className="secondary-button" onClick={() => void startSearch()}>
                    <Search size={15} />
                    搜索反例
                  </button>
                </fieldset>
                {job && (
                  <div className="progress-strip" role="status">
                    <span>
                      {job.state === 'completed'
                        ? '计算完成'
                        : job.state === 'cancelled'
                          ? '已取消'
                          : job.state === 'failed'
                            ? '未完成'
                            : '正在计算'}{' '}
                      · 已检查 {job.progress.checked}
                      {job.progress.total ? ` / ${job.progress.total}` : ''}
                    </span>
                    {running && (
                      <button className="text-button" onClick={() => void cancelJob()}>
                        取消计算
                      </button>
                    )}
                  </div>
                )}
                {draft.search && (
                  <div className="search-result">
                    <ShieldCheck size={16} />
                    <span>
                      {draft.search.status === 'counterexample'
                        ? `第 ${draft.search.checked} 个样本发现反例，已载入工作台`
                        : draft.search.status === 'incomplete'
                          ? `搜索未完成 · 已检查 ${draft.search.checked} 个样本；${draft.search.reason ?? '没有完整结论'}`
                          : `检查 ${draft.search.checked} 个样本，未发现反例`}
                    </span>
                    <small>
                      SEED {draft.search.seed} · {draft.search.elapsedMs} ms
                    </small>
                  </div>
                )}
              </section>
            </div>
            <aside className="evidence-panel">
              <div className="panel-title">
                <span className="eyebrow">03 / UNDERSTAND</span>
                <h2>证据与下一步</h2>
                <ShieldCheck size={16} />
              </div>
              <div className={`verdict-card ${evaluation?.verdict ?? 'empty'}`}>
                <span className="badge">{evaluation?.witnessVerified ? '独立复核完成' : '等待真实计算'}</span>
                <h3>{evaluation ? verdictText[evaluation.verdict] : '直觉还不是结论'}</h3>
                <p>{evaluation ? evaluation.details[0] : '先运行当前输入，或搜索一个能挑战规则的新实例。'}</p>
                {evaluation && (
                  <div className="result-values">
                    <div className="metric">
                      <span>候选结果</span>
                      <strong>{valueOf(evaluation, 'candidate')}</strong>
                    </div>
                    <div className="metric reference">
                      <span>精确参照</span>
                      <strong>{valueOf(evaluation, 'reference')}</strong>
                    </div>
                  </div>
                )}
                {evaluation && (
                  <p className="difference">
                    {evaluation.instance.domain === 'graph' &&
                    (!evaluation.candidate.complete || !evaluation.reference.complete)
                      ? '未完成路径不比较数值差距'
                      : `目标差距 ${evaluation.difference}`}
                  </p>
                )}
              </div>
              <div className="evidence-actions">
                <button
                  className="secondary-button full-width"
                  disabled={locked || evaluation?.verdict !== 'counterexample'}
                  onClick={() => void startShrink()}
                >
                  <FlaskConical size={15} />
                  缩减这个反例
                </button>
                {draft.shrink && (
                  <button className="text-button" onClick={() => setPanel('shrink')}>
                    {draft.shrink.steps.length} 步缩减 · 查看证据 <ArrowRight size={13} />
                  </button>
                )}
                <p className="field-note">
                  保留同一失败条件，逐步移除多余元素。局部不可再缩减不等于全局最小。
                </p>
                <button
                  className="secondary-button full-width"
                  disabled={locked || !evaluation || !ai?.configured}
                  onClick={() => void explain()}
                >
                  <Sparkles size={15} />
                  AI 解读本次证据
                </button>
                {explanation && (
                  <div className="ai-explanation">
                    <span className="badge">模型解释 · 以计算结果为准</span>
                    <p>{explanation}</p>
                  </div>
                )}
              </div>
              <section className="revision-box">
                <span className="eyebrow">04 / IMPROVE</span>
                <h3>改过之后，再试一次</h3>
                <p className="field-note">更换策略，再复验原例、最多 20 个历史反例和独立保留样本。</p>
                <label className="field">
                  保留样本数
                  <input
                    aria-label="保留样本数"
                    type="number"
                    min={0}
                    max={100}
                    value={holdout}
                    disabled={locked}
                    onChange={(e) => setHoldout(Number(e.target.value))}
                  />
                </label>
                <button
                  className="secondary-button full-width"
                  disabled={locked || !baseline || same(baseline.strategy, draft.strategy)}
                  onClick={() => void startRegression()}
                >
                  <RotateCcw size={15} />
                  对比修正前后
                </button>
                {baseline && <p className="field-note">基线：{baseline.strategy.name}</p>}
                {draft.regression && (
                  <button className="text-button" onClick={() => setPanel('regression')}>
                    查看 {draft.regression.rows.length} 个复验结果
                  </button>
                )}
              </section>
              <div className="export-actions">
                <button
                  className="text-button"
                  disabled={locked || !catalog}
                  onClick={() => void download('export')}
                >
                  <Download size={14} />
                  实验包
                </button>
                <button
                  className="text-button"
                  disabled={locked || !catalog}
                  onClick={() => void download('report')}
                >
                  <FileText size={14} />
                  HTML 报告
                </button>
              </div>
            </aside>
          </div>
          <footer className="workspace-footer">
            <span>COUNTERLAB · 把结论留给证据</span>
            <span>有限实例 · 明确边界 · 可重放</span>
          </footer>
        </main>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        hidden
        aria-label="导入实验包文件"
        onChange={(e) => {
          void importFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {busy && (
        <div className="busy-indicator" role="status">
          <LoaderCircle size={17} className="spin" />
          {busy}…
        </div>
      )}
      {panel === 'editor' && (
        <Modal
          title="编辑实验输入"
          subtitle="修改真实数据后，旧结果会清空；重新运行即可检验新的情况。"
          wide
          onClose={() => setPanel(null)}
        >
          {editorError && (
            <div className="notice error" role="alert">
              {editorError}
            </div>
          )}
          <InstanceEditor instance={editor} onChange={setEditor} />
          {editor.domain === 'graph' && (
            <div className="editor-graph">
              <GraphPlot instance={editor} onChange={setEditor} />
              <p className="field-note">拖动节点调整布局；聚焦节点后可使用方向键。布局不改变路径代价。</p>
            </div>
          )}
          <div className="modal-actions">
            <button className="secondary-button" onClick={() => setPanel(null)}>
              放弃本次编辑
            </button>
            <button
              className="primary-button"
              onClick={() => {
                try {
                  validateInstance(editor);
                  if (draft.evaluation) setBaseline(draft.evaluation);
                  setDraft((current) => ({
                    ...current,
                    instance: clone(editor),
                    evaluation: undefined,
                    search: undefined,
                    shrink: undefined,
                    regression: undefined,
                  }));
                  setPlaying(false);
                  setStep(0);
                  setExplanation('');
                  setPanel(null);
                  setNotice({ text: '输入已更新，请重新运行当前实例。' });
                } catch (error) {
                  setEditorError(error instanceof Error ? error.message : '输入无效');
                }
              }}
            >
              应用输入
            </button>
          </div>
        </Modal>
      )}
      {panel === 'library' && (
        <Modal
          title="实验档案"
          subtitle="保存的实验位于本机 SQLite。打开快照可以继续修改，JSON 实验包可以跨设备重放。"
          wide
          onClose={() => setPanel(null)}
        >
          <div className="library-toolbar">
            <span>{library.length} 个已保存实验</span>
            <button className="secondary-button" disabled={locked} onClick={() => fileInput.current?.click()}>
              <Upload size={14} />
              导入实验包
            </button>
          </div>
          {library.length === 0 ? (
            <div className="empty-state">
              <FolderOpen size={32} />
              <h3>还没有保存的实验</h3>
              <p>先在工作台运行一个实例，再点击「保存实验」。草稿会在此浏览器自动恢复。</p>
            </div>
          ) : (
            <div className="library-grid">
              {library.map((item) => (
                <article className="library-card" key={item.id}>
                  <span className="eyebrow">
                    {domainLabels[item.domain]} / {item.versions.length} 个版本
                  </span>
                  <h3>{item.title}</h3>
                  <p>{item.strategy.name}</p>
                  <span className={`badge ${item.evaluation?.verdict}`}>
                    {item.evaluation ? verdictText[item.evaluation.verdict] : '未计算'}
                  </span>
                  <small>{new Date(item.updatedAt).toLocaleString('zh-CN')}</small>
                  <div className="library-card-actions">
                    <button className="secondary-button" disabled={locked} onClick={() => openSaved(item)}>
                      打开实验 <ArrowRight size={14} />
                    </button>
                    {deleteId === item.id ? (
                      <>
                        <button
                          className="text-button danger"
                          disabled={locked}
                          onClick={() =>
                            void action('删除实验', async () => {
                              await api.remove(item.id);
                              setLibrary((current) => current.filter((saved) => saved.id !== item.id));
                              if (draft.id === item.id)
                                setDraft((current) => ({ ...current, id: undefined, versions: [] }));
                              setDeleteId(null);
                            })
                          }
                        >
                          确认删除
                        </button>
                        <button className="text-button" onClick={() => setDeleteId(null)}>
                          取消
                        </button>
                      </>
                    ) : (
                      <button
                        className="text-button muted"
                        disabled={locked}
                        onClick={() => setDeleteId(item.id)}
                      >
                        删除
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </Modal>
      )}
      {panel === 'versions' && (
        <Modal
          title="版本与复验"
          subtitle="每次保存不同的策略或输入，都会保留独立快照。恢复旧版后再保存，将形成新的修订。"
          wide
          onClose={() => setPanel(null)}
        >
          {draft.versions.length === 0 ? (
            <div className="empty-state">
              <History size={32} />
              <h3>先保存一个起点</h3>
              <p>保存当前实验之后，就能对比和恢复历史版本。</p>
              <button className="primary-button" disabled={locked} onClick={() => void save()}>
                保存当前实验
              </button>
            </div>
          ) : (
            <div className="version-list">
              {[...draft.versions].reverse().map((version, index) => (
                <article className="version-row" key={version.id}>
                  <span className="version-number">V{draft.versions.length - index}</span>
                  <div>
                    <h3>{version.strategy.name}</h3>
                    <p>
                      {version.note} · {new Date(version.at).toLocaleString('zh-CN')}
                    </p>
                    <code>
                      {version.strategy.algorithm} · {version.strategy.score} · {version.strategy.direction}
                    </code>
                    {version.evaluation && (
                      <p>
                        {verdictText[version.evaluation.verdict]} · 候选{' '}
                        {valueOf(version.evaluation, 'candidate')} / 参照{' '}
                        {valueOf(version.evaluation, 'reference')}
                      </p>
                    )}
                    {!version.instance && (
                      <p className="field-note">旧格式仅保留策略，恢复时沿用当前输入并重新计算。</p>
                    )}
                  </div>
                  <button
                    className="secondary-button"
                    disabled={locked}
                    onClick={() => {
                      setBaseline(draft.evaluation ?? baseline);
                      setDraft((current) => ({
                        ...current,
                        instance: clone(version.instance ?? current.instance),
                        strategy: clone(version.strategy),
                        evaluation: version.evaluation ? clone(version.evaluation) : undefined,
                        search: undefined,
                        shrink: undefined,
                        regression: undefined,
                      }));
                      setPanel(null);
                      setPlaying(false);
                      setStep(0);
                      setNotice({ text: '已恢复版本快照；保存后会形成新的修订。' });
                    }}
                  >
                    恢复此版本
                  </button>
                </article>
              ))}
            </div>
          )}
        </Modal>
      )}
      {panel === 'events' && evaluation && (
        <Modal
          title="真实执行事件"
          subtitle="两种算法的同一步号不一定处理相同对象；每条事件都来自当前实例的实际计算。"
          wide
          onClose={() => setPanel(null)}
        >
          <label className="field">
            定位步号
            <input
              aria-label="事件定位步号"
              type="range"
              min={0}
              max={maxStep}
              value={step}
              onChange={(e) => {
                setPlaying(false);
                setStep(Number(e.target.value));
              }}
            />
          </label>
          <div className="event-columns">
            <section>
              <h3>候选 · {evaluation.strategy.name}</h3>
              <EventList steps={evaluation.candidate.steps} step={step} />
            </section>
            <section>
              <h3>精确参照</h3>
              <EventList steps={evaluation.reference.steps} step={step} />
            </section>
          </div>
        </Modal>
      )}
      {panel === 'shrink' && draft.shrink && (
        <Modal
          title="逐步缩减证据"
          subtitle="每个接受步骤都重新验证约束和同一失败类型。这里展示的是实际缩减过程。"
          wide
          onClose={() => setPanel(null)}
        >
          <div className="summary-metrics">
            <div>
              <strong>
                {sizeOf(draft.shrink.original.instance)} → {sizeOf(draft.shrink.final.instance)}
              </strong>
              <span>结构元素</span>
            </div>
            <div>
              <strong>{draft.shrink.steps.length}</strong>
              <span>有效步骤</span>
            </div>
            <div>
              <strong>{draft.shrink.checks}</strong>
              <span>检查次数</span>
            </div>
          </div>
          <p className="notice">
            {draft.shrink.minimality === 'local'
              ? '对指定的删除、取最小值、折半与减一操作局部不可再缩减；不保证全局最小。'
              : '已缩减并保留反例；没有宣称全局或局部最小性。'}
          </p>
          <div className="reduction-list">
            {draft.shrink.steps.map((item, index) => (
              <details key={index}>
                <summary>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  {item.description}
                  <b>
                    {item.beforeSize} → {item.afterSize}
                  </b>
                </summary>
                <p>
                  候选 {valueOf(item.evaluation, 'candidate')} · 参照 {valueOf(item.evaluation, 'reference')}{' '}
                  · 反例独立复核成立
                </p>
                <pre>{JSON.stringify(item.instance, null, 2)}</pre>
              </details>
            ))}
            {draft.shrink.steps.length === 0 && <p>没有接受新的缩减操作，原输入保持不变。</p>}
          </div>
        </Modal>
      )}
      {panel === 'regression' && draft.regression && (
        <Modal
          title="修正前后 · 回归验证"
          subtitle={`原例、实际纳入的历史反例与独立保留样本，共 ${draft.regression.rows.length} 例。种子 ${draft.regression.seed}。`}
          wide
          onClose={() => setPanel(null)}
        >
          <div className="summary-metrics">
            <div className="improved">
              <strong>{draft.regression.improved}</strong>
              <span>改善</span>
            </div>
            <div className="regressed">
              <strong>{draft.regression.regressed}</strong>
              <span>退化</span>
            </div>
            <div>
              <strong>{draft.regression.unchanged}</strong>
              <span>不变</span>
            </div>
          </div>
          <p className="field-note">
            比较 {draft.regression.rows[0]?.before.strategy.name} →{' '}
            {draft.regression.rows[0]?.after.strategy.name}。这批样本的改善不构成普遍正确性证明。
          </p>
          <div className="regression-list">
            {draft.regression.rows.map((row, index) => (
              <details key={index}>
                <summary>
                  <span>{row.label}</span>
                  <b className={row.change}>
                    {{ improved: '改善', regressed: '退化', unchanged: '不变' }[row.change]}
                  </b>
                  <span>
                    {valueOf(row.before, 'candidate')} → {valueOf(row.after, 'candidate')}
                  </span>
                </summary>
                <p>
                  参照：{valueOf(row.after, 'reference')}。{row.after.details.join(' ')}
                </p>
                <pre>{JSON.stringify(row.instance, null, 2)}</pre>
              </details>
            ))}
          </div>
        </Modal>
      )}
      {panel === 'help' && (
        <Modal
          title="先提出规则，再检验它"
          subtitle="这是一张可操作的实验桌。搜索、缩减和解释都围绕同一个真实输入。"
          wide
          onClose={() => setPanel(null)}
        >
          <div className="guide-grid">
            <article>
              <span>01</span>
              <h3>明确实验条件</h3>
              <p>选择领域、修改输入、设定评分与平局规则。自然语言可以生成提案，但需要你确认才会应用。</p>
            </article>
            <article>
              <span>02</span>
              <h3>尝试推翻直觉</h3>
              <p>先运行一个实例，或用固定种子搜索更多情况。「未找到」仅指这一批样本，不能证明普遍正确。</p>
            </article>
            <article>
              <span>03</span>
              <h3>看清失败在哪里</h3>
              <p>缩减保持同一失败条件，双轨播放展示真实事件。首次分歧是观察，不自动等同因果解释。</p>
            </article>
            <article>
              <span>04</span>
              <h3>修改、复验、带走</h3>
              <p>
                更换策略后复验原例、最多 20 个历史反例和保留样本。保存版本、导出 JSON 后，导入会重新计算。
              </p>
            </article>
          </div>
          <div className="guide-boundaries">
            <h3>这个实验室的边界</h3>
            <p>
              区间最多 16 项，背包最多 18 项，图最多 12 个节点 / 80 条边。图只接受非负权，0-1
              物品不可拆分，区间采用允许首尾相接的半开语义。
            </p>
            <p>
              没有 API 密钥仍可完成全部本地计算。AI
              仅辅助提案和解释，可能写错文字；以程序独立核验结果为准。当前模型状态：
              {ai?.configured ? `${ai.provider} / ${ai.model}` : '未配置'}。
            </p>
            <p>
              自动草稿保存在此浏览器；「保存实验」保存到本机数据库。恢复草稿后需重新运行，避免展示旧结论。报告是
              HTML，完整重放请使用 JSON 实验包。
            </p>
            <p>键盘可访问字段、按钮和时间轴；图节点支持方向键移动。系统启用减少动画时，不播放装饰动画。</p>
          </div>
        </Modal>
      )}
      {proposal && (
        <Modal
          title="确认 AI 提案"
          subtitle="这只是待验证的策略，不是已成立的结论；确认后才会修改工作台。"
          onClose={() => setProposal(null)}
        >
          <div className="proposal-card">
            <span className="badge">真实模型提案</span>
            <h3>{proposal.strategy.name}</h3>
            <p>{proposal.explanation}</p>
            <dl>
              <dt>执行方法</dt>
              <dd>{proposal.strategy.algorithm}</dd>
              <dt>评分表达式</dt>
              <dd>
                <code>{proposal.strategy.score}</code>
              </dd>
              <dt>方向 / 平局</dt>
              <dd>
                {proposal.strategy.direction} / {proposal.strategy.tieBreak}
              </dd>
            </dl>
            <h4>适用条件与假设</h4>
            <ul>
              {proposal.assumptions.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </div>
          <div className="modal-actions">
            <button className="secondary-button" onClick={() => setProposal(null)}>
              保留原策略
            </button>
            <button
              className="primary-button"
              onClick={() => {
                changeStrategy(proposal.strategy);
                setProposal(null);
                setNotice({ text: 'AI 提案已应用。请运行或搜索以检验它。' });
              }}
            >
              确认应用策略
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
