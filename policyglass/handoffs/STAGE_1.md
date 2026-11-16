# Stage 1 — scientific foundation

Status: READY

Verified implementation commit: **8d944e683ff2a00621af28a8611c1c5d9aa4e90e**. The following handoff seal commit changes only documentation/evidence. Successor starts after this READY file and an explicit completion delivery from the coordinator. Stage2 must read the seal commit before editing. Stage3 still waits for Stage2.

## Location and boundaries

Project D:/传智杯1/counterlab/policyglass; Git root D:/传智杯1/counterlab; origin https://github.com/lsh666-vs/zhichuanbei1 . All work is pushed on main; do not rewrite history. Old CounterLab/LightForge remain historical. Two untracked LightForge files existed before this stage and are unrelated: scripts/stage2_port_check.py and src/lightforge/ports.py. Do not add/delete/alter them.

Read AGENTS.md, docs/DEVELOPMENT_PLAN.md, docs/SCIENTIFIC_CONTRACT.md, docs/CONTRACTS.md and docs/PHYSICS_RUNTIME.md. The approved plan is complete; no core capability or key3D requirement was removed. Stage1 numerical foundation is ready; the final React teaching product is not yet implemented.

## What actually exists

- CPU float64 original PPO-Clip/GAE with shuffled configurable minibatches, full-rollout fixed targets/advantage normalization, correct truncation, transformed Gaussian actions, MC transformed entropy and full-rollout post-update KL stopping.
- Modern SAC: real replay, selectable replay ratio, double/target Q, stopped target, differentiable actor-through-frozen-critic, stable tanh log-density, automatic entropy temperature and Polyak update.
- Actual neural forward inputs/preactivations/activations/local derivatives, policy operation partials and total gradients, sample gradient contributions, full batch backward, raw/clipped gradient, before/after Adam states and weights. Exact origin/output checkpoints for a traced update.
- Full state snapshots: network/optimizer/RNG, fixed normalization, temporal rollout/minibatch indices, replay with original physical frames, current physics and reward state. Safe JSON+Safetensors bundles, SHA256, bounded import, immutable artifacts and controlled branches.
- Actual3D spatial torque-controlled arm in canonical MuJoCoWASM4.0.1, analytic FK/IK/gravity checks, units, body poses, forces, target edits and static feasibility. Physics and numerical Q/loss slice endpoints are ready for frontend3D; no final3D rendering is claimed.
- FastAPI with separate spawned learning workers, real progress/WS, pause/resume/cancel, exclusive store ownership, restart recovery, actual inference, branch creation, import/export, lightweight trace index/event APIs, GAE rollout API.

## Reproduce now

From project in PowerShell:

```powershell
. .\scripts\Environment.ps1
& .\.runtime\repro-venv\Scripts\python.exe -m pytest -q
& .\.runtime\repro-venv\Scripts\python.exe -m policyglass.cli verify --output .runtime/science-check.json
& .\.runtime\repro-venv\Scripts\python.exe -m policyglass.cli demo --output .runtime/demo
& .\.runtime\repro-venv\Scripts\python.exe scripts/smoke_tcp.py
```

Both `.venv` and `.runtime/repro-venv` are usable. The latter was freshly built from the lock: 48 tests passed,10.45s; check+format+pip check passed. See evidence/003..007. Clean install160.1s used D: cache; not a network download guarantee. Demo produced actual origin/output/current `.pgz`, complete traces and true Q/loss grids in .runtime/demo.

API startup: `. .\scripts\Environment.ps1`, then `& .\.venv\Scripts\python.exe -m policyglass.cli serve --port 8787`. `/docs` is an interactive scientific API (Swagger's default assets use CDN); it is not the final teaching website. Real TCP smoke uses temporary ports and stops its own server. No stage1 server needs to be kept alive. Core physics/learning require no network/key.

## Critical frontend semantics

Use actual API, not a second JS learner. Read generated `/openapi.json` and CONTRACTS.md. Quaternions are wxyz, world is Z-up. Replay frames match each sampled ID, not latest frames. Labels must distinguish live compute, saved replay and forward-only prediction. Display gradient values only after backward; fixed-latent partials differ from reparameterized total gradients. Optimizer sample contributions sum before Adam, never add sample Adam updates.

`trace.origin_checkpoint` / `trace.output_checkpoint` are exact one-update states; experiment current checkpoint can include later PPO epochs or SAC replay updates. Use origin for controlled interventions and fixed_batch mode for an isolated comparison. Gamma/lambda edits re-evaluate full chronological GAE, not shuffled batch order.

Default model has hidden[64,64], final actor bias `actor/biases.2`; derive names from architecture for other depths. Input normalization is fixed physical-unit scaling with explicit saved means/scales. API supports real edited-observation/noise forward prediction, preserving parent state. A null gradient in forward-only mode means backward was not performed.

## Remaining work and honest limits

Stage2 must implement complete React workbench, four meaningful3D views, source-linked deep inspection, all eight courses, saved notes, comparison/import/export flows, accessible UX and real serverE2E. Numerical and HTTP foundations alone do not satisfy those visual/product requirements.

Stage3 must do real successful-policy/multi-seed evaluation (no success is claimed yet), failure-mechanism studies, optional official DeepSeek explanation with verified available model, real user feedback, performance/security/accessibility and final offline packaging. API interaction jobs save every bounded iteration for safety; long research training should use Learner in-memory with periodic checkpoints/explicit disk budgets, rather than writing a full bundle after every one of100000 training steps. Current loopback/origin rules assume frontend5173 and backend8787.

Ideal rigid-body model has no ground/self collisions. WASM platform bindings are pinned and tested; do not return to failing native DLL probes or modify C: system files. One non-failing Starlette/httpx test-client deprecation is recorded. Cold-network install and final offline10-minute reproduction remain Stage3 checks.

## Genuine evidence and serial chats

Native current-thread transcript was read from C: without alteration and copied privately to ignored evidence/private/. Public excerpt and SHA manifests are in evidence/dialogue-stage1*. Full history includes earlier topics; excerpt scope is explicit. Do not invent human bug-fixing instructions or count coordinator-generated handoff prompts as new human feedback. Three genuine feature chains and actual learning feedback must be audited before final submission; this stage does not pretend that requirement is already complete.

Successor chat IDs and exact titles are in CHAT_COORDINATION.json. Stage2 is 01a1e40b-2634-72d3-bdfd-58388a0befa1; Stage3 is 01a1e40b-28d2-7720-a473-a311e7352cc5. User explicitly authorized three independent serial chats and their handoffs. After your own Stage2 READY, commit/push, send an explicit completion handoff to Stage3. Keep all task writes D: and retain the user's narrowly scoped prior new-image-file permission as recorded in AGENTS.md.

