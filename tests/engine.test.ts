import { describe, expect, it } from 'vitest';
import type { Domain, Evaluation, GraphInstance, Instance, IntervalInstance, KnapsackInstance, SearchProgress, Strategy } from '../src/shared/types.js';
import { defaultStrategy, demoInstance, evaluate, presets, regress, search, shrink, validateInstance, validateStrategy } from '../src/engine/index.js';
import { compileScore, compareRational } from '../src/engine/score.js';
import { generateInstance, seededRandom } from '../src/engine/generation.js';
import { structuralSize } from '../src/engine/shrink.js';
import { independentOptimum, verifyExecution } from '../src/engine/verification.js';

const domains:Domain[]=['interval','knapsack','graph'];
const optimal=(domain:Domain)=>presets(domain).at(-1)!;
const withoutClock=<T extends {elapsedMs:number}>(value:T)=>({...value,elapsedMs:0});
function graph(edges:GraphInstance['edges'],source='S',target='T',directed=true):GraphInstance {
  return {domain:'graph',source,target,directed,edges,nodes:['S','A','B','T'].map((id,index)=>({id,label:id,x:index*40,y:0}))};
}
const deadEnd=()=>graph([{id:'SA',from:'S',to:'A',weight:1},{id:'SB',from:'S',to:'B',weight:2},{id:'BT',from:'B',to:'T',weight:2}]);
function measure(instance:Instance):number {
  if(instance.domain==='graph')return instance.edges.reduce((sum,x)=>sum+x.weight,0);
  if(instance.domain==='knapsack')return instance.capacity+instance.items.reduce((sum,x)=>sum+x.weight+x.value,0);
  return instance.items.reduce((sum,x)=>sum+x.start+x.end+x.value,0);
}

