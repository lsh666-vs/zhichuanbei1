import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID,createHash,timingSafeEqual } from 'node:crypto';
import { ENGINE_VERSION,evaluate } from '../src/engine/index.ts';
import type { Domain,Evaluation,Experiment,ExperimentPackage,Instance,JobStatus } from '../src/shared/types.ts';
import { packageSchema,trustedSave,validateExperimentVersions } from './validation.ts';
import { MAX_EXPERIMENT_BYTES } from './limits.ts';

export function canonical(value:unknown):string {
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  return '{'+Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
}
export function checksum(value:unknown){return createHash('sha256').update(canonical(value)).digest('hex')}
export class Store {
  private db:DatabaseSync;
  constructor(filename:string){
    const path=resolve(filename);if(process.platform==='win32' && !/^D:\\/i.test(path))throw new Error('数据库必须位于 D 盘');
    mkdirSync(dirname(path),{recursive:true});this.db=new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS experiments(id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, data TEXT NOT NULL)');
    for(const row of this.db.prepare('SELECT id,data FROM jobs').all()){
      const job=JSON.parse(String(row.data)) as JobStatus;
      if(job.state==='running'||job.state==='queued'){job.state='failed';job.error='服务已重启，本次任务中断。已保存的实验未受影响，请重新运行。';this.saveJob(job);}
    }
  }
  list():Experiment[]{return this.db.prepare('SELECT data FROM experiments ORDER BY updated_at DESC').all().map(row=>JSON.parse(String(row.data)))}
  get(id:string):Experiment|undefined {const row=this.db.prepare('SELECT data FROM experiments WHERE id=?').get(id);return row?JSON.parse(String(row.data)):undefined}
  save(input:unknown,id?:string):Experiment {
    const values=trustedSave(input);const previous=id?this.get(id):undefined;
    if(id&&!previous)throw new Error('实验不存在');
    if(previous && previous.domain!==values.instance.domain)throw new Error('已有实验不能切换领域，请另存新实验');
    const at=new Date().toISOString();const changed=!previous||canonical(previous.strategy)!==canonical(values.strategy)||canonical(previous.instance)!==canonical(values.instance);
    const versions=previous?[...previous.versions]:[];
    if(changed){if(versions.length>=200)throw new Error('实验版本已达到200个，请导出并创建新实验');versions.push({id:randomUUID(),at,strategy:values.strategy,instance:values.instance,evaluation:values.evaluation as Evaluation,note:previous?'策略或输入修改':'初始实验'});}
    else {const current=versions.at(-1)!;current.instance=values.instance;current.evaluation=values.evaluation as Evaluation;}
    const experiment:Experiment={...values,id:previous?.id??randomUUID(),domain:values.instance.domain,createdAt:previous?.createdAt??at,updatedAt:at,versions} as Experiment;
    this.write(experiment);return experiment;
  }
  private write(experiment:Experiment){const data=JSON.stringify(experiment);if(Buffer.byteLength(data,'utf8')>MAX_EXPERIMENT_BYTES)throw new Error('实验及版本记录超过16 MiB，请先导出历史并另存新实验。');this.db.prepare('INSERT INTO experiments(id,updated_at,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at,data=excluded.data').run(experiment.id,experiment.updatedAt,data)}
  delete(id:string){return this.db.prepare('DELETE FROM experiments WHERE id=?').run(id).changes>0}
  history(domain:Domain):Instance[]{
    const result:Instance[]=[],seen=new Set<string>();
    for(const experiment of this.list()){
      if(experiment.domain!==domain)continue;
      const snapshots=[{instance:experiment.instance,strategy:experiment.strategy},...experiment.versions.slice().reverse()];
      for(const snapshot of snapshots){
        if(!snapshot.instance)continue;
        const key=canonical(snapshot.instance);if(seen.has(key))continue;
        const checked=evaluate(snapshot.instance,snapshot.strategy);
        if(checked.verdict==='counterexample'&&checked.witnessVerified){seen.add(key);result.push(checked.instance);if(result.length===20)return result;}
      }
    }
    return result;
  }
  export(id:string):ExperimentPackage|undefined {
    const experiment=this.get(id);if(!experiment)return undefined;
    const payload={format:'counterlab-experiment' as const,version:1 as const,engineVersion:ENGINE_VERSION,exportedAt:new Date().toISOString(),experiment};return {...payload,checksum:checksum(payload)};
  }
  import(input:unknown):Experiment {
    const pkg=packageSchema.parse(input);const {checksum:expected,...payload}=pkg;
    if(!timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(checksum(payload),'hex')))throw new Error('实验包校验和不匹配，文件可能已改变');
    if(pkg.engineVersion!==ENGINE_VERSION)throw new Error('执行器版本不兼容，不能静默迁移实验');
    validateExperimentVersions(pkg.experiment as Experiment);
    const {id:_id,createdAt,updatedAt:_updated,domain:_domain,versions,...values}=pkg.experiment;
    const verified=trustedSave(values);const at=new Date().toISOString();
    const experiment={...verified,id:randomUUID(),domain:verified.instance.domain,createdAt,updatedAt:at,versions} as Experiment;
    this.write(experiment);return experiment;
  }
  saveJob(job:JobStatus){this.db.prepare('INSERT INTO jobs(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(job.id,JSON.stringify(job))}
  getJob(id:string):JobStatus|undefined{const row=this.db.prepare('SELECT data FROM jobs WHERE id=?').get(id);return row?JSON.parse(String(row.data)):undefined}
  close(){this.db.close()}
}
