import type { Execution, GraphInstance, Instance, IntervalInstance, KnapsackInstance, Strategy, TraceStep } from '../shared/types.js';
import { compileScore, compareRational } from './score.js';
import { lexical } from './validation.js';

function emit(steps: TraceStep[], step: Omit<TraceStep,'index'>) {
  steps.push({ ...step, index: steps.length, activeIds: [...step.activeIds], selectedIds: [...step.selectedIds] });
}
function ranked<T extends {id:string}>(items: T[], strategy: Strategy, fields: (item: T) => Record<string,number>): T[] {
  const score = compileScore(strategy.score,strategy.domain);
  const scored = items.map(item => ({ item, fields: fields(item), score: score(fields(item)) }));
  scored.sort((a,b) => {
    const primary = compareRational(a.score,b.score) * (strategy.direction === 'asc' ? 1 : -1);
    if (primary !== 0) return primary;
    const tie = strategy.tieBreak;
    if (tie !== 'id') {
      const delta = (a.fields[tie] ?? 0) - (b.fields[tie] ?? 0);
      if (delta !== 0) return tie === 'value' ? -delta : delta;
    }
    return lexical(a.item.id,b.item.id);
  });
  return scored.map(entry => entry.item);
}
function finished(ids: string[], value: number, steps: TraceStep[], reason: string): Execution {
  emit(steps,{kind:'finish',message:reason,activeIds:[],selectedIds:ids,currentValue:value});
  return { solutionIds: [...ids], value, feasible:true, complete:true, steps };
}

export function intervalGreedy(instance: IntervalInstance, strategy: Strategy): Execution {
  const ordered = ranked(instance.items,strategy,item => ({start:item.start,end:item.end,duration:item.end-item.start,value:item.value}));
  const selected: typeof instance.items = [], steps: TraceStep[] = [];
  let value = 0;
  for (const item of ordered) {
    emit(steps,{kind:'consider',message:`考虑 ${item.label}：[${item.start}, ${item.end})，收益 ${item.value}。`,activeIds:[item.id],selectedIds:selected.map(x=>x.id),currentValue:value});
    const conflicts = selected.filter(other => item.start < other.end && other.start < item.end);
    if (conflicts.length) emit(steps,{kind:'reject',message:`${item.label} 与已选 ${conflicts.map(x=>x.label).join('、')} 重叠，拒绝。`,activeIds:[item.id],selectedIds:selected.map(x=>x.id),rejectedIds:[item.id],currentValue:value,data:{conflictIds:conflicts.map(x=>x.id)}});
    else {
      selected.push(item); value += instance.objective === 'count' ? 1 : item.value;
      emit(steps,{kind:'select',message:`接受 ${item.label}，当前${instance.objective === 'count' ? '任务数' : '收益'} ${value}。`,activeIds:[item.id],selectedIds:selected.map(x=>x.id),currentValue:value});
    }
  }
  return finished(selected.map(x=>x.id),value,steps,'全部项目已按确定的排序与平局规则处理。');
}

export function intervalOptimal(instance: IntervalInstance): Execution {
  const items = [...instance.items].sort((a,b)=>a.end-b.end || a.start-b.start || lexical(a.id,b.id));
  const values = [0], solutions: string[][] = [[]], steps: TraceStep[] = [];
  for (let i=0;i<items.length;i++) {
    const item=items[i]; let predecessor=i-1;
    while (predecessor>=0 && items[predecessor].end>item.start) predecessor--;
    const take=values[predecessor+1]+(instance.objective==='count'?1:item.value), skip=values[i];
    const chosen=take>skip;
    values.push(chosen?take:skip);
    solutions.push(chosen?[...solutions[predecessor+1],item.id]:[...solutions[i]]);
    emit(steps,{kind:chosen?'select':'reject',message:`前 ${i+1} 项：选 ${item.label} 得 ${take}，不选得 ${skip}；保存最优值 ${values[i+1]}。`,activeIds:[item.id],selectedIds:solutions[i+1],currentValue:values[i+1],data:{take,skip,predecessor:predecessor>=0?items[predecessor].id:null,prefix:i+1}});
  }
  return finished(solutions.at(-1)!,values.at(-1)!,steps,'按结束时间排序的精确动态规划已完成；相等时保留前一解。');
}

