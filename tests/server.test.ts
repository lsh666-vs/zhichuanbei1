import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildApp, type AppOptions } from '../server/app.ts';
import { checksum, Store } from '../server/store.ts';
import { demoInstance, defaultStrategy, evaluate, presets, regress } from '../src/engine/index.ts';
import { generateInstance, seededRandom } from '../src/engine/generation.ts';
import { MAX_REQUEST_BYTES } from '../server/limits.ts';
import type { Evaluation, Experiment, ExperimentPackage, GraphInstance, JobStatus, ShrinkResult } from '../src/shared/types.ts';

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let dataDir: string;
const input = () => ({ title: '真实的区间实验', instance: demoInstance('interval'), strategy: defaultStrategy('interval') });
const api = (method: 'GET'|'POST'|'PUT'|'DELETE', url: string, payload?: unknown) => app.inject({ method, url, ...(payload === undefined ? {} : { payload: JSON.stringify(payload), headers: { 'content-type':'application/json' } }) });
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function reset(options: Partial<AppOptions> = {}) {
  if(app)await app.close();
  app=await buildApp({dataDir,staticDir:false,env:{},...options});
}
async function saved(): Promise<Experiment> {
  const response=await api('POST','/api/experiments',input());
  expect(response.statusCode).toBe(200);return response.json();
}
function rehash(pkg: ExperimentPackage): ExperimentPackage {
  const {checksum:_checksum,...rest}=pkg;return {...rest,checksum:checksum(rest)};
}
async function completed(id:string):Promise<JobStatus> {
  for(let count=0;count<500;count++){
    const response=await api('GET',`/api/jobs/${id}`);expect(response.statusCode).toBe(200);
    const status=response.json<JobStatus>();
    if(!['queued','running'].includes(status.state))return status;
    await sleep(20);
  }
  throw new Error('Worker did not finish in 10 seconds');
}
beforeEach(async()=>{
  const parent=resolve(process.cwd(),'.runtime','api-tests');mkdirSync(parent,{recursive:true});
  dataDir=mkdtempSync(resolve(parent,'case-'));
  app=await buildApp({dataDir,staticDir:false,env:{}});
});
afterEach(async()=>{await app.close()});

