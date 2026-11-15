import { z } from 'zod';
import { evaluate, validateInstance, validateStrategy } from '../src/engine/index.ts';
import type { Evaluation, Experiment, Instance, Strategy } from '../src/shared/types.ts';

const text = z.string().min(1).max(120);
const id = z.string().min(1).max(64).regex(/^[\p{L}\p{N}_.:-]+$/u);
const integer = z.number().int().min(0).max(10000);
const valueInteger = z.number().int().min(0).max(100000);
export const domainSchema = z.enum(['interval','knapsack','graph']);
export const strategySchema = z.object({ id, name: text, domain: domainSchema,
  algorithm: z.enum(['greedy','optimal','dijkstra','local']), score: z.string().max(160),
  direction: z.enum(['asc','desc']), tieBreak: z.enum(['id','value','weight','start','end']) }).strict();
export const instanceSchema = z.discriminatedUnion('domain', [
  z.object({domain:z.literal('interval'), objective:z.enum(['value','count']), items:z.array(z.object({id,label:text,start:integer,end:integer,value:valueInteger}).strict()).min(1).max(16)}).strict(),
  z.object({domain:z.literal('knapsack'),capacity:integer,items:z.array(z.object({id,label:text,weight:integer.min(1),value:valueInteger}).strict()).min(1).max(18)}).strict(),
  z.object({domain:z.literal('graph'),nodes:z.array(z.object({id,label:text,x:z.number().finite().min(-10000).max(10000),y:z.number().finite().min(-10000).max(10000)}).strict()).min(2).max(12),edges:z.array(z.object({id,from:id,to:id,weight:integer}).strict()).max(80),source:id,target:id,directed:z.boolean()}).strict()
]);
export const evaluateSchema = z.object({instance:instanceSchema,strategy:strategySchema}).strict();
// Client-supplied execution/verdict fields are never trusted or persisted: re-evaluate their inputs.
export const evaluationSchema = z.object({instance:instanceSchema,strategy:strategySchema,candidate:z.unknown(),reference:z.unknown(),verdict:z.enum(['counterexample','pass','invalid','incomplete']),difference:z.number().finite(),witnessVerified:z.boolean(),details:z.array(z.string().max(1000)).max(30)}).strict();
export const searchSchema = z.object({domain:domainSchema,strategy:strategySchema,seed:z.number().int().min(-2147483648).max(4294967295),attempts:z.number().int().min(1).max(2000),size:z.number().int().min(2).max(18),maxValue:z.number().int().min(2).max(100),objective:z.enum(['value','count']).optional()}).strict();
// maxValue is optional in the public API.
export const searchOptionsSchema = searchSchema.extend({maxValue:searchSchema.shape.maxValue.optional()});
export const regressionSchema = z.object({instance:instanceSchema,before:strategySchema,after:strategySchema,seed:z.number().int().min(-2147483648).max(4294967295),count:z.number().int().min(0).max(100),includeHistory:z.boolean().optional()}).strict();
const searchResultSchema = z.object({status:z.enum(['counterexample','not_found','incomplete']),checked:z.number().int().min(0).max(2000),total:z.number().int().min(0).max(2000),seed:z.number().int().min(-2147483648).max(4294967295),elapsedMs:z.number().finite().min(0),evaluation:evaluationSchema.optional(),reason:z.string().max(2000).optional(),samples:z.array(z.object({index:z.number().int().min(0),gap:z.number().finite()}).strict()).max(2000).optional()}).strict();
const shrinkResultSchema = z.object({original:evaluationSchema,final:evaluationSchema,steps:z.array(z.object({description:z.string().max(500),beforeSize:z.number().int().min(0),afterSize:z.number().int().min(0),instance:instanceSchema,evaluation:evaluationSchema}).strict()).max(4000),checks:z.number().int().min(0).max(4000),minimality:z.enum(['reduced','local']),elapsedMs:z.number().finite().min(0)}).strict();
const regressionResultSchema = z.object({rows:z.array(z.object({label:z.string().max(150),instance:instanceSchema,before:evaluationSchema,after:evaluationSchema,change:z.enum(['improved','regressed','unchanged'])}).strict()).min(1).max(121),improved:z.number().int().min(0),regressed:z.number().int().min(0),unchanged:z.number().int().min(0),seed:z.number().int().min(-2147483648).max(4294967295)}).strict();
export const saveSchema = z.object({title:text,instance:instanceSchema,strategy:strategySchema,evaluation:evaluationSchema.optional(),search:searchResultSchema.optional(),shrink:shrinkResultSchema.optional(),regression:regressionResultSchema.optional()}).strict();
export const experimentSchema = saveSchema.extend({id,domain:domainSchema,createdAt:z.string().datetime(),updatedAt:z.string().datetime(),versions:z.array(z.object({id,at:z.string().datetime(),strategy:strategySchema,instance:instanceSchema.optional(),evaluation:evaluationSchema.optional(),note:z.string().max(500)}).strict()).min(1).max(200)}).strict();
export const packageSchema = z.object({format:z.literal('counterlab-experiment'),version:z.literal(1),engineVersion:z.string().min(1).max(100),exportedAt:z.string().datetime(),experiment:experimentSchema,checksum:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export const aiProposeSchema = z.object({domain:domainSchema,instruction:z.string().trim().min(1).max(4000),currentStrategy:strategySchema}).strict();
export const aiProposalSchema = z.object({strategy:strategySchema,explanation:z.string().min(1).max(4000),assumptions:z.array(z.string().max(500)).max(12)}).strict();

export function checkPair(instance: Instance, strategy: Strategy) {
  validateInstance(instance); validateStrategy(strategy);
  if(instance.domain!==strategy.domain) throw new Error('实例与策略的领域不一致');
}
export function trustedEvaluation(value: unknown): Evaluation {
  const data=evaluationSchema.parse(value); checkPair(data.instance,data.strategy);
  return evaluate(data.instance,data.strategy);
}
function same(a:unknown,b:unknown){return JSON.stringify(a)===JSON.stringify(b)}
function instanceSize(instance:Instance){return instance.domain==='graph'?instance.nodes.length+instance.edges.length:instance.items.length}
function semanticSum(instance:Instance){return instance.domain==='graph'?instance.edges.reduce((sum,item)=>sum+item.weight,0):instance.domain==='knapsack'?instance.capacity+instance.items.reduce((sum,item)=>sum+item.weight+item.value,0):instance.items.reduce((sum,item)=>sum+item.start+item.end+item.value,0)}
function isReduction(before:Instance,after:Instance):boolean{
  if(before.domain!==after.domain||same(before,after))return false;
  if(instanceSize(after)>=instanceSize(before)&&semanticSum(after)>=semanticSum(before))return false;
  if(before.domain==='graph'&&after.domain==='graph'){
    return before.source===after.source&&before.target===after.target&&before.directed===after.directed&&
      after.nodes.every(node=>before.nodes.some(old=>same(old,node)))&&
      after.edges.every(edge=>before.edges.some(old=>old.id===edge.id&&old.from===edge.from&&old.to===edge.to&&edge.weight<=old.weight));
  }
  if(before.domain==='interval'&&after.domain==='interval')return before.objective===after.objective&&after.items.every(item=>before.items.some(old=>old.id===item.id&&old.label===item.label&&item.start<=old.start&&item.end<=old.end&&item.value<=old.value));
  if(before.domain==='knapsack'&&after.domain==='knapsack')return after.capacity<=before.capacity&&after.items.every(item=>before.items.some(old=>old.id===item.id&&old.label===item.label&&item.weight<=old.weight&&item.value<=old.value));
  return false;
}
function deficit(evaluation:Evaluation){
  if(evaluation.verdict==='invalid'||evaluation.verdict==='incomplete'||!evaluation.witnessVerified)throw new Error('回归记录必须是已独立复核的完整计算');
  return evaluation.instance.domain==='graph'&&evaluation.reference.complete&&!evaluation.candidate.complete?Infinity:evaluation.difference;
}
function failureKind(evaluation:Evaluation){return evaluation.candidate.complete?'suboptimal':'dead-end'}
export function trustedSave(input:unknown): ReturnType<typeof saveSchema.parse> {
  const data=saveSchema.parse(input); checkPair(data.instance,data.strategy);
  data.evaluation=evaluate(data.instance,data.strategy);
  if(data.search){
    if(data.search.checked>data.search.total) throw new Error('搜索计数无效');
    if(data.search.status==='not_found'&&data.search.checked!==data.search.total)throw new Error('未发现反例状态必须完成本轮所有样本');
    if(data.search.status==='counterexample'&&data.search.checked<1)throw new Error('反例搜索必须至少检查一个样本');
    if(data.search.evaluation){data.search.evaluation=trustedEvaluation(data.search.evaluation);if(data.search.evaluation.instance.domain!==data.instance.domain)throw new Error('搜索记录的领域不一致');}
    if(data.search.status==='counterexample' && data.search.evaluation?.verdict!=='counterexample') throw new Error('搜索记录没有有效反例');
    if(data.search.status!=='counterexample'&&data.search.evaluation?.verdict==='counterexample')throw new Error('搜索状态与反例证据矛盾');
    const note='搜索统计为保存时记录；其中的实例与结论已重新计算，采样覆盖未重新执行。';
    if(!data.search.reason?.includes(note))data.search.reason=[data.search.reason?.slice(0,1800),note].filter(Boolean).join(' ');
  }
  if(data.shrink){
    const shrink=data.shrink,original=trustedEvaluation(shrink.original),final=trustedEvaluation(shrink.final);shrink.original=original;shrink.final=final;
    if(shrink.original.verdict!=='counterexample'||shrink.final.verdict!=='counterexample') throw new Error('缩减记录必须保持反例性质');
    if(shrink.original.instance.domain!==data.instance.domain)throw new Error('缩减记录的领域不一致');
    const originalStrategy=shrink.original.strategy;
    let previous=original;
    for(const step of shrink.steps){
      const evaluated=trustedEvaluation(step.evaluation);step.evaluation=evaluated;
      if(!same(step.instance,evaluated.instance)||!same(evaluated.strategy,originalStrategy)||evaluated.verdict!=='counterexample'||failureKind(evaluated)!==failureKind(original))throw new Error('缩减步骤不保持原策略与反例性质');
      if(step.beforeSize!==instanceSize(previous.instance)||step.afterSize!==instanceSize(step.instance)||step.afterSize>step.beforeSize)throw new Error('缩减步骤规模与输入不一致');
      if(!isReduction(previous.instance,step.instance))throw new Error('缩减步骤必须删除元素或降低数值，不能替换输入');
      previous=evaluated;
    }
    if(!same(final.strategy,originalStrategy)||failureKind(final)!==failureKind(original))throw new Error('缩减过程不得改变策略或失败类型');
    if(!same(previous.instance,shrink.final.instance)||shrink.checks<shrink.steps.length)throw new Error('缩减记录的最终输入或检查次数不一致');
    // Rechecking witnesses does not establish minimality of the imported search history.
    shrink.minimality='reduced';
  }
  if(data.regression){
    const regression=data.regression; regression.improved=0;regression.regressed=0;regression.unchanged=0;
    for(const row of regression.rows){
      const before=trustedEvaluation(row.before),after=trustedEvaluation(row.after);row.before=before;row.after=after;
      if(!same(row.instance,row.before.instance)||!same(row.instance,row.after.instance))throw new Error('回归记录实例不一致');
      if(row.instance.domain!==data.instance.domain)throw new Error('回归记录的领域不一致');
      if(!same(row.before.strategy,regression.rows[0].before.strategy)||!same(row.after.strategy,regression.rows[0].after.strategy))throw new Error('回归记录不得在不同样例间切换策略');
      const beforeGap=deficit(before),afterGap=deficit(after);
      row.change=afterGap<beforeGap?'improved':afterGap>beforeGap?'regressed':'unchanged';
      regression[row.change]++;
    }
  }
  return data;
}
export function validateExperimentVersions(experiment:Experiment){
  if(experiment.domain!==experiment.instance.domain)throw new Error('实验领域无效');
  for(const version of experiment.versions){
    validateStrategy(version.strategy);if(version.strategy.domain!==experiment.domain)throw new Error('历史策略领域无效');
    if(version.evaluation){const checked=trustedEvaluation(version.evaluation);if(!same(checked.strategy,version.strategy)||(version.instance&&!same(checked.instance,version.instance)))throw new Error('历史版本的输入与计算证据不一致');version.instance=checked.instance;version.evaluation=checked;}
    else if(version.instance){checkPair(version.instance,version.strategy);version.evaluation=evaluate(version.instance,version.strategy);}
  }
  if(!same(experiment.versions.at(-1)?.strategy,experiment.strategy))throw new Error('最后一个策略版本与当前策略不一致');
  if(experiment.versions.at(-1)?.instance&&!same(experiment.versions.at(-1)?.instance,experiment.instance))throw new Error('最后一个版本与当前输入不一致');
  if(new Set(experiment.versions.map(version=>version.id)).size!==experiment.versions.length)throw new Error('历史版本标识不能重复');
}