export function knapsackGreedy(instance: KnapsackInstance, strategy: Strategy): Execution {
  const ordered=ranked(instance.items,strategy,item=>({weight:item.weight,value:item.value}));
  const selected:string[]=[],steps:TraceStep[]=[]; let weight=0,value=0;
  for (const item of ordered) {
    emit(steps,{kind:'consider',message:`考虑 ${item.label}，重量 ${item.weight}、价值 ${item.value}，剩余容量 ${instance.capacity-weight}。`,activeIds:[item.id],selectedIds:selected,currentValue:value,data:{weight,remaining:instance.capacity-weight}});
    if (weight+item.weight<=instance.capacity) {
      weight+=item.weight; value+=item.value; selected.push(item.id);
      emit(steps,{kind:'select',message:`装入 ${item.label}：重量 ${weight}/${instance.capacity}，价值 ${value}。`,activeIds:[item.id],selectedIds:selected,currentValue:value,data:{weight,remaining:instance.capacity-weight}});
    } else emit(steps,{kind:'reject',message:`${item.label} 超过剩余容量，不可拆分，拒绝。`,activeIds:[item.id],selectedIds:selected,rejectedIds:[item.id],currentValue:value,data:{weight,remaining:instance.capacity-weight}});
  }
  return finished(selected,value,steps,'每件物品最多选择一次，已处理全部物品。');
}

export function knapsackOptimal(instance: KnapsackInstance): Execution {
  const items=[...instance.items].sort((a,b)=>lexical(a.id,b.id));
  const capacity=instance.capacity, rows:Int32Array[]=[new Int32Array(capacity+1)], take:Uint8Array[]=[];
  const steps:TraceStep[]=[];
  function solution(prefix:number):string[] {
    const ids:string[]=[]; let remaining=capacity;
    for (let k=prefix-1;k>=0;k--) if(take[k][remaining]) {ids.push(items[k].id);remaining-=items[k].weight;}
    return ids.reverse();
  }
  for(let i=0;i<items.length;i++) {
    const item=items[i],previous=rows[i],row=new Int32Array(previous),chosen=new Uint8Array(capacity+1);
    for(let c=item.weight;c<=capacity;c++) {
      const candidate=previous[c-item.weight]+item.value;
      if(candidate>previous[c]) {row[c]=candidate;chosen[c]=1;}
    }
    rows.push(row);take.push(chosen);
    const ids=solution(i+1);
    emit(steps,{kind:ids.includes(item.id)?'select':'reject',message:`前 ${i+1} 件的容量动态规划完成：容量 ${capacity} 的最优价值 ${row[capacity]}。`,activeIds:[item.id],selectedIds:ids,currentValue:row[capacity],data:{prefix:i+1,capacity,previousValue:previous[capacity],bestValue:row[capacity]}});
  }
  return finished(solution(items.length),rows.at(-1)![capacity],steps,'精确 0-1 动态规划完成；每一行只读取上一行，相等时不新增物品。');
}