describe('API contracts and local boundary',()=>{
  test('catalog exposes all three domains and deterministic independently verified evaluations',async()=>{
    expect((await api('GET','/api/health')).json()).toMatchObject({ok:true});
    const catalog=(await api('GET','/api/catalog')).json();expect(catalog.domains.map((item:{domain:string})=>item.domain)).toEqual(['interval','knapsack','graph']);
    for(const entry of catalog.domains){
      const pair={instance:entry.instance,strategy:entry.strategy};
      const first=await api('POST','/api/evaluate',pair),second=await api('POST','/api/evaluate',pair);
      expect(first.statusCode).toBe(200);expect(first.json()).toEqual(second.json());
      expect(first.json()).toMatchObject({witnessVerified:true,verdict:'counterexample'});
    }
  });
  test('rejects executable expressions, duplicates, mismatched domains, unknown fields and overlarge bodies',async()=>{
    const pair=input();const {title:_title,...evaluation}=pair;
    expect((await api('POST','/api/evaluate',{...evaluation,strategy:{...pair.strategy,score:'process.exit()'}})).statusCode).toBe(400);
    expect((await api('POST','/api/evaluate',{...evaluation,strategy:defaultStrategy('graph')})).statusCode).toBe(400);
    expect((await api('POST','/api/evaluate',{...evaluation,shell:'anything'})).statusCode).toBe(400);
    if(pair.instance.domain==='interval')pair.instance.items[1].id=pair.instance.items[0].id;
    expect((await api('POST','/api/evaluate',{instance:pair.instance,strategy:pair.strategy})).statusCode).toBe(400);
    const oversized=await api('POST','/api/experiments',{title:'x'.repeat(MAX_REQUEST_BYTES)});
    expect(oversized.statusCode).toBe(413);expect(oversized.json().error).toContain('过大');
    expect((await api('GET','/api/missing')).statusCode).toBe(404);
  });
  test('rejects remote Origin, null Origin and rebinding Host while accepting Vite loopback origins',async()=>{
    for(const headers of [{origin:'https://attacker.example'},{origin:'null'},{origin:'http://localhost.evil.example'},{host:'attacker.example:4317'},{host:'127.0.0.1.evil.example'}]){
      const response=await app.inject({url:'/api/health',headers});expect(response.statusCode).toBe(403);
    }
    const response=await app.inject({url:'/api/health',headers:{host:'127.0.0.1:4317',origin:'http://localhost:5173'}});
    expect(response.statusCode).toBe(200);expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });
  test('refuses a C drive database path before touching files',()=>{
    if(process.platform==='win32')expect(()=>new Store('C:\\counterlab-prohibited-test\\data.sqlite')).toThrow('D 盘');
  });
  test('API accepts the engine maximum item value of 100000 and rejects 100001',async()=>{
    for(const domain of ['interval','knapsack'] as const){
      const instance=demoInstance(domain);if(instance.domain==='graph')throw new Error();
      instance.items[0].value=100000;
      expect((await api('POST','/api/evaluate',{instance,strategy:defaultStrategy(domain)})).statusCode).toBe(200);
      instance.items[0].value=100001;
      expect((await api('POST','/api/evaluate',{instance,strategy:defaultStrategy(domain)})).statusCode).toBe(400);
    }
  });
  test('production static startup serves build assets but never dotfiles, outside source or directory listings',async()=>{
    const staticDir=resolve(dataDir,'dist');mkdirSync(resolve(staticDir,'assets'),{recursive:true});mkdirSync(resolve(staticDir,'.git'));
    writeFileSync(resolve(staticDir,'index.html'),'<!doctype html><title>CounterLab fixture</title><main>Build served</main>');
    writeFileSync(resolve(staticDir,'assets','app.js'),'window.counterlabFixture=true;');
    writeFileSync(resolve(staticDir,'.env'),'fixture-hidden-do-not-expose');
    writeFileSync(resolve(staticDir,'.git','config'),'fixture-git-do-not-expose');
    writeFileSync(resolve(dataDir,'private-source.ts'),'fixture-source-do-not-expose');
    await reset({staticDir});
    const address=await app.listen({host:'127.0.0.1',port:0});const page=await fetch(address);
    expect(page.status).toBe(200);expect(await page.text()).toContain('Build served');
    expect((await api('GET','/assets/app.js')).body).toContain('window.counterlabFixture');
    for(const path of ['/.env','/.git/config','/%2eenv','/../private-source.ts','/..%2fprivate-source.ts','/server/ai.ts','/assets/']){
      const response=await api('GET',path);
      expect(response.body).not.toMatch(/fixture-(hidden|git|source)-do-not-expose/);
      expect(response.body).not.toContain('app.js');expect(response.body).not.toContain('COUNTERLAB_AI_KEY');
    }
    expect((await api('GET','/api/does-not-exist')).statusCode).toBe(404);
  });
});

