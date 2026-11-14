# Shared module and API contract

Types: `src/shared/types.ts` (root-owned). Engine exports `ENGINE_VERSION`, `evaluate(instance,strategy)`, `validateInstance(instance)`, `validateStrategy(strategy)`, `search(options,onProgress?,isCancelled?)`, `shrink(evaluation,onProgress?,isCancelled?)`, `regress(instance,before,after,seed,count,onProgress?,isCancelled?)`, `defaultStrategy(domain)`, `demoInstance(domain)` and `presets(domain)` from `src/engine/index.ts`.

All deterministic engine functions are synchronous and execute in a worker for expensive API jobs. Validation throws human-readable Error. UI imports types and lightweight examples/presets only; API performs trusted evaluation. Engine outputs plain JSON values (no Infinity/NaN). Graph unreachable uses complete=false plus an explicit reason and a finite value sentinel, never serializes Infinity. Strategies carry a safely interpreted score arithmetic string, not JS.

API envelope: successful direct endpoint returns actual value; error is `{error:string}` with appropriate non-2xx code. Job results are separate JobStatus objects.

- GET /api/health -> {ok:true,engineVersion:string}
- GET /api/catalog -> {domains:[{domain,title,description,instance,strategy,presets:Strategy[]}],engineVersion:string}
- POST /api/evaluate {instance,strategy} -> Evaluation
- GET /api/experiments -> Experiment[]
- POST /api/experiments {title,instance,strategy,...optional saved results} -> Experiment
- GET /api/experiments/:id -> Experiment
- PUT /api/experiments/:id {title,instance,strategy,...saved results} -> Experiment (preserve createdAt, append strategy version on actual strategy change)
- DELETE /api/experiments/:id -> {ok:true} (only D runtime records)
- POST /api/jobs/search SearchOptions -> JobStatus
- POST /api/jobs/shrink {evaluation} -> JobStatus
- POST /api/jobs/regression {instance,before,after,seed,count} -> JobStatus
- GET /api/jobs/:id -> JobStatus
- POST /api/jobs/:id/cancel -> JobStatus
- GET /api/experiments/:id/export -> ExperimentPackage downloadable JSON
- POST /api/import ExperimentPackage -> Experiment; validate hash, version, contract, re-evaluate instead of trusting imported verdict
- GET /api/experiments/:id/report -> escaped, standalone HTML report
- GET /api/ai/status -> AiStatus (never secret)
- POST /api/ai/propose {domain,instruction,currentStrategy} -> AiProposal; absent key returns 503, never simulated live result
- POST /api/ai/explain {evaluation} -> {text,source:'live-model'}

Default listen 127.0.0.1:4317; Vite dev 5173 proxies /api. Same-origin local-first; do not expose arbitrary network listener. Persist in ignored .runtime directory, never OS temp/C drive. Node24 built-in sqlite may be used after checking support. Limit body sizes, input bounds and job concurrency. Credentials via env only. Keyless UI explicitly indicates offline deterministic mode.

