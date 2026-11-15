import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  ENGINE_VERSION,
  evaluate,
  demoInstance,
  defaultStrategy,
  presets,
  validateStrategy,
} from '../src/engine/index.ts';
import { Store } from './store.ts';
import { Jobs, JobError } from './jobs.ts';
import { AiClient, AiError } from './ai.ts';
import {
  aiProposeSchema,
  evaluateSchema,
  checkPair,
  evaluationSchema,
  regressionSchema,
  searchOptionsSchema,
  trustedEvaluation,
} from './validation.ts';
import { report } from './report.ts';
import { MAX_REQUEST_BYTES } from './limits.ts';
import type { Domain } from '../src/shared/types.ts';

class HttpError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
  }
}
export interface AppOptions {
  dataDir?: string;
  staticDir?: string | false;
  env?: NodeJS.ProcessEnv;
  fetcher?: typeof fetch;
  jobTimeoutMs?: number;
}
export async function buildApp(options: AppOptions = {}) {
  const app = Fastify({ logger: false, bodyLimit: MAX_REQUEST_BYTES, requestTimeout: 35000 });
  const store = new Store(
    resolve(options.dataDir ?? resolve(process.cwd(), '.runtime'), 'counterlab.sqlite'),
  );
  const jobs = new Jobs(store, options.jobTimeoutMs);
  const ai = new AiClient(options.env, options.fetcher);
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer');
    if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    // Loopback binding alone does not protect against hostile DNS names resolving to it.
    try {
      const host = new URL(`http://${request.headers.host ?? ''}`);
      if (
        !['localhost', '127.0.0.1', '[::1]'].includes(host.hostname) ||
        host.username ||
        host.password ||
        host.pathname !== '/'
      )
        throw new Error();
    } catch {
      throw new HttpError('只允许通过本机地址访问实验服务', 403);
    }
    const origin = request.headers.origin;
    if (origin) {
      try {
        const url = new URL(origin);
        if (
          !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
          !['http:', 'https:'].includes(url.protocol) ||
          url.origin !== origin
        )
          throw new Error();
      } catch {
        throw new HttpError('不允许跨站请求本地实验服务', 403);
      }
    }
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError)
      return reply.code(400).send({
        error: error.issues
          .slice(0, 5)
          .map((issue) => `${issue.path.join('.') || '请求'}: ${issue.message}`)
          .join('；'),
      });
    if (error instanceof AiError || error instanceof HttpError || error instanceof JobError)
      return reply.code(error.statusCode).send({ error: error.message });
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500)
      return reply.code(status).send({ error: status === 413 ? '请求内容过大' : '请求格式或内容类型无效' });
    return reply.code(500).send({ error: '服务处理失败，已有实验数据未改变。' });
  });
  const validated = <T>(fn: () => T): T => {
    try {
      return fn();
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof HttpError || error instanceof JobError) throw error;
      throw new HttpError(error instanceof Error ? error.message : '输入无效', 400);
    }
  };
  const getExperiment = (id: string) => {
    const experiment = store.get(id);
    if (!experiment) throw new HttpError('实验不存在', 404);
    return experiment;
  };
  app.get('/api/health', async () => ({ ok: true, engineVersion: ENGINE_VERSION }));
  app.get('/api/catalog', async () => ({
    engineVersion: ENGINE_VERSION,
    domains: (
      [
        ['interval', '区间调度', '半开区间、明确目标：检查局部选择是否遗漏更好的兼容组合。'],
        ['knapsack', '0-1资源分配', '每件物品只能选择一次：比较收益、重量和密度策略。'],
        ['graph', '非负权图路由', '区分局部选择与全局距离，明确可达性和路径成本。'],
      ] as [Domain, string, string][]
    ).map(([domain, title, description]) => ({
      domain,
      title,
      description,
      instance: demoInstance(domain),
      strategy: defaultStrategy(domain),
      presets: presets(domain),
    })),
  }));
  app.post('/api/evaluate', async (request) =>
    validated(() => {
      const data = evaluateSchema.parse(request.body);
      checkPair(data.instance, data.strategy);
      return evaluate(data.instance, data.strategy);
    }),
  );
  app.get('/api/experiments', async () => store.list());
  app.post('/api/experiments', async (request) => validated(() => store.save(request.body)));
  app.get<{ Params: { id: string } }>('/api/experiments/:id', async (request) =>
    getExperiment(request.params.id),
  );
  app.put<{ Params: { id: string } }>('/api/experiments/:id', async (request) => {
    getExperiment(request.params.id);
    return validated(() => store.save(request.body, request.params.id));
  });
  app.delete<{ Params: { id: string } }>('/api/experiments/:id', async (request) => {
    getExperiment(request.params.id);
    store.delete(request.params.id);
    return { ok: true };
  });
  app.get<{ Params: { id: string } }>('/api/experiments/:id/export', async (request, reply) => {
    getExperiment(request.params.id);
    reply.header('Content-Disposition', `attachment; filename="counterlab-${request.params.id}.json"`);
    return store.export(request.params.id);
  });
  app.post('/api/import', async (request) => validated(() => store.import(request.body)));
  app.get<{ Params: { id: string } }>('/api/experiments/:id/report', async (request, reply) => {
    const experiment = getExperiment(request.params.id);
    reply
      .type('text/html; charset=utf-8')
      .header(
        'Content-Security-Policy',
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
      )
      .header('Content-Disposition', `attachment; filename="counterlab-${experiment.id}.html"`);
    return report(experiment, ENGINE_VERSION);
  });
  app.post('/api/jobs/search', async (request) =>
    validated(() => {
      const data = searchOptionsSchema.parse(request.body);
      validateStrategy(data.strategy);
      if (data.domain !== data.strategy.domain) throw new Error('搜索领域与策略不一致');
      const max = { interval: 16, knapsack: 18, graph: 12 }[data.domain];
      if (data.size > max) throw new Error('搜索实例规模超出领域上限');
      return jobs.create('search', data);
    }),
  );
  app.post('/api/jobs/shrink', async (request) =>
    validated(() => {
      const data = z.object({ evaluation: evaluationSchema }).strict().parse(request.body);
      const evaluation = trustedEvaluation(data.evaluation);
      if (evaluation.verdict !== 'counterexample') throw new Error('只有经过验证的反例才能缩减');
      return jobs.create('shrink', { evaluation });
    }),
  );
  app.post('/api/jobs/regression', async (request) =>
    validated(() => {
      const data = regressionSchema.parse(request.body);
      checkPair(data.instance, data.before);
      checkPair(data.instance, data.after);
      return jobs.create('regression', {
        ...data,
        history: data.includeHistory === false ? [] : store.history(data.instance.domain),
      });
    }),
  );
  app.get<{ Params: { id: string } }>('/api/jobs/:id', async (request) => {
    const job = jobs.get(request.params.id);
    if (!job) throw new HttpError('任务不存在', 404);
    return job;
  });
  app.post<{ Params: { id: string } }>('/api/jobs/:id/cancel', async (request) => {
    const job = jobs.cancel(request.params.id);
    if (!job) throw new HttpError('任务不存在', 404);
    return job;
  });
  app.get('/api/ai/status', async () => ai.status());
  app.post('/api/ai/propose', async (request) => {
    const data = validated(() => {
      const parsed = aiProposeSchema.parse(request.body);
      validateStrategy(parsed.currentStrategy);
      if (parsed.domain !== parsed.currentStrategy.domain) throw new Error('当前策略领域不一致');
      return parsed;
    });
    return ai.propose(data);
  });
  app.post('/api/ai/explain', async (request) => {
    const data = validated(() => z.object({ evaluation: evaluationSchema }).strict().parse(request.body));
    const evaluation = validated(() => trustedEvaluation(data.evaluation));
    return ai.explain(evaluation);
  });
  const staticDir =
    options.staticDir === false ? undefined : resolve(options.staticDir ?? resolve(process.cwd(), 'dist'));
  if (staticDir && existsSync(staticDir)) {
    await app.register(fastifyStatic, {
      root: staticDir,
      index: 'index.html',
      dotfiles: 'deny',
      list: false,
    });
    app.setNotFoundHandler((request, reply) =>
      request.url.startsWith('/api/')
        ? reply.code(404).send({ error: '接口不存在' })
        : reply.sendFile('index.html'),
    );
  } else
    app.setNotFoundHandler((_request, reply) =>
      reply.code(404).send({ error: '接口不存在；开发界面请使用Vite，发行界面请先执行构建。' }),
    );
  app.addHook('onClose', async () => {
    await jobs.close();
    store.close();
  });
  return app;
}