describe('SQLite persistence, versions and trustworthy packages',()=>{
  test('recomputes fabricated results, versions only strategy edits, and persists across restart',async()=>{
    const original=input(),actual=evaluate(original.instance,original.strategy);
    const response=await api('POST','/api/experiments',{...original,evaluation:{...actual,candidate:{value:999999},reference:null,verdict:'pass',witnessVerified:false,difference:0}});
    expect(response.statusCode).toBe(200);const created=response.json<Experiment>();
    expect(created.evaluation).toEqual(actual);expect(created.versions).toHaveLength(1);
    const renamed=(await api('PUT',`/api/experiments/${created.id}`,{...original,title:"quote' ; DROP TABLE experiments;--"})).json<Experiment>();
    expect(renamed.versions).toHaveLength(1);expect(renamed.createdAt).toBe(created.createdAt);
    const changed={...original,strategy:presets('interval').find(p=>p.algorithm==='optimal')!};
    const updated=(await api('PUT',`/api/experiments/${created.id}`,changed)).json<Experiment>();
    expect(updated.versions).toHaveLength(2);expect(updated.evaluation?.verdict).toBe('pass');
    await reset();expect((await api('GET',`/api/experiments/${created.id}`)).json()).toEqual(updated);
    expect((await api('GET','/api/experiments')).json()).toHaveLength(1);
    expect((await api('PUT',`/api/experiments/${created.id}`,{title:'换域',instance:demoInstance('knapsack'),strategy:defaultStrategy('knapsack')})).statusCode).toBe(400);
    expect((await api('DELETE',`/api/experiments/${created.id}`)).json()).toEqual({ok:true});
    expect((await api('GET',`/api/experiments/${created.id}`)).statusCode).toBe(404);
  });
  test('export checksum is key-order stable, detects edits and rejects unsupported engine versions',async()=>{
    expect(checksum({z:1,a:{y:2,x:3}})).toBe(checksum({a:{x:3,y:2},z:1}));
    const created=await saved();const exported=await api('GET',`/api/experiments/${created.id}/export`);
    expect(exported.headers['content-disposition']).toContain('.json');
    const pkg=exported.json<ExperimentPackage>();expect(rehash(pkg).checksum).toBe(pkg.checksum);
    const altered=structuredClone(pkg);altered.experiment.title='改写';
    expect((await api('POST','/api/import',altered)).statusCode).toBe(400);
    expect((await api('POST','/api/import',rehash({...pkg,engineVersion:'future-incompatible'}))).statusCode).toBe(400);
    const imported=(await api('POST','/api/import',pkg)).json<Experiment>();
    expect(imported.id).not.toBe(created.id);expect(imported.evaluation).toEqual(created.evaluation);expect(imported.versions).toEqual(created.versions);
  });
  test('a valid checksum cannot authenticate forged evaluations or historical versions',async()=>{
    const created=await saved();const pkg=(await api('GET',`/api/experiments/${created.id}/export`)).json<ExperimentPackage>();
    pkg.experiment.evaluation!.verdict='pass';pkg.experiment.evaluation!.candidate.value=987654;
    pkg.experiment.evaluation!.difference=0;pkg.experiment.evaluation!.witnessVerified=false;
    const result=await api('POST','/api/import',rehash(pkg));expect(result.statusCode).toBe(200);
    expect(result.json<Experiment>().evaluation).toEqual(created.evaluation);
    pkg.experiment.versions[0].strategy=presets('interval').find(p=>p.algorithm==='optimal')!;
    expect((await api('POST','/api/import',rehash(pkg))).statusCode).toBe(400);
  });
  test('input revisions preserve old witnesses and imported snapshot results are recomputed',async()=>{
    const created=await saved(),changed=input();
    if(changed.instance.domain==='interval')changed.instance.items[0].value=12;
    const updated=(await api('PUT',`/api/experiments/${created.id}`,changed)).json<Experiment>();
    expect(updated.versions).toHaveLength(2);expect(updated.versions[0].instance).toEqual(created.instance);
    expect(updated.versions[0].evaluation?.verdict).toBe('counterexample');expect(updated.versions[1].evaluation?.verdict).toBe('pass');
    const pkg=(await api('GET',`/api/experiments/${created.id}/export`)).json<ExperimentPackage>();
    pkg.experiment.versions[0].evaluation!.candidate.value=99999;pkg.experiment.versions[0].evaluation!.verdict='pass';
    const response=await api('POST','/api/import',rehash(pkg));expect(response.statusCode).toBe(200);
    expect(response.json<Experiment>().versions[0].evaluation).toEqual(created.evaluation);
    // Packages written before snapshot support remain replayable.
    for(const version of pkg.experiment.versions){delete version.instance;delete version.evaluation;}
    expect((await api('POST','/api/import',rehash(pkg))).statusCode).toBe(200);
  });
  test('HTML report escapes labels and titles and locks down executable content',async()=>{
    const data=input();data.title='<script>alert("title")</script>';
    if(data.instance.domain==='interval')data.instance.items[0].label='<img src=x onerror=alert(1)>';
    const created=(await api('POST','/api/experiments',data)).json<Experiment>();
    const response=await api('GET',`/api/experiments/${created.id}/report`);
    expect(response.statusCode).toBe(200);expect(response.headers['content-type']).toContain('text/html');
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    expect(response.body).toContain('&lt;script&gt;');expect(response.body).toContain('&lt;img');
    expect(response.body).not.toContain('<script>');expect(response.body).not.toContain('<img');
    expect(response.body).toContain('有限样本通过不构成普遍正确性证明');
  });
  test('search evidence is rechecked and unverified sampling statistics are explicitly labeled',async()=>{
    const data=input(),evaluation=evaluate(data.instance,data.strategy);
    const search={status:'counterexample',checked:1,total:100,seed:42,elapsedMs:1,evaluation:{...evaluation,verdict:'pass',difference:0}};
    const response=await api('POST','/api/experiments',{...data,search});expect(response.statusCode).toBe(200);
    expect(response.json<Experiment>().search?.evaluation?.verdict).toBe('counterexample');
    expect(response.json<Experiment>().search?.reason).toContain('采样覆盖未重新执行');
    expect((await api('POST','/api/experiments',{...data,search:{...search,status:'not_found'}})).statusCode).toBe(400);
    expect((await api('POST','/api/experiments',{...data,search:{...search,checked:101}})).statusCode).toBe(400);
    expect((await api('POST','/api/experiments',{...data,search:{status:'not_found',checked:0,total:100,seed:42,elapsedMs:0}})).statusCode).toBe(400);
  });
  test('recomputes graph dead-end regressions without treating sentinel zero as an optimal path',async()=>{
    const instance:GraphInstance={domain:'graph',directed:true,source:'S',target:'T',nodes:[{id:'S',label:'S',x:0,y:0},{id:'A',label:'A',x:1,y:1},{id:'T',label:'T',x:2,y:0}],edges:[{id:'SA',from:'S',to:'A',weight:1},{id:'ST',from:'S',to:'T',weight:4}]};
    const before=evaluate(instance,defaultStrategy('graph')),after=evaluate(instance,presets('graph')[1]);
    expect(before.candidate.complete).toBe(false);expect(before.difference).toBe(0);expect(after.verdict).toBe('pass');
    const regression={rows:[{label:'死路',instance,before,after,change:'regressed'}],improved:0,regressed:9,unchanged:8,seed:7};
    const response=await api('POST','/api/experiments',{title:'死路修复',instance,strategy:after.strategy,regression});
    expect(response.statusCode).toBe(200);expect(response.json<Experiment>().regression).toMatchObject({improved:1,regressed:0,unchanged:0,rows:[{change:'improved'}]});
  });
  test('pure input permutation is not accepted as a shrinking step',async()=>{
    const instance=demoInstance('knapsack'),strategy=defaultStrategy('knapsack');if(instance.domain!=='knapsack')throw new Error();
    const original=evaluate(instance,strategy),permuted={...instance,items:[...instance.items].reverse()},final=evaluate(permuted,strategy);
    const shrink={original,final,steps:[{description:'假缩减',beforeSize:3,afterSize:3,instance:permuted,evaluation:final}],checks:1,minimality:'local',elapsedMs:0};
    const response=await api('POST','/api/experiments',{title:'排列不是缩减',instance,strategy,shrink});
    expect(response.statusCode).toBe(400);expect(response.body).toContain('降低数值');
  });
  test('a maximum 121-row graph regression larger than 4 MiB saves and roundtrips all traces',async()=>{
    const random=seededRandom(921),instance=generateInstance('graph',12,100,random);
    const history=Array.from({length:20},()=>generateInstance('graph',12,100,random));
    const [before,after]=presets('graph'),regression=regress(instance,before,after,932,100,undefined,undefined,history);
    expect(regression.rows).toHaveLength(121);expect(Buffer.byteLength(JSON.stringify(regression))).toBeGreaterThan(4*1024*1024);
    const response=await api('POST','/api/experiments',{title:'最大规模回归',instance,strategy:after,regression});
    expect(response.statusCode,response.body.slice(0,100)).toBe(200);const created=response.json<Experiment>();
    const exported=await api('GET',`/api/experiments/${created.id}/export`);
    const imported=await api('POST','/api/import',exported.json());expect(imported.statusCode,imported.body.slice(0,100)).toBe(200);
    expect(imported.json<Experiment>().regression).toEqual(created.regression);
  },20000);
});

