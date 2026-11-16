import { useEffect, useRef, useState } from 'react';
import { api, type Doc } from './core';

export interface ExplanationProps {
  experimentId: string;
  traceId: string;
  eventIndex: number;
  onLocate: (eventIndex: number) => void;
}

/** Optional read-only assistant: preview → explicit send → source-bound answer. */
export function Explanation({ experimentId, traceId, eventIndex, onLocate }: ExplanationProps) {
  const [status, setStatus] = useState<Doc | null>(null);
  const [question, setQuestion] = useState('请解释当前事件中的数值、梯度来源与适用边界。');
  const [preview, setPreview] = useState<Doc | null>(null);
  const [job, setJob] = useState<Doc | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const jobId = useRef('');
  const generation = useRef(0);
  const active = job?.status === 'queued' || job?.status === 'requesting';
  const request = { trace_id: traceId, event_indices: [eventIndex], question };

  useEffect(() => {
    let current = true;
    api('/explanations/status')
      .then((value) => current && setStatus(value))
      .catch((e) => current && setError(String(e)));
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    generation.current++;
    setPreview(null);
    setJob(null);
    setError('');
    setBusy(false);
    return () => {
      generation.current++;
      const pending = jobId.current;
      jobId.current = '';
      if (pending) api(`/explanations/${pending}/cancel`, {}).catch(() => {});
    };
  }, [experimentId, traceId]);

  useEffect(() => {
    generation.current++;
    setPreview(null);
    setBusy(false);
  }, [eventIndex, question]);

  useEffect(() => {
    if (!job?.id || !active) return;
    let closed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = await api(`/explanations/${job.id}`);
        if (closed) return;
        setJob(value);
        if (value.status === 'queued' || value.status === 'requesting') timer = setTimeout(poll, 400);
        else {
          jobId.current = '';
          setStatus(await api('/explanations/status'));
        }
      } catch (e) {
        if (!closed) {
          setError(String(e));
          timer = setTimeout(poll, 1000);
        }
      }
    };
    timer = setTimeout(poll, 200);
    return () => {
      closed = true;
      clearTimeout(timer);
    };
  }, [job?.id, active]);

  const makePreview = async () => {
    const token = ++generation.current;
    setBusy(true);
    setError('');
    try {
      const value = await api(`/experiments/${experimentId}/explanations/preview`, request);
      if (token === generation.current) {
        setPreview({ ...value, request });
        setJob(null);
      }
    } catch (e) {
      if (token === generation.current) setError(String(e));
    } finally {
      if (token === generation.current) setBusy(false);
    }
  };

  const send = async () => {
    if (!preview) return;
    const token = generation.current;
    setBusy(true);
    setError('');
    try {
      const value = await api(`/experiments/${experimentId}/explanations`, {
        request: preview.request,
        preview_sha256: preview.sha256,
        consent: true,
      });
      if (token === generation.current) {
        jobId.current = value.id;
        setJob(value);
        setPreview(null);
      } else await api(`/explanations/${value.id}/cancel`, {});
    } catch (e) {
      if (token === generation.current) setError(String(e));
    } finally {
      if (token === generation.current) setBusy(false);
    }
  };

  const cancel = async () => {
    if (!job?.id) return;
    try {
      setJob(await api(`/explanations/${job.id}/cancel`, {}));
      jobId.current = '';
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <section aria-labelledby="explanation-title" className="explanation-panel">
      <h2 id="explanation-title">数值讲解助手 · 可选</h2>
      <p className="small">
        引用已选事件解释真实计算。模型回答需对照原始数值；引用检查只核对来源，不能保证结论正确。
      </p>
      <p role="status" className="small">
        {status
          ? status.configured
            ? `DeepSeek · ${status.model} · 剩余 ${status.remaining_requests} 次请求 · 单次最多 ${status.max_tokens_per_request} 输出 token`
            : '未配置 DeepSeek；课程、公式、训练与三维实验可继续离线使用。'
          : '正在读取讲解服务状态…'}
        {status?.configuration_error && ' 服务端配置无效，请检查本地配置。'}
      </p>
      {!traceId && <p>先选择一个真实计算事件，再预览需要发送的内容。</p>}
      <label htmlFor="explanation-question">关于所选事件的问题</label>
      <textarea
        id="explanation-question"
        value={question}
        maxLength={1600}
        disabled={active || busy}
        onChange={(e) => setQuestion(e.target.value)}
      />
      <p className="small">
        仅发送该问题、已选事件的有限数值节选及来源版本。不发送笔记、完整实验、其他事件或密钥。可先查看完整外发预览；发送会使用官方
        API 配额。
      </p>
      <button onClick={makePreview} disabled={!traceId || !question.trim() || busy || active}>
        预览将发送的内容
      </button>
      {preview && (
        <div>
          <p>将发送到 DeepSeek 官方服务 · {preview.bytes} 字节。张量节选的省略在预览中明确标记。</p>
          <details open>
            <summary>完整外发内容</summary>
            <pre
              style={{ maxHeight: 300, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
            >
              {JSON.stringify(preview.payload, null, 2)}
            </pre>
          </details>
          <button className="primary" onClick={send} disabled={!status?.configured || busy}>
            同意发送这些内容
          </button>
        </div>
      )}
      {job && (
        <div aria-live="polite">
          <p>
            真实请求状态：
            {(
              {
                queued: '排队',
                requesting: '请求官方服务中',
                completed: '已收到并校验结构',
                cancelled: '已取消',
                failed: '失败',
              } as Doc
            )[job.status] ?? job.status}
          </p>
          {active && <button onClick={cancel}>取消讲解请求</button>}
          {job.error && <p role="alert">{job.error}</p>}
          {job.result && (
            <>
              <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{job.result.answer}</p>
              <p className="small">来源事件：</p>
              {job.result.citations.map((id: string) => {
                const source = job.citations.find((c: Doc) => c.event_id === id);
                return (
                  <button key={id} onClick={() => source && onLocate(source.event_index)}>
                    {id}
                  </button>
                );
              })}
              {job.result.suggestion && (
                <details>
                  <summary>待人工复核的干预建议（未执行）</summary>
                  <p>{job.result.suggestion.reason}</p>
                  <pre style={{ whiteSpace: 'pre-wrap' }}>
                    {JSON.stringify(
                      {
                        kind: job.result.suggestion.kind,
                        path: job.result.suggestion.path,
                        value: job.result.suggestion.value,
                      },
                      null,
                      2,
                    )}
                  </pre>
                  <p className="small">在分支面板检查原始检查点、单个改动及预算后再手动执行。</p>
                </details>
              )}
              <p className="small">
                返回模型：{job.served_model} · 供应商报告用量：{job.usage?.total_tokens ?? '未返回'}{' '}
                token。取消或失败也可能产生费用。
              </p>
            </>
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
