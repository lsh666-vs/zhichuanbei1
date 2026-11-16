// Original bounded JSONL bridge. Numerical dynamics are canonical MuJoCo WASM.
import loadMujoco from '@mujoco/mujoco';
import {readFileSync} from 'node:fs';
import {createInterface} from 'node:readline';

const wasmBinary = readFileSync(new URL(import.meta.resolve('@mujoco/mujoco/mujoco.wasm')));
const mj = await loadMujoco({wasmBinary, print: x => process.stderr.write(`${x}\n`), printErr: x => process.stderr.write(`${x}\n`)});
const worlds = new Map();
const spec = mj.mjtState.mjSTATE_INTEGRATION.value;
let next = 1;
const arr = value => Array.from(value);

function frame(world) {
  const {model:m, data:d} = world;
  mj.mj_energyPos(m,d); mj.mj_energyVel(m,d);
  return {time_s:d.time, qpos_rad:arr(d.qpos), qvel_rad_s:arr(d.qvel), torque_nm:arr(d.ctrl),
    tip_m:arr(d.site_xpos).slice(0,3), energy_j:arr(d.energy), bias_torque_nm:arr(d.qfrc_bias),
    bodies:['base','upper','forearm'].map((name,index)=>({name,
      position_m:arr(d.xpos).slice((index+1)*3,(index+2)*3),
      quaternion_wxyz:arr(d.xquat).slice((index+1)*4,(index+2)*4)}))};
}

function command(request) {
  if(request.op==='version') return {version:mj.mj_versionString(), engine:'canonical_mujoco_wasm', state_spec:spec};
  if(request.op==='create') {
    if(worlds.size>=512 || typeof request.xml!=='string' || request.xml.length>16000) throw Error('Physics resource budget');
    const model=mj.MjModel.from_xml_string(request.xml);
    const data=new mj.MjData(model);
    const id=String(next++);
    worlds.set(id,{model,data});
    mj.mj_forward(model,data);
    return {id, frame:frame(worlds.get(id)), joint_limits:arr(model.jnt_range)};
  }
  const world=worlds.get(request.id);
  if(!world) throw Error('Unknown physics world');
  const {model:m,data:d}=world;
  switch(request.op) {
    case 'reset': mj.mj_resetData(m,d); d.qpos.set(request.qpos); d.qvel.set(request.qvel || [0,0,0]); mj.mj_forward(m,d); break;
    case 'set_joints': d.qpos.set(request.qpos); d.qvel.set(request.qvel || [0,0,0]); mj.mj_forward(m,d); break;
    case 'step':
      if(!Number.isInteger(request.substeps)||request.substeps<1||request.substeps>20) throw Error('Invalid substeps');
      d.ctrl.set(request.action);
      d.xfrc_applied.fill(0);
      if(request.force) d.xfrc_applied.set(request.force,3*6);
      for(let i=0;i<request.substeps;i++) mj.mj_step(m,d);
      mj.mj_forward(m,d);
      break;
    case 'snapshot': {
      const buffer=new mj.DoubleBuffer(mj.mj_stateSize(m,spec));
      try { mj.mj_getState(m,d,buffer,spec); return {integration:arr(buffer.GetView()), frame:frame(world)}; }
      finally {buffer.delete();}
    }
    case 'restore':
      if(request.integration.length!==mj.mj_stateSize(m,spec)) throw Error('Invalid state length');
      mj.mj_setState(m,d,request.integration,spec); mj.mj_forward(m,d); break;
    case 'delete': d.delete();m.delete();worlds.delete(request.id);return {deleted:true};
    case 'frame': break;
    default: throw Error('Unsupported physics operation');
  }
  return frame(world);
}

process.stdout.write(JSON.stringify({ready:true,version:mj.mj_versionString()})+'\n');
const lines=createInterface({input:process.stdin,crlfDelay:Infinity});
for await(const line of lines) {
  let request;
  try {
    if(line.length>2_000_000) throw Error('Oversized physics request');
    request=JSON.parse(line);
    const result=command(request);
    process.stdout.write(JSON.stringify({sequence:request.sequence,result})+'\n');
  } catch(error) {
    process.stdout.write(JSON.stringify({sequence:request?.sequence,error:String(error.message || error)})+'\n');
  }
}
for(const world of worlds.values()){world.data.delete();world.model.delete();}