describe('bounded background workers',()=>{
  test('actual search, shrink and holdout workers complete and saved evidence replays',async()=>{
    const data=input();
    const search=await api('POST','/api/jobs/search',{domain:'interval',strategy:data.strategy,seed:42,attempts:100,size:6,maxValue:20});
    expect(search.statusCode).toBe(200);const searchJob=await completed(search.json<JobStatus>().id);
    expect(searchJob.state).toBe('completed');expect(searchJob.result).toMatchObject({status:'counterexample',seed:42});
    expect(searchJob.progress.found).toBe(1);expect(searchJob.progress.checked).toBeGreaterThan(0);
    const startShrink=await api('POST','/api/jobs/shrink',{evaluation:evaluate(data.instance,data.strategy)});
    const shrinkJob=await completed(startShrink.json<JobStatus>().id);expect(shrinkJob.state).toBe('completed');
    const result=shrinkJob.result as ShrinkResult;expect(result.final.verdict).toBe('counterexample');expect(result.steps.length).toBeGreaterThan(0);
    const after=presets('interval').find(p=>p.algorithm==='optimal')!;
    const startRegression=await api('POST','/api/jobs/regression',{instance:result.final.instance,before:data.strategy,after,seed:71,count:6});
    const regressionJob=await completed(startRegression.json<JobStatus>().id);expect(regressionJob.state).toBe('completed');
    expect(regressionJob.result).toMatchObject({regressed:0,seed:71});
    const response=await api('POST','/api/experiments',{...data,search:searchJob.result,shrink:result,regression:regressionJob.result});
    expect(response.statusCode,response.body).toBe(200);const experiment=response.json<Experiment>();
    expect(experiment.shrink?.minimality).toBe('reduced');expect(experiment.regression?.rows).toHaveLength(7);
    const pkg=(await api('GET',`/api/experiments/${experiment.id}/export`)).json();
    expect((await api('POST','/api/import',pkg)).statusCode).toBe(200);
    const forged=structuredClone(result);forged.steps[0].beforeSize=999;
    expect((await api('POST','/api/experiments',{...data,shrink:forged})).statusCode).toBe(400);
  },25000);
  test('caps queued work, cancels running and queued jobs and never reports cancellation as not_found',async()=>{
    const strategy=presets('interval').find(p=>p.algorithm==='optimal')!;
    const responses=await Promise.all(Array.from({length:9},()=>api('POST','/api/jobs/search',{domain:'interval',strategy,seed:42,attempts:2000,size:16})));
    expect(responses.filter(response=>response.statusCode===429)).toHaveLength(1);
    const jobs=responses.filter(response=>response.statusCode===200).map(response=>response.json<JobStatus>());
    for(const job of jobs){const cancelled=await api('POST',`/api/jobs/${job.id}/cancel`);expect(cancelled.json()).toMatchObject({state:'cancelled'});}
    await sleep(100);
    for(const job of jobs){const status=(await api('GET',`/api/jobs/${job.id}`)).json<JobStatus>();expect(status.state).toBe('cancelled');expect(status.result).toBeUndefined();}
  });
  test('worker time limit is an explicit failure and invalid input never starts work',async()=>{
    await reset({jobTimeoutMs:1});
    const response=await api('POST','/api/jobs/search',{domain:'interval',strategy:defaultStrategy('interval'),seed:42,attempts:100,size:6});
    const job=await completed(response.json<JobStatus>().id);expect(job.state).toBe('failed');expect(job.error).toContain('时限');expect(job.result).toBeUndefined();
    expect((await api('POST','/api/jobs/search',{domain:'graph',strategy:defaultStrategy('graph'),seed:1,attempts:2001,size:13})).statusCode).toBe(400);
    const pass=evaluate(demoInstance('interval'),presets('interval').find(p=>p.algorithm==='optimal')!);
    expect((await api('POST','/api/jobs/shrink',{evaluation:{...pass,verdict:'counterexample'}})).statusCode).toBe(400);
  });
  test('restart marks persisted interrupted jobs failed rather than resuming or claiming success',()=>{
    const filename=resolve(dataDir,'restart.sqlite');let store=new Store(filename);
    store.saveJob({id:'interrupted',kind:'search',state:'running',progress:{checked:4,total:100,found:0}});store.close();
    store=new Store(filename);const job=store.getJob('interrupted');expect(job?.state).toBe('failed');expect(job?.error).toContain('重启');expect(job?.result).toBeUndefined();store.close();
  });
  test('regression includes verified saved revision counterexamples, deduplicates and can opt out',async()=>{
    const created=await saved(),changed=input();if(changed.instance.domain==='interval')changed.instance.items[0].value=12;
    await api('PUT',`/api/experiments/${created.id}`,changed);
    const pair={instance:changed.instance,before:changed.strategy,after:presets('interval').find(p=>p.algorithm==='optimal')!,seed:7,count:0};
    const first=await api('POST','/api/jobs/regression',pair),job=await completed(first.json<JobStatus>().id);
    expect(job.state).toBe('completed');expect(job.result).toMatchObject({improved:1,unchanged:1});
    expect((job.result as {rows:{label:string}[]}).rows).toHaveLength(2);
    expect((job.result as {rows:{label:string}[]}).rows[1].label).toContain('历史实例');
    const optOut=await api('POST','/api/jobs/regression',{...pair,includeHistory:false});
    const excluded=await completed(optOut.json<JobStatus>().id);expect((excluded.result as {rows:unknown[]}).rows).toHaveLength(1);
  },20000);
  test('stored history is deduplicated and capped at twenty distinct verified inputs',()=>{
    const store=new Store(resolve(dataDir,'history.sqlite'));let id:string|undefined;
    for(let index=0;index<25;index++){
      const data=input();if(data.instance.domain==='interval')data.instance.items[0].label=`版本 ${index}`;
      id=store.save(data,id).id;
    }
    expect(store.history('interval')).toHaveLength(20);expect(store.history('graph')).toHaveLength(0);store.close();
  });
});