describe('exact execution and independently verified witnesses',()=>{
  it.each(domains)('%s demonstrates a real counterexample, then passes with its exact algorithm',domain=>{
    const input=demoInstance(domain),copy=structuredClone(input);
    const result=evaluate(input,defaultStrategy(domain));
    expect(result.verdict).toBe('counterexample');expect(result.witnessVerified).toBe(true);
    expect(result.difference).toBeGreaterThan(0);
    expect(evaluate(input,optimal(domain)).verdict).toBe('pass');expect(input).toEqual(copy);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
  it('treats touching intervals as compatible and distinguishes count from value',()=>{
    const input=demoInstance('interval') as IntervalInstance;
    expect(evaluate(input,defaultStrategy('interval')).reference.solutionIds).toEqual(['B','C']);
    input.objective='count';
    const endFirst=presets('interval')[1];
    expect(evaluate(input,endFirst).candidate.value).toBe(2);
    const random=seededRandom(981);
    for(let index=0;index<150;index++)expect(evaluate(generateInstance('interval',8,10,random,'count'),endFirst).verdict).toBe('pass');
  });
  it('enforces 0-1 use and zero-capacity semantics even when values are zero',()=>{
    const instance:KnapsackInstance={domain:'knapsack',capacity:10,items:[{id:'only',label:'唯一物品',weight:3,value:5}]};
    const evaluation=evaluate(instance,optimal('knapsack'));
    expect(evaluation.candidate.value).toBe(5);expect(evaluation.candidate.solutionIds).toEqual(['only']);
    instance.capacity=0;expect(evaluate(instance,defaultStrategy('knapsack')).reference.value).toBe(0);
    instance.items[0].value=0;expect(evaluate(instance,defaultStrategy('knapsack')).verdict).toBe('pass');
  });
  it('handles the maximum legal value sum without overflow',()=>{
    const instance:KnapsackInstance={domain:'knapsack',capacity:18,items:Array.from({length:18},(_,i)=>({id:`K${i}`,label:`K${i}`,weight:1,value:100000}))};
    expect(evaluate(instance,optimal('knapsack')).reference.value).toBe(1800000);
  });
  it('distinguishes a local dead-end from globally unreachable target',()=>{
    const failure=evaluate(deadEnd(),defaultStrategy('graph'));
    expect(failure.verdict).toBe('counterexample');expect(failure.candidate.complete).toBe(false);
    expect(failure.reference.complete).toBe(true);expect(failure.difference).toBe(0);
    expect(failure.candidate.pathNodeIds).toEqual(['S','A']);expect(failure.candidate.value).toBe(1);
    const unreachable=evaluate(graph([{id:'SA',from:'S',to:'A',weight:4}]),defaultStrategy('graph'));
    expect(unreachable.verdict).toBe('pass');expect(unreachable.reference.complete).toBe(false);
    expect(unreachable.details.join('')).toContain('目标不可达');expect(unreachable.reference.value).toBe(0);
    expect(JSON.stringify(unreachable)).not.toMatch(/Infinity|NaN/);
  });
  it('handles source equals target, zero-weight cycles, and undirected reverse arcs',()=>{
    const edges=[{id:'SA',from:'S',to:'A',weight:0},{id:'AS',from:'A',to:'S',weight:0},{id:'AT',from:'A',to:'T',weight:0}];
    const zero=evaluate(graph(edges),optimal('graph'));
    expect(zero.verdict).toBe('pass');expect(zero.candidate.value).toBe(0);
    expect(zero.candidate.pathNodeIds).toEqual(['S','A','T']);
    const same=evaluate(graph([], 'S','S'),defaultStrategy('graph'));
    expect(same.verdict).toBe('pass');expect(same.candidate.complete).toBe(true);expect(same.candidate.solutionIds).toEqual([]);
    const reverse=evaluate(graph([{id:'TS',from:'T',to:'S',weight:7}],'S','T',false),optimal('graph'));
    expect(reverse.candidate.pathNodeIds).toEqual(['S','T']);expect(reverse.candidate.value).toBe(7);
  });
  it('cross-checks independent optima across 240 generated instances',()=>{
    const random=seededRandom(60201);
    for(const domain of domains)for(let index=0;index<80;index++) {
      const instance=generateInstance(domain,7,15,random,index%2?'count':'value');
      const evaluation=evaluate(instance,defaultStrategy(domain));
      expect(evaluation.witnessVerified).toBe(true);
      expect(verifyExecution(instance,evaluation.candidate)).toBe(true);
      const value=independentOptimum(instance);
      expect(evaluation.reference.complete).toBe(value!==null);
      if(value!==null)expect(evaluation.reference.value).toBe(value);
    }
  });
  it.each(domains)('%s trace snapshots retain their actual intermediate state',domain=>{
    const evaluation=evaluate(demoInstance(domain),defaultStrategy(domain));
    for(const execution of [evaluation.candidate,evaluation.reference]) {
      expect(execution.steps.at(-1)!.selectedIds).toEqual(execution.solutionIds);
      expect(execution.steps.at(-1)!.currentValue).toBe(execution.value);
      expect(execution.steps.map(step=>step.index)).toEqual(execution.steps.map((_,index)=>index));
      for(let index=1;index<execution.steps.length;index++)expect(execution.steps[index].selectedIds).not.toBe(execution.steps[index-1].selectedIds);
      for(const step of execution.steps) {
        if(evaluation.instance.domain==='graph') {
          const value=step.selectedIds.reduce((sum,id)=>sum+(evaluation.instance as GraphInstance).edges.find(edge=>edge.id===id)!.weight,0);
          expect(step.currentValue).toBe(value);
        } else {
          expect(verifyExecution(evaluation.instance,{solutionIds:step.selectedIds,value:step.currentValue,feasible:true,complete:true,steps:[]})).toBe(true);
        }
      }
    }
  });
  it('rejects forged objective values, duplicate use, and infeasible flags',()=>{
    const instance=demoInstance('knapsack'),execution=evaluate(instance,defaultStrategy('knapsack')).candidate;
    expect(verifyExecution(instance,{...execution,value:execution.value+1})).toBe(false);
    expect(verifyExecution(instance,{...execution,solutionIds:['A','A']})).toBe(false);
    expect(verifyExecution(instance,{...execution,feasible:false})).toBe(false);
  });
});

describe('safe arithmetic and deterministic tie rules',()=>{
  it('uses exact rational decimal arithmetic and standard operator precedence',()=>{
    const exact=compileScore('0.1 + 0.2 - 0.3','knapsack')({});
    expect(exact.numerator).toBe(0n);expect(exact.denominator).toBe(1n);
    expect(compileScore('-(value + 2) / weight + 3 * 2','knapsack')({value:4,weight:3})).toEqual({numerator:4n,denominator:1n});
    expect(compareRational(compileScore('1/3','graph')({}),compileScore('2/6','graph')({}))).toBe(0);
  });
  it.each(['globalThis.process','value.constructor','value; process.exit()','Math.random()','value ** 2','value ? 1 : 0','weight[0]','1e3','1.1234567','9999999999'])('rejects executable or unsupported syntax: %s',source=>{
    expect(()=>compileScore(source,'knapsack')).toThrow();
  });
  it('bounds parser depth and rejects missing fields and division by zero',()=>{
    expect(()=>compileScore('('.repeat(18)+'1'+')'.repeat(18),'graph')).toThrow(/嵌套/);
    expect(()=>compileScore('duration','knapsack')).toThrow(/不支持/);
    expect(()=>compileScore('value / (weight - weight)','knapsack')({value:2,weight:3})).toThrow(/除数为 0/);
    expect(()=>compileScore('weight','graph')({weight:NaN})).toThrow(/安全整数/);
  });
  it('resolves exact density ties by stable ID or configured value order',()=>{
    const instance:KnapsackInstance={domain:'knapsack',capacity:6,items:[{id:'B',label:'B',weight:6,value:18},{id:'A',label:'A',weight:2,value:6}]};
    const strategy=defaultStrategy('knapsack');
    expect(evaluate(instance,strategy).candidate.solutionIds).toEqual(['A']);
    expect(evaluate(instance,{...strategy,tieBreak:'value'}).candidate.solutionIds).toEqual(['B']);
    instance.items.reverse();expect(evaluate(instance,strategy).candidate.solutionIds).toEqual(['A']);
  });
  it('enforces input bounds and disallows duplicate undirected endpoints',()=>{
    expect(()=>validateInstance({...demoInstance('interval'),items:[]})).toThrow();
    expect(()=>validateInstance(graph([{id:'x',from:'S',to:'T',weight:1},{id:'y',from:'T',to:'S',weight:2}],'S','T',false))).toThrow(/重复连接/);
    expect(()=>validateInstance(graph([{id:'x',from:'S',to:'T',weight:-1}]))).toThrow();
    expect(()=>validateStrategy({...defaultStrategy('interval'),algorithm:'dijkstra'})).toThrow();
    expect(()=>evaluate(demoInstance('interval'),defaultStrategy('graph'))).toThrow(/同一领域/);
  });
});

describe('bounded seeded search',()=>{
  it.each(domains)('replays %s input, witness and samples for the same seed',domain=>{
    const options={domain,strategy:defaultStrategy(domain),seed:20261115,attempts:150,size:7};
    const progress:SearchProgress[]=[];
    const first=search(options,event=>progress.push(event)),second=search(options);
    expect(withoutClock(first)).toEqual(withoutClock(second));expect(first.status).toBe('counterexample');
    expect(first.evaluation!.verdict).toBe('counterexample');expect(first.evaluation!.witnessVerified).toBe(true);
    expect(first.checked).toBe(first.samples!.length);expect(progress.at(-1)!.checked).toBe(first.checked);
    expect(progress.at(-1)!.found).toBe(1);
  });
  it('states that random sampling is not proof, even for an exact strategy',()=>{
    const result=search({domain:'interval',strategy:optimal('interval'),seed:0,attempts:30,size:5});
    expect(result.status).toBe('not_found');expect(result.checked).toBe(30);expect(result.reason).toContain('不是穷尽检验或正确性证明');
  });
  it('reports partial cancellation without inventing unchecked results',()=>{
    let checked=0;
    const result=search({domain:'graph',strategy:optimal('graph'),seed:1,attempts:100,size:5},event=>{checked=event.checked;},()=>checked===4);
    expect(result.status).toBe('incomplete');expect(result.checked).toBe(4);expect(result.samples).toHaveLength(4);
  });
  it('rejects invalid options and undefined scores instead of reporting no counterexample',()=>{
    const options={domain:'knapsack' as const,strategy:defaultStrategy('knapsack'),seed:0,attempts:10,size:5};
    expect(()=>search({...options,attempts:2001})).toThrow();
    expect(()=>search({...options,size:19})).toThrow();
    expect(()=>search({...options,maxValue:101})).toThrow();
    expect(()=>search({...options,strategy:{...options.strategy,score:'1 / (weight-weight)'}})).toThrow(/除数为 0/);
  });
});

describe('truthful shrinking and regression',()=>{
  it.each(domains)('shrinks %s with a valid failure-preserving, monotone chain',domain=>{
    const original=evaluate(demoInstance(domain),defaultStrategy(domain)),result=shrink(original);
    expect(result.original).toEqual(original);expect(result.final.verdict).toBe('counterexample');
    expect(result.minimality).toBe('local');expect(result.steps.length).toBeGreaterThan(0);
    expect(result.checks).toBeGreaterThanOrEqual(result.steps.length);
    let previous=original;
    for(const step of result.steps) {
      validateInstance(step.instance);expect(evaluate(step.instance,original.strategy)).toEqual(step.evaluation);
      expect(step.beforeSize).toBe(structuralSize(previous.instance));expect(step.afterSize).toBe(structuralSize(step.instance));
      expect(step.afterSize<step.beforeSize||(step.afterSize===step.beforeSize&&measure(step.instance)<measure(previous.instance))).toBe(true);
      expect(step.evaluation.verdict).toBe('counterexample');expect(step.evaluation.witnessVerified).toBe(true);
      expect(step.evaluation.candidate.complete).toBe(original.candidate.complete);previous=step.evaluation;
    }
    expect(result.final).toEqual(previous);
    expect(withoutClock(shrink(original))).toEqual(withoutClock(result));
  });
  it('preserves reachable dead-end failure rather than shrinking into unreachable or slower complete routes',()=>{
    const result=shrink(evaluate(deadEnd(),defaultStrategy('graph')));
    expect(result.final.reference.complete).toBe(true);expect(result.final.candidate.complete).toBe(false);
    for(const step of result.steps)expect(step.evaluation.reference.complete&&!step.evaluation.candidate.complete).toBe(true);
    const instance=result.final.instance as GraphInstance;
    for(const edge of instance.edges)expect(evaluate({...instance,edges:instance.edges.filter(item=>item.id!==edge.id)},result.final.strategy).verdict).not.toBe('counterexample');
  });
  it('recomputes untrusted evaluation and marks early cancellation as only reduced',()=>{
    const original=evaluate(demoInstance('interval'),defaultStrategy('interval'));
    const forged={...original,candidate:{...original.candidate,value:9999},difference:9999};
    const result=shrink(forged,undefined,()=>true);
    expect(result.original).toEqual(original);expect(result.final).toEqual(original);
    expect(result.checks).toBe(0);expect(result.minimality).toBe('reduced');
    expect(()=>shrink(evaluate(demoInstance('interval'),optimal('interval')))).toThrow(/只能缩减/);
  });
  it('excludes reductions that make an originally valid score undefined',()=>{
    const original=evaluate(demoInstance('knapsack'),{...defaultStrategy('knapsack'),score:'weight / value',direction:'asc'});
    expect(original.verdict).toBe('counterexample');
    const result=shrink(original);
    expect(result.final.verdict).toBe('counterexample');
    expect((result.final.instance as KnapsackInstance).items.every(item=>item.value>0)).toBe(true);
    for(const step of result.steps)expect(()=>evaluate(step.instance,original.strategy)).not.toThrow();
  });
  it.each(domains)('regression compares %s original plus independently generated holdouts',domain=>{
    const instance=demoInstance(domain),before=defaultStrategy(domain),after=optimal(domain);
    const result=regress(instance,before,after,41,25);
    expect(result.rows).toHaveLength(26);expect(result.rows[0].instance).toEqual(instance);
    expect(result.rows[0].change).toBe('improved');expect(result.improved).toBeGreaterThan(0);expect(result.regressed).toBe(0);
    expect(result.improved+result.regressed+result.unchanged).toBe(26);
    expect(regress(instance,before,after,41,25)).toEqual(result);
    const reversal=regress(instance,after,before,41,25);
    expect(reversal.regressed).toBe(result.improved);expect(reversal.improved).toBe(0);
  });
  it('classifies dead-end correction, unchanged strategies, and zero holdout counts',()=>{
    const before=defaultStrategy('graph'),after=optimal('graph');
    expect(regress(deadEnd(),before,after,1,0).rows[0].change).toBe('improved');
    expect(regress(deadEnd(),before,before,1,0).unchanged).toBe(1);
    expect(regress(graph([]),before,after,1,0).unchanged).toBe(1);
    expect(()=>regress(deadEnd(),before,after,1,101)).toThrow();
    expect(()=>regress(deadEnd(),before,after,1,10,undefined,()=>true)).toThrow(/已取消/);
  });
  it('rechecks saved history and exposes a regression absent from the current instance',()=>{
    const original:IntervalInstance={domain:'interval',objective:'value',items:[{id:'X',label:'独立任务',start:0,end:1,value:2}]};
    const stored=demoInstance('interval'),before=optimal('interval'),after=defaultStrategy('interval');
    const progress:SearchProgress[]=[];
    const result=regress(original,before,after,93,0,event=>progress.push(event),undefined,[stored]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].change).toBe('unchanged');expect(result.rows[1].label).toBe('历史实例 1');
    expect(result.rows[1].change).toBe('regressed');expect(result.regressed).toBe(1);
    expect(progress.at(-1)).toEqual({checked:2,total:2,found:1});
  });
  it('deduplicates original/history snapshots without disturbing seeded holdouts',()=>{
    const original=demoInstance('interval'),before=defaultStrategy('interval'),after=optimal('interval');
    const stored:IntervalInstance={domain:'interval',objective:'count',items:[{id:'Z',label:'Z',start:1,end:2,value:3}]};
    const reordered={items:stored.items,objective:stored.objective,domain:stored.domain};
    const baseline=regress(original,before,after,9,3);
    const result=regress(original,before,after,9,3,undefined,undefined,[original,stored,reordered]);
    expect(result.rows).toHaveLength(5);expect(result.rows[1].label).toBe('历史实例 1');
    expect(result.rows.slice(2)).toEqual(baseline.rows.slice(1));
    expect(()=>regress(original,before,after,9,0,undefined,undefined,[demoInstance('graph')])).toThrow(/同一领域/);
    expect(()=>regress(original,before,after,9,0,undefined,undefined,Array(21).fill(stored))).toThrow(/20/);
  });
});
