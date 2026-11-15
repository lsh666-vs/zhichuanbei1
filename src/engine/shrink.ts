import type { Evaluation, Instance, SearchProgress, ShrinkResult, ShrinkStep } from '../shared/types.js';
import { evaluate } from './evaluate.js';
import { ScoreEvaluationError } from './score.js';
import { validateInstance } from './validation.js';

export const SHRINK_CHECK_LIMIT=4000;
export const structuralSize=(instance:Instance)=>instance.domain==='graph'?instance.nodes.length+instance.edges.length:instance.items.length;

function failureClass(evaluation:Evaluation):'dead-end'|'suboptimal'|null {
  if(evaluation.verdict!=='counterexample'||!evaluation.witnessVerified)return null;
  return evaluation.instance.domain==='graph'&&!evaluation.candidate.complete?'dead-end':'suboptimal';
}

function lowered(value:number,minimum=0):number[] {
  return [...new Set([minimum,Math.max(minimum,Math.floor(value/2)),value-1])].filter(next=>next>=minimum&&next<value);
}

/** Every offered edit monotonically decreases item count or a nonnegative semantic number. */
function* reductions(input:Instance):Generator<{instance:Instance;description:string}> {
  if(input.domain==='graph') {
    for(const edge of input.edges) {
      const instance=structuredClone(input);instance.edges=instance.edges.filter(item=>item.id!==edge.id);
      yield {instance,description:`删除边 ${edge.id}，保留同类失败。`};
    }
    for(const node of input.nodes) {
      if(node.id===input.source||node.id===input.target||input.nodes.length<=2)continue;
      const instance=structuredClone(input);instance.nodes=instance.nodes.filter(item=>item.id!==node.id);
      instance.edges=instance.edges.filter(edge=>edge.from!==node.id&&edge.to!==node.id);
      yield {instance,description:`删除非终端节点 ${node.id} 及其关联边。`};
    }
    for(let index=0;index<input.edges.length;index++)for(const next of lowered(input.edges[index].weight)) {
      const instance=structuredClone(input),edge=instance.edges[index],previous=edge.weight;edge.weight=next;
      yield {instance,description:`边 ${edge.id} 的权重从 ${previous} 降至 ${next}。`};
    }
    return;
  }
  if(input.items.length>1)for(let index=0;index<input.items.length;index++) {
    const instance=structuredClone(input),removed=instance.items.splice(index,1)[0];
    yield {instance,description:`删除项目 ${removed.label}（${removed.id}）。`};
  }
  if(input.domain==='knapsack') {
    for(const next of lowered(input.capacity)) {
      const instance=structuredClone(input);instance.capacity=next;
      yield {instance,description:`容量从 ${input.capacity} 降至 ${next}。`};
    }
    for(let index=0;index<input.items.length;index++)for(const key of ['weight','value'] as const)for(const next of lowered(input.items[index][key],key==='weight'?1:0)) {
      const instance=structuredClone(input),item=instance.items[index],previous=item[key];item[key]=next;
      yield {instance,description:`${item.label} 的${key==='weight'?'重量':'价值'}从 ${previous} 降至 ${next}。`};
    }
    return;
  }
  for(let index=0;index<input.items.length;index++)for(const key of ['start','end','value'] as const)for(const next of lowered(input.items[index][key],key==='end'?input.items[index].start+1:0)) {
    const instance=structuredClone(input),item=instance.items[index],previous=item[key];item[key]=next;
    yield {instance,description:`${item.label} 的${key==='start'?'开始时间':key==='end'?'结束时间':'收益'}从 ${previous} 降至 ${next}。`};
  }
}

export function shrink(input:Evaluation,onProgress?:(progress:SearchProgress)=>void,isCancelled:()=>boolean=()=>false):ShrinkResult {
  if(!input||typeof input!=='object')throw new Error('缩减需要一个反例评估。');
  // Imported/client evaluations are evidence candidates, never trusted execution results.
  const original=evaluate(input.instance,input.strategy),kind=failureClass(original);
  if(!kind)throw new Error('只能缩减重新验证后仍成立的反例。');
  const started=performance.now(),steps:ShrinkStep[]=[];
  let current=original,checks=0,finished=false,interrupted=false;
  onProgress?.({checked:0,total:SHRINK_CHECK_LIMIT,found:0});
  while(!finished&&!interrupted) {
    let accepted=false;
    for(const candidate of reductions(current.instance)) {
      if(checks>=SHRINK_CHECK_LIMIT||isCancelled()) {interrupted=true;break;}
      checks++;
      let next:Evaluation;
      try {
        validateInstance(candidate.instance);
        next=evaluate(candidate.instance,current.strategy);
      } catch(error) {
        if(!(error instanceof ScoreEvaluationError))throw error;
        // E.g. reducing a value to zero may make the user's score denominator zero.
        // Such input lies outside that executable strategy's domain; never accept it.
        onProgress?.({checked:checks,total:SHRINK_CHECK_LIMIT,found:steps.length});
        continue;
      }
      if(next.verdict==='invalid'||!next.witnessVerified)throw new Error('缩减候选未通过独立核验，已停止。');
      if(failureClass(next)===kind) {
        steps.push({description:candidate.description,beforeSize:structuralSize(current.instance),afterSize:structuralSize(next.instance),instance:structuredClone(next.instance),evaluation:next});
        current=next;accepted=true;
      }
      onProgress?.({checked:checks,total:SHRINK_CHECK_LIMIT,found:steps.length});
      if(accepted)break; // Restart from deletion edits after every accepted change.
    }
    if(!interrupted&&!accepted)finished=true;
  }
  if(finished)onProgress?.({checked:checks,total:checks,found:steps.length});
  return {original,final:current,steps,checks,minimality:finished?'local':'reduced',elapsedMs:Math.round(performance.now()-started)};
}
