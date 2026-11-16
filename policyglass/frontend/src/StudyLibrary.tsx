import { useEffect, useState } from 'react';
import { api, fmt, type Doc } from './core';

const labels: Record<string, string> = {
  ppo_reference: 'PPO · 参考学习率',
  ppo_large_step: 'PPO · 过大学习率',
  sac_reuse1: 'SAC · 每交互 1 次更新',
  sac_reuse4: 'SAC · 每交互 4 次更新',
};
const statusLabels: Record<string, string> = {
  completed: '完成该预算',
  failed: '失败',
  running: '仍在计算',
  timeout: '超时',
  cancelled: '取消',
  not_reported: '尚无记录',
  invalid_result: '记录无效',
};
const availabilityLabels: Record<string, string> = {
  available: '检查点校验通过',
  result_not_completed: '尚无已完成检查点',
  invalid_summary: '成绩与计数不完整或不一致',
  missing_recorded_hash: '缺少来源哈希',
  checkpoint_missing: '本机未附检查点',
  checkpoint_hash_mismatch: '检查点哈希不符',
  checkpoint_boundary_or_read_error: '文件边界或读取检查失败',
  report_unavailable: '研究报告不可用',
};

export function StudyLibrary({ onOpen }: { onOpen: (experimentId: string) => void | Promise<void> }) {
  const [document, setDocument] = useState<Doc | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState('');
  const [error, setError] = useState('');

  const reload = async () => {
    setLoading(true);
    setError('');
    try {
      setDocument(await api('/studies/reference'));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    reload();
  }, []);

  const importCheckpoint = async (row: Doc) => {
    setImporting(`${row.condition}-${row.seed}`);
    setError('');
    try {
      const result = await api('/studies/reference/import', { condition: row.condition, seed: row.seed });
      await onOpen(result.experiment.id);
    } catch (e) {
      setError(String(e));
    } finally {
      setImporting('');
    }
  };

  const rows: Doc[] = document?.rows ?? [];
  const protocol = document?.protocol;
  const conditions = [...new Set<string>(rows.map((row) => row.condition))];

  return (
    <section aria-labelledby="study-library-title" className="study-library">
      <div className="section-heading">
        <div>
          <span className="eyebrow">ALL REGISTERED SEEDS</span>
          <h2 id="study-library-title">真实训练研究 · 全部种子</h2>
        </div>
        <button onClick={reload} disabled={loading || !!importing}>
          重新读取研究记录
        </button>
      </div>
      <p>
        查看每次训练的真实预算、评价与失败，或将任意已校验检查点复制为新实验继续检查。导入不训练、不覆盖已有实验，也不默认挑选最好种子。
      </p>
      <p className="small">
        {document?.scope ?? '固定空间机械臂目标；研究文件尚未读取。完成一次计算预算不代表策略已普遍成功。'}
      </p>
      {loading && <p role="status">正在核对本地研究文件与检查点…</p>}
      {error && <p role="alert">{error}</p>}
      {document?.error && <p role="status">{document.error}</p>}
      {document && (
        <p className="small">
          登记 {rows.length} 条 · 已完成预算 {rows.filter((row) => row.status === 'completed').length} 条 ·
          本机可导入 {rows.filter((row) => row.available).length} 条。缺失和失败仍保留在表内。
        </p>
      )}
      {protocol && (
        <details>
          <summary>预登记预算与评价范围</summary>
          <p>
            网络隐藏层 {protocol.network.join(' × ')}；训练种子 {protocol.training_seeds.join(' / ')}
            ；每次冻结均值动作策略，在初始状态种子 {protocol.evaluation_seeds.join(' / ')} 上各运行最多{' '}
            {protocol.evaluation_steps} 步。
          </p>
          <p className="small">
            表中时间为实际观测总耗时，受并发环境影响，不作为隔离的算法速度基准。五个训练种子是重复单位，不将各评价回合当作独立训练策略。
          </p>
        </details>
      )}
      {conditions.map((condition) => {
        const group = rows.filter((row) => row.condition === condition);
        const budget = protocol?.conditions.find((item: Doc) => item.name === condition);
        const stats = document?.aggregates?.[condition]?.mean_distance_m;
        return (
          <details key={condition} open>
            <summary>
              {labels[condition] ?? condition} · {condition}
            </summary>
            <p className="small">
              登记交互预算 {budget?.environment_steps ?? group[0]?.budget_env_steps ?? '未提供'}；
              {budget?.learning_rate !== undefined && `学习率 ${budget.learning_rate}；`}
              {budget?.updates_per_step !== undefined && `每交互更新 ${budget.updates_per_step}；`}
              {stats &&
                `已完成种子最终平均距离中位数 ${fmt(stats.median)} m，四分位区间 [${fmt(stats.q25)}, ${fmt(stats.q75)}] m。`}
            </p>
            <div
              tabIndex={0}
              role="region"
              aria-label={`${condition} 全种子成绩表（可横向滚动）`}
              style={{ overflowX: 'auto', maxWidth: '100%' }}
            >
              <table style={{ width: '100%', minWidth: 880, borderCollapse: 'collapse' }}>
                <caption style={{ textAlign: 'left' }}>
                  全部五个登记种子；评价值是该训练种子在五个固定初始状态上的均值。
                </caption>
                <thead>
                  <tr>
                    <th scope="col">种子 / 状态</th>
                    <th scope="col">交互 / 更新</th>
                    <th scope="col">耗时 s</th>
                    <th scope="col">初始→最终平均距离 m</th>
                    <th scope="col">末32步距离 m</th>
                    <th scope="col">累计回报</th>
                    <th scope="col">评估步 &lt;4cm 占比</th>
                    <th scope="col">自产状态</th>
                  </tr>
                </thead>
                <tbody>
                  {group.map((row) => {
                    const metrics = row.metrics;
                    const key = `${condition}-${row.seed}`;
                    return (
                      <tr key={key}>
                        <th scope="row">
                          {row.seed}
                          <br />
                          <span className="small">{statusLabels[row.status] ?? row.status}</span>
                          {row.error && <p role="status">{row.error}</p>}
                        </th>
                        <td>
                          {fmt(metrics.env_steps)} / {fmt(metrics.updates)}
                        </td>
                        <td>{fmt(metrics.seconds)}</td>
                        <td>
                          {fmt(metrics.initial_mean_distance_m)} → {fmt(metrics.mean_distance_m)}
                        </td>
                        <td>{fmt(metrics.last32_distance_m)}</td>
                        <td>{fmt(metrics.return)}</td>
                        <td>
                          {metrics.success_fraction == null
                            ? '未计算'
                            : `${fmt(metrics.success_fraction * 100)}%`}
                        </td>
                        <td>
                          <button
                            aria-label={`导入 ${condition} seed ${row.seed}`}
                            disabled={!row.available || !!importing || loading}
                            onClick={() => importCheckpoint(row)}
                          >
                            {importing === key ? '正在安全导入…' : `导入 seed ${row.seed}`}
                          </button>
                          <br />
                          <span className="small">
                            {availabilityLabels[row.availability] ?? row.availability}
                          </span>
                          {row.checkpoint_sha256 && (
                            <details>
                              <summary>来源 SHA256</summary>
                              <code style={{ overflowWrap: 'anywhere' }}>{row.checkpoint_sha256}</code>
                            </details>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
        );
      })}
    </section>
  );
}
