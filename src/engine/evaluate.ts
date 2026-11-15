import type { Evaluation, Instance, Strategy } from '../shared/types.js';
import { runCandidate, runReference } from './execution.js';
import { enumerateIntervalOptimum, independentOptimum, verifyExecution } from './verification.js';
import { validateInstance, validateStrategy } from './validation.js';

export function evaluate(input:Instance,strategyInput:Strategy):Evaluation {
  validateInstance(input);validateStrategy(strategyInput);
  if(input.domain!==strategyInput.domain)throw new Error('实例和策略必须属于同一领域。');
  const instance=structuredClone(input),strategy=structuredClone(strategyInput);
  const candidate=runCandidate(instance,strategy),reference=runReference(instance);
  const independent=independentOptimum(instance);
  const verified=verifyExecution(instance,candidate)&&verifyExecution(instance,reference)&&
    (independent===null?!reference.complete:reference.complete&&reference.value===independent);
  const base={instance,strategy,candidate,reference,difference:0,witnessVerified:verified};
  if(!verified)return {...base,verdict:'invalid',details:['执行结果未通过独立可行性与最优值复核；不形成反例结论。']};
  if(instance.domain==='graph'&&!reference.complete) return {...base,verdict:'pass',details:[
    '独立 Bellman–Ford 与全局最短路求解均确认：本输入的目标不可达。',
    'value=0 仅为不可达状态的有限序列化占位值，不是长度为 0 的路径。',
    '本输入没有可行的起终点路径；这不证明当前策略在其他输入上正确。',
  ]};
  const difference=instance.domain==='graph'?(candidate.complete?candidate.value-reference.value:0):reference.value-candidate.value;
  const failure=!candidate.complete||difference>0;
  if(failure&&instance.domain==='interval'&&enumerateIntervalOptimum(instance)!==reference.value)
    return {...base,verdict:'invalid',witnessVerified:false,details:['区间反例未通过独立子集枚举复核。']};
  const referenceMethod=instance.domain==='interval'?'时间轴动态规划；反例额外进行子集枚举':instance.domain==='knapsack'?'折半子集枚举':'独立 Bellman–Ford';
  return {...base,difference,verdict:failure?'counterexample':'pass',details:[
    failure?(candidate.complete?`候选值 ${candidate.value}，精确参照值 ${reference.value}，差距 ${difference}。`:'候选策略未到达终点，但参照找到可行路径；路径长度差不适用。'):'当前实例达到精确参照目标值。',
    `解的合法性已重新计算，参照已由${referenceMethod}交叉核验。`,
    '结论只对应此实例与当前契约；单例通过不是普遍正确性证明。',
  ]};
}
