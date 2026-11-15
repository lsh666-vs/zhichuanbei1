import { buildApp } from './app.ts';
const port=Number(process.env.COUNTERLAB_PORT??4317);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('COUNTERLAB_PORT必须为1024至65535之间的整数');
const app=await buildApp({dataDir:process.env.COUNTERLAB_DATA_DIR});
try{await app.listen({host:'127.0.0.1',port});process.stdout.write(`CounterLab listening at http://127.0.0.1:${port}\n`)}catch{process.stderr.write('CounterLab无法启动，请检查端口及D盘数据目录。\n');await app.close();process.exitCode=1;}
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void app.close().then(()=>{process.exitCode=0})});
