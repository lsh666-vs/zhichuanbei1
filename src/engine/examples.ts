import type { Domain, Instance, Strategy } from '../shared/types.js';

export function presets(domain: Domain): Strategy[] {
  if (domain === 'interval') return [
    {id:'interval-value',name:'收益优先',domain,algorithm:'greedy',score:'value',direction:'desc',tieBreak:'id'},
    {id:'interval-earliest',name:'最早结束',domain,algorithm:'greedy',score:'end',direction:'asc',tieBreak:'id'},
    {id:'interval-shortest',name:'最短时长',domain,algorithm:'greedy',score:'duration',direction:'asc',tieBreak:'id'},
    {id:'interval-density',name:'单位时间收益',domain,algorithm:'greedy',score:'value / duration',direction:'desc',tieBreak:'id'},
    {id:'interval-optimal',name:'精确动态规划',domain,algorithm:'optimal',score:'value',direction:'desc',tieBreak:'id'},
  ];
  if (domain === 'knapsack') return [
    {id:'knapsack-density',name:'性价比优先',domain,algorithm:'greedy',score:'value / weight',direction:'desc',tieBreak:'id'},
    {id:'knapsack-value',name:'价值优先',domain,algorithm:'greedy',score:'value',direction:'desc',tieBreak:'id'},
    {id:'knapsack-light',name:'重量优先',domain,algorithm:'greedy',score:'weight',direction:'asc',tieBreak:'id'},
    {id:'knapsack-optimal',name:'精确动态规划',domain,algorithm:'optimal',score:'value',direction:'desc',tieBreak:'id'},
  ];
  if (domain === 'graph') return [
    {id:'graph-local',name:'局部最短边',domain,algorithm:'local',score:'weight',direction:'asc',tieBreak:'id'},
    {id:'graph-global',name:'Dijkstra 全局距离',domain,algorithm:'dijkstra',score:'weight',direction:'asc',tieBreak:'id'},
  ];
  throw new Error('未知领域。');
}
export function defaultStrategy(domain: Domain): Strategy { return presets(domain)[0]; }
export function demoInstance(domain: Domain): Instance {
  if (domain === 'interval') return {domain,objective:'value',items:[
    {id:'A',label:'长任务 A',start:0,end:4,value:9},
    {id:'B',label:'前半程 B',start:0,end:2,value:6},
    {id:'C',label:'后半程 C',start:2,end:4,value:6},
  ]};
  if (domain === 'knapsack') return {domain,capacity:10,items:[
    {id:'A',label:'高密度 A',weight:6,value:13},
    {id:'B',label:'组合 B',weight:5,value:10},
    {id:'C',label:'组合 C',weight:5,value:10},
  ]};
  if (domain === 'graph') return {domain,directed:true,source:'S',target:'T',nodes:[
    {id:'S',label:'起点',x:65,y:180},{id:'A',label:'A',x:235,y:80},
    {id:'B',label:'B',x:235,y:280},{id:'T',label:'终点',x:430,y:180},
  ],edges:[{id:'SA',from:'S',to:'A',weight:1},{id:'AT',from:'A',to:'T',weight:10},
    {id:'SB',from:'S',to:'B',weight:3},{id:'BT',from:'B',to:'T',weight:3}]};
  throw new Error('未知领域。');
}
