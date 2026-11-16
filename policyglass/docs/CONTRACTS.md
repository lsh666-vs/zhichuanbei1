# Stage1 contracts for the interactive product

Version: policyglass.*.v1. Read with SCIENTIFIC_CONTRACT.md and actual generated OpenAPI (`/openapi.json`). Numerical updates use CPU float64. Geometry uses SI, right-handed Z-up; quaternions are **w,x,y,z**, whereas Three.js uses x,y,z,w. Never silently swap axes/units. Physical time, environment step, optimizer update and playback position are separate quantities.

## Python modules

- `Learner(ExperimentConfig)` owns original Actor/Critic networks, independent Adam states, policy and replay RNGs, physical environment and cached batch. `iteration(record=True)` actually collects data and updates, with PPO potentially multiple epochs and KL stopping. `update_ppo(last_batch, record=True)` / `update_sac(last_batch, record=True)` implement an explicit fixed-batch counterfactual.
- `trace_origin_state` is the exact state immediately before the traced update, after its rollout/replay batch and noise have been selected. `trace_result_state` is immediately after that one traced update. The experiment's latest checkpoint may include further PPO epochs. These must not be confused.
- Input normalization is fixed physical-unit scaling: subtract means `[0,0,0,1,1,1,0,0,0,0,0,0.18,0,0,0.18]`, divide scales `[1,1,1,1,1,1,5,5,5,0.6,0.6,0.6,0.6,0.6,0.6]`. Saved and validated. No running statistics, hidden state or observation clipping is currently used. Display derivatives in raw physical and normalized feature units distinctly.
- `branch(learner, Intervention)` clones full state. Hyperparameter edits are whitelisted and validated; gamma/lambda edits recompute cached PPO GAE/returns. Weight entry edits optionally reset that model's optimizer moments. Normal `train` always collects valid new PPO data; `fixed_batch` is labeled explicitly.
- `q_slice` freezes observation and unselected action coordinates; `loss_slice` varies two actor scalar coordinates, freezes batch/noise/targets/critics/alpha and restores parameters afterwards. Origins, axes and units are returned. No claim that this is the whole parameter space.
- `SpatialArm`: real canonical MuJoCo WASM. `reset`, `step`, `set_joint_state`, `set_target`, `apply_force`, `snapshot`, `restore`, `frame`, `geometry`, `close`. External force is in world axes, applied at forearm COM for a stated number of control steps. Each control step uses configured physics substeps. A reset clears pending forces. Targets are checked with analytic joint-limited IK. Static holdability is separately reported.
- Current reward per control step: `-distance_m**2 - .002*sum(torque_nm**2) - .001*sum((torque-prev_torque)**2)`. Distance success `<.04m` is evaluation-only; the task continues until time-limit truncation and correct bootstrapping. It is not terminal on success.
- Default 5Nm motor bound exceeds default target's required static gravity compensation; this was independently checked, not inferred from geometric reach. The idealized model has no collision/ground contact. Do not draw a collision response that the model never computed.

## HTTP (local default 127.0.0.1:8787)

All object IDs are 32 lowercase hex characters; never use arbitrary filesystem paths. API returns 400 for invalid semantic requests, 404 for missing objects, 422 for model validation, 413 for request budgets. Inputs reject nonfinite numbers, executable expressions and unknown fields. Core does not need an API key.

| Route | Use |
|---|---|
| GET /api/health | Actual service version, computation mode, physics engine and current completion boundary |
| GET /api/schema | Exact ExperimentConfig JSON Schema |
| GET/POST /api/experiments | List / create from `{label,config}` |
| GET /api/experiments/{id} | Config, architecture, physical geometry/frame, observation/normalization, current checkpoint |
| GET /api/experiments/{id}/parameters | Current actual model parameter tensors; no generated graph guesses |
| POST /api/experiments/{id}/predict | `{observation?,noise:[0,0,0],checkpoint?}` -> actual forward trace with **no** parameter/physics update |
| GET /api/experiments/{id}/checkpoints | Immutable historical/source/output checkpoints |
| POST /api/experiments/{id}/jobs | `{iterations:1..100,record:true,mode:'train'|'fixed_batch'}` ->202 and task ID |
| GET /api/jobs/{id} | Status, control, completed iterations, actual summaries, checkpoints, trace ID, error |
| POST /api/jobs/{id}/control/{run|pause|cancel} | Cooperative safe-boundary control; finished jobs cannot be resumed in-place |
| WS /api/jobs/{id}/events | Initial current task then changed states; closes on terminal state; reconnect via GET |
| GET /api/experiments/{id}/traces | Trace metadata/history, including precise origin/output checkpoints |
| GET /api/traces/{id}/index | Lightweight event inventory with tensor shapes; no full sample-gradient arrays |
| GET /api/traces/{id}/events/{index} | On-demand one actual event, including tensor payload |
| GET /api/traces/{id}/frames | Replayed actual physical frames paired with batch sample IDs |
| GET /api/traces/{id} | Full actual trace, usually around 12MB at default dimensions; do not poll this at render FPS |
| POST /api/experiments/{id}/branches | `{checkpoint?,label?,intervention:{kind,path,value,index?,reset_optimizer?}}` -> child experiment |
| POST /api/experiments/{id}/physics-branches | `{target?,force_newtons?,force_steps?,action?,steps?,label?}` -> separate child + physical frames; parent unchanged |
| POST /api/experiments/{id}/q-slice | `{axes:[0,1],fixed_action:[0,0,0],observation?,resolution:2..65,checkpoint?}` |
| POST /api/experiments/{id}/loss-slice | `{path_x,index_x,path_y,index_y,extent,resolution:2..31,checkpoint?}` |
| GET /api/checkpoints/{id}/download | Raw checksummed `.pgz` bundle |
| POST /api/import | Raw application/octet-stream bundle -> separate imported experiment |