interface Arc { id:string; from:string; to:string; weight:number }
export function graphArcs(instance: GraphInstance): Arc[] {
  return instance.edges.flatMap(edge => instance.directed ? [{...edge}] : [{...edge},{...edge,from:edge.to,to:edge.from}]).sort((a,b)=>lexical(a.id,b.id)||lexical(a.to,b.to));
}
export function graphDijkstra(instance: GraphInstance): Execution {
  const arcs=graphArcs(instance),distance=new Map(instance.nodes.map(node=>[node.id,Infinity]));
  const previous=new Map<string,Arc>(),visited=new Set<string>(),steps:TraceStep[]=[];
  distance.set(instance.source,0);
  function path(target:string):{ids:string[];nodes:string[]} {
    const ids:string[]=[],nodes=[target];let current=target;
    while(current!==instance.source) {
      const arc=previous.get(current); if(!arc) return {ids:[],nodes:[instance.source]};
      ids.push(arc.id);current=arc.from;nodes.push(current);
    }
    return {ids:ids.reverse(),nodes:nodes.reverse()};
  }
  function frontier() {return [...distance].filter(([id,d])=>!visited.has(id)&&Number.isFinite(d)).sort((a,b)=>a[1]-b[1]||lexical(a[0],b[0])).map(([id,d])=>({id,distance:d}));}
  while(frontier().length) {
    const next=frontier()[0],node=next.id;visited.add(node);
    const route=path(node);
    emit(steps,{kind:'visit',message:`确定节点 ${node} 的全局最短距离为 ${next.distance}。`,activeIds:[node],selectedIds:route.ids,currentValue:next.distance,frontier:frontier(),data:{pathNodeIds:route.nodes,visitedNodeIds:[...visited]}});
    if(node===instance.target) {
      emit(steps,{kind:'finish',message:`到达终点，最短路径长度 ${next.distance}。`,activeIds:[node],selectedIds:route.ids,currentValue:next.distance,data:{pathNodeIds:route.nodes}});
      return {solutionIds:route.ids,pathNodeIds:route.nodes,value:next.distance,feasible:true,complete:true,steps};
    }
    for(const arc of arcs.filter(edge=>edge.from===node && !visited.has(edge.to))) {
      const proposed=next.distance+arc.weight,old=distance.get(arc.to)!;
      if(proposed<old) {
        distance.set(arc.to,proposed);previous.set(arc.to,arc);
        emit(steps,{kind:'relax',message:`经 ${arc.id} 更新 ${arc.to}：${Number.isFinite(old)?old:'未发现'} → ${proposed}。`,activeIds:[arc.id,arc.to],selectedIds:path(arc.to).ids,currentValue:proposed,frontier:frontier(),data:{from:node,to:arc.to,previousDistance:Number.isFinite(old)?old:null,distance:proposed,pathNodeIds:path(arc.to).nodes}});
      }
    }
  }
  emit(steps,{kind:'finish',message:'可达节点已全部处理，目标不可达。',activeIds:[],selectedIds:[],currentValue:0,frontier:[]});
  return {solutionIds:[],pathNodeIds:[instance.source],value:0,feasible:true,complete:false,reason:'目标不可达：已穷尽所有从起点可达的节点。',steps};
}

export function graphLocal(instance: GraphInstance,strategy:Strategy):Execution {
  const arcs=graphArcs(instance),visited=new Set([instance.source]),ids:string[]=[],nodes=[instance.source],steps:TraceStep[]=[];
  let current=instance.source,value=0;
  while(current!==instance.target) {
    const options=ranked(arcs.filter(arc=>arc.from===current&&!visited.has(arc.to)),strategy,arc=>({weight:arc.weight}));
    emit(steps,{kind:'visit',message:`位于 ${current}；仅比较通向未访问节点的 ${options.length} 条邻边。`,activeIds:[current],selectedIds:ids,currentValue:value,data:{pathNodeIds:[...nodes],options:options.map(x=>({id:x.id,to:x.to,weight:x.weight}))}});
    if(!options.length) {
      emit(steps,{kind:'finish',message:'局部策略陷入死路；这并不说明图中不存在其他路径。',activeIds:[current],selectedIds:ids,currentValue:value,data:{pathNodeIds:[...nodes]}});
      return {solutionIds:ids,pathNodeIds:nodes,value,feasible:true,complete:false,reason:'局部策略陷入死路，尚未到达终点；未回溯且不重复访问节点。',steps};
    }
    const chosen=options[0];ids.push(chosen.id);current=chosen.to;nodes.push(current);visited.add(current);value+=chosen.weight;
    emit(steps,{kind:'select',message:`选择局部边 ${chosen.id}，前往 ${current}，累计长度 ${value}。`,activeIds:[chosen.id,current],selectedIds:ids,currentValue:value,data:{pathNodeIds:[...nodes]}});
  }
  emit(steps,{kind:'finish',message:`局部策略到达终点，路径长度 ${value}。`,activeIds:[current],selectedIds:ids,currentValue:value,data:{pathNodeIds:[...nodes]}});
  return {solutionIds:ids,pathNodeIds:nodes,value,feasible:true,complete:true,steps};
}

export function runReference(instance:Instance):Execution {
  if(instance.domain==='interval') return intervalOptimal(instance);
  if(instance.domain==='knapsack') return knapsackOptimal(instance);
  return graphDijkstra(instance);
}
export function runCandidate(instance:Instance,strategy:Strategy):Execution {
  if(instance.domain==='interval') return strategy.algorithm==='optimal'?intervalOptimal(instance):intervalGreedy(instance,strategy);
  if(instance.domain==='knapsack') return strategy.algorithm==='optimal'?knapsackOptimal(instance):knapsackGreedy(instance,strategy);
  return strategy.algorithm==='local'?graphLocal(instance,strategy):graphDijkstra(instance);
}