describe('AI provider uses validated bounded responses, not invented results',()=>{
  const key='unit-test-placeholder-only';
  const env={COUNTERLAB_AI_KEY:key,COUNTERLAB_AI_BASE_URL:'https://api.example.test/v1',COUNTERLAB_AI_MODEL:'test-model',COUNTERLAB_AI_PROVIDER:'Test provider'};
  const proposal=()=>({strategy:defaultStrategy('interval'),explanation:'保留当前策略，由实验检验。',assumptions:['非负收益']});
  const response=(content:unknown)=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(content)}}],usage:{prompt_tokens:12,completion_tokens:9}}),{headers:{'content-type':'application/json'}});
  const request=()=>({domain:'interval',instruction:'请建议一个可验证的策略',currentStrategy:defaultStrategy('interval')});
  test('missing configuration returns 503 without fabricated proposals',async()=>{
    expect((await api('GET','/api/ai/status')).json()).toMatchObject({configured:false,calls:0});
    const result=await api('POST','/api/ai/propose',request());expect(result.statusCode).toBe(503);expect(result.body).not.toContain('live-model');
  });
  test('sends only configured model and validated input, records usage and never exposes key',async()=>{
    const fetcher=vi.fn(async()=>response({...proposal(),explanation:`服务不应回显 ${key}`}));
    await reset({env,fetcher:fetcher as typeof fetch});const result=await api('POST','/api/ai/propose',request());
    expect(result.statusCode).toBe(200);expect(result.json()).toMatchObject({source:'live-model',explanation:'服务不应回显 [redacted]'});
    const call=fetcher.mock.calls[0] as unknown as [string,RequestInit];expect(call[0]).toBe('https://api.example.test/v1/chat/completions');
    expect(JSON.parse(String(call[1].body))).toMatchObject({model:'test-model',response_format:{type:'json_object'}});
    expect(JSON.parse(String(call[1].body)).thinking).toBeUndefined();
    const status=await api('GET','/api/ai/status');expect(status.body).not.toContain(key);expect(status.json()).toMatchObject({calls:1,inputTokens:12,outputTokens:9});
    expect((await api('GET','/api/experiments')).json()).toHaveLength(0);
  });
  test('only official DeepSeek host receives its explicit non-thinking option',async()=>{
    let body:Record<string,unknown>={};
    const fetcher=vi.fn(async(_url:unknown,init?:RequestInit)=>{body=JSON.parse(String(init?.body));return response(proposal())});
    await reset({env:{...env,COUNTERLAB_AI_BASE_URL:'https://api.deepseek.com/v1',COUNTERLAB_AI_MODEL:'deepseek-flash'},fetcher:fetcher as typeof fetch});
    expect((await api('POST','/api/ai/propose',request())).statusCode).toBe(200);
    expect(body).toMatchObject({model:'deepseek-flash',thinking:{type:'disabled'},max_tokens:1800});
  });
  test('rejects malicious model strategy and malformed current strategy without state changes',async()=>{
    const fetcher=vi.fn(async()=>response({...proposal(),strategy:{...defaultStrategy('interval'),score:'eval(1)'}}));
    await reset({env,fetcher:fetcher as typeof fetch});
    expect((await api('POST','/api/ai/propose',request())).statusCode).toBe(502);
    expect((await api('POST','/api/ai/propose',{...request(),currentStrategy:{...defaultStrategy('interval'),score:'x => x'}})).statusCode).toBe(400);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await api('GET','/api/experiments')).json()).toHaveLength(0);
  });
  test('AI explanations receive server-recomputed facts instead of forged verdicts',async()=>{
    let received:Record<string,unknown>={};
    const fetcher=vi.fn(async(_url:unknown,init?:RequestInit)=>{
      received=JSON.parse(JSON.parse(String(init?.body)).messages[1].content);return response({text:'这是一个收益优先策略的反例。'});
    });
    await reset({env,fetcher:fetcher as typeof fetch});const actual=evaluate(demoInstance('interval'),defaultStrategy('interval'));
    const result=await api('POST','/api/ai/explain',{evaluation:{...actual,verdict:'pass',difference:0,candidate:{value:555}}});
    expect(result.statusCode).toBe(200);expect(received).toMatchObject({verdict:'counterexample',difference:3,candidate:{value:9},reference:{value:12}});
  });
  test('upstream authentication, invalid JSON and oversized streams return generic nonsecret failures',async()=>{
    for(const makeResponse of [()=>new Response(key,{status:401}),()=>new Response('not-json'),()=>new Response('x'.repeat(100001))]){
      await reset({env,fetcher:vi.fn(async()=>makeResponse()) as typeof fetch});
      const result=await api('POST','/api/ai/propose',request());expect(result.statusCode).toBe(502);expect(result.body).not.toContain(key);
    }
  });
  test('concurrent requests cannot spend overlapping AI calls',async()=>{
    let release:((response:Response)=>void)|undefined;
    const fetcher=vi.fn(()=>new Promise<Response>(resolve=>{release=resolve}));
    await reset({env,fetcher:fetcher as typeof fetch});
    const pending=api('POST','/api/ai/propose',request()).then(value=>value);
    for(let count=0;!release&&count<100;count++)await sleep(5);
    expect(release).toBeDefined();expect((await api('POST','/api/ai/propose',request())).statusCode).toBe(429);
    release!(response(proposal()));expect((await pending).statusCode).toBe(200);expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