Default network has two hidden layers; final actor bias name is `actor/biases.2`. A one/two/three-hidden-layer model changes that final index. Read architecture rather than hardcoding. Parameter path is `<model>/<named_parameter>`, e.g. `actor/weights.0`, index `[row,column]`; vector bias has one index. Temperature is `temperature/log_alpha`, scalar index `[]`.

## Trace meaning

PPO supports shuffled configurable minibatches (default32, rollout32) over each fixed rollout. Last partial minibatches, including size1, are valid; advantages are normalized across the **full rollout**, never recomputed within a shuffled chunk. Full temporal rollout, its physical frames and selected indices are checkpointed. Gamma/lambda interventions recompute GAE in original time order and then reselect the same minibatch. Post-update KL stopping evaluates the full rollout. At most128 optimizer updates per cooperative iteration boundary are accepted as an explicit responsiveness budget.

`schema,algorithm,update,mode,batch,frames,architecture,events`. Stored API traces add `experiment_id,job_id,origin_checkpoint,output_checkpoint`. Events have stable IDs and `kind,label`; parameter names map directly to actual modules. Layer forward events are appended in computation order, with actual backward gradients attached after the batch backward. `backward` events identify when those gradients became available. Do not present layer gradients as values already known during forward.

- `observation_transform`: raw/normalized input, exact fixed means/scales, local derivative, normalized/raw input gradient.
- `layer`: input, preactivation, activation output, weights/bias, activation derivative, input/preactivation/output gradients.
- `distribution`: mean, raw/clamped logstd and clamp derivative. Bounds [-5,2]; ties are nondifferentiable.
- `policy_operation`: actual Gaussian/tanh/log-density nodes, fixed-latent partial derivatives, reparameterization derivatives and actual total gradients. Distinguish a held-fixed partial from the total gradient through sampling.
- `objective`: exact per-sample losses and algorithm quantities. Frozen targets and critic version are labeled.
- `sample_gradients`: contributions already divided by batch size; **sum**, not mean again, to match raw batch gradients.
- `optimizer`: raw gradients -> global clip factor -> actual gradients -> Adam before/after moments, corrected moments and variance -> delta -> new parameters.
- `target_update`: actual before/online/after Q target tensors and tau.

`predict` has phase `forward_only_no_parameter_update`; null gradient fields mean no backward was performed. In training, unused-path gradients can also be null; explain the graph dependency, not a fabricated number. `mode='actual_computation'` means generated by the numerical engine; the frontend must additionally label retrieval of a saved trace as historical replay.

SAC replay includes compact exact before/after physical state and reward components for every retained transition. Sampled frame order matches `batch.sample_id`, including duplicate sampling. Never substitute latest rollout frames for older sampled experience.

## Task and integrity semantics

At most two active jobs, one per experiment. Actual numerical workers are separate spawned processes. States queued/running/paused/completed/cancelled/failed; pause/cancel takes effect between committed iterations. An iteration can have several PPO optimizer updates. HTTP response202 is not successful computation. Errors are persisted; current committed checkpoint remains recoverable. Server restart marks unfinished jobs failed with an explicit recovery message.

Artifacts are immutable atomic writes with SHA256 in SQLite; checkpoint ZIP contains exactly manifest.json/metadata.json/tensors.safetensors, no pickle or path extraction. Import validates budget, hash, schema, tensor names/shapes/dtypes, finite values, replay counters, normalization and optimizer/physics state. A hash proves integrity, not authorship or scientific correctness.

Read-only experiment views can load a historical checkpoint while a task runs; they represent the last complete state. Starting two server instances against the same store is unsupported. Default loopback host, trusted-host and exact browser-origin policies; frontend origins currently 127.0.0.1/localhost ports5173/8787. If changing ports, update the explicit origin list with tests.

## Stage2 obligations

Additional temporal endpoint: `GET /api/traces/{id}/rollout` returns the complete original PPO rollout, all associated physical frames and selected minibatch indices for GAE teaching. SAC `updates_per_step` (1..32) performs actual newly sampled replay updates for each post-warmup environment interaction; it does not reuse a synthetic fixed batch. Warmup interactions are reported separately via actual env_steps. Counterfactual fixed_batch mode remains a different, explicitly labeled experiment.

An exclusive file lock prevents a second server from resetting jobs in an active store. Job-manager thread operations are synchronized. Keep both guarantees when integrating the frontend.

Read this contract, run the provided tests and demo, inspect actual JSON and OpenAPI. Build all four genuine 3D views and eight courses; connect selection IDs and source/checkpoint semantics. Provide component/E2E checks with the real server. The numerical/HTTP layer does not constitute a completed graphical product. Frontend, final policies, AI assistant and release have their own later acceptance evidence.
