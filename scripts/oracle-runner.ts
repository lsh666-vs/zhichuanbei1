import { evaluate } from '../src/engine/index.ts';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const cases = JSON.parse(input) as {instance: Parameters<typeof evaluate>[0];strategy:Parameters<typeof evaluate>[1]}[];
const results = cases.map((item) => { try { return {ok:true, evaluation:evaluate(item.instance,item.strategy)}; } catch (error) { return {ok:false,error:String(error)}; } });
process.stdout.write(JSON.stringify(results));
