# Stage 2 — integrated 3D teaching product

Status: READY

Verified implementation commit: **7a98f876c49677d798f3d78c850fd200c7dbbdc5**. Initial implementation: a68b3ad. Following seal commit changes only documentation/evidence. Stage3 starts only after this READY and explicit completion delivery; read the seal before editing the shared checkout.

## Scope and files

Project D:/传智杯1/counterlab/policyglass; Git root D:/传智杯1/counterlab; origin https://github.com/lsh666-vs/zhichuanbei1 . Same main history; do not rewrite. Two unrelated untracked LightForge files remain untouched: lightforge/scripts/stage2_port_check.py and lightforge/src/lightforge/ports.py. Do not add them.

Read AGENTS.md, DEVELOPMENT_PLAN.md, SCIENTIFIC_CONTRACT.md, CONTRACTS.md, PHYSICS_RUNTIME.md, WORKBENCH.md and Stage1/2 handoffs. Each shell sources scripts/Environment.ps1. All runtime/cache/browser/profile/temp/output stays D:. No C: file was modified/deleted; no global install/system/DLL repair. Stage2 did not use image generation; prior narrow new-image permission remains recorded.

## Implemented product

- Complete React/TypeScript workbench: creation/configuration/recent experiments; real task state/control/reconnect; sample/event/parameter selection; source versions; environment/optimizer/physical counters.
- Four computed3D views: actual MuJoCo arm geometry/body poses, target preview/recorded forces and mass/damping reset branches; architecture-derived instanced network with module expansion/path isolation/neuron/edge selection/forward-backward values; SAC Q1/Q2/min action surfaces; actual fixed-batch loss plane with gradient/update projection, off-plane residual and real learning-rate branches. Complete numeric alternatives and raw grids remain accessible.
- Deep source-bound on-demand tensor/normalization/layer/distribution/policy/objective/gradient/Adam inspection. No browser learner or explanatory fake numbers.
- All eight course workflows: background/prediction/operation/evidence/explanation/free exploration/save. Course saves require prediction, explanation and a real saved event. Full temporal reward interventions; actual frozen-parameters vs detach-Q autograd probe; preregistered five-seed replay protocol.
- Durable typed source-linked notebooks; origin full-state branches; comparison; safe .pgz and bounded .pgwork save/import/export; close/reopen/recompute. Forward-only events now save immutably with identical origin/output and job_id:null; no training job is invented.

## Actual checks and evidence

Stage1 independently reviewed before implementation:48 tests, verify and demo rerun (009). Final Python suite **55 passed**,19.30s (012); Ruff check/format passed. Frontend bridge tests **4 passed**. Production build Vite7.3.8 passed. Final real-service Chromium suite **6 passed**,87.35s,0 skipped/failed/flaky (016). No mocked API. It covers:

1. PPO create→train→actual sample/layer values and expanded3D→loss→origin branch→fixed_batch→notes→export→close/import→identical optimizer tensors after rerun→persisted notes after reload; no page errors.
2. SAC grid values matched actual service requests; Actor path; eight course controls;390px no overflow; no page errors.
3. Safe pause, reload/reconnect, resume, cancel, corrupt-import rejection and committed-state recovery.
4. Saved forward-only events/no learning; explicit doubled-mass/reset child with correct geometry/time, old batch invalidated and parent unchanged.
5. Actual detach course probe; all ten five-seed replay jobs/evaluations and full export.
6. Built FastAPI production entry with connected health and no CDN/external asset requests.

017 hashes final tested source/config/test files; verification found no mismatches. Acceptance018; genuine issues/fixes010; initial/extended browser results008/011; dependency audit014 (zero reported advisories including dev);70 actual production manifests and license-notice hashes015; screenshots stage2-ui/. Native session copied read-only into ignored evidence/private; public dialogue-stage2.jsonl/manifest identify capture scope/omissions. Machine coordinator messages and scripted E2E notes are not human/learner feedback.

Owned test servers stopped after success;8787/5173 are free. Runtime stores/raw exports stay D: ignored, including .runtime/e2e-store and .runtime/e2e/actual-five-seed-study.json.

## Reproduce

```powershell
. .\scripts\Environment.ps1
& .\scripts\Build-Frontend.ps1
& .\Start-PolicyGlass.ps1
```

Open http://127.0.0.1:8787/ . FastAPI serves the built UI; /docs remains API docs. No key/network needed after install/build. Dev: API8787 plus frontend pnpm dev5173. Restart API after Python config/protocol changes so server/spawn workers use the same code.

```powershell
. .\scripts\Environment.ps1
& .\.venv\Scripts\python.exe -m pytest -q
& .\scripts\Test-Workbench.ps1
```

Test-Workbench builds, owns API/Vite, uses independent .runtime/e2e-store, refuses occupied ports and stops only its processes. Add -InstallBrowser if absent; browser/profile/temp remain D:. Frontend install: scripts/Build-Frontend.ps1 -Install. Patched pins: KaTeX0.19.1, Vite7.3.8, Vitest4.1.12; lock in frontend/pnpm-lock.yaml and independent workspace.

## Critical source semantics

SAC recorded Actor uses **post-critic** Q. A Trace-aligned loss request passes trace_id and exact origin, retaining origin Actor/alpha/batch/noise while loading updated online Q from output. Result labels after_recorded_critic_step; finite differences match the recorded gradient. Ordinary checkpoint slices retain their Q. Do not regress this distinction.

Minibatch rows are not chronological; arm draws actual before→after segments only. SAC IDs may repeat. Q state is selected experience before; physical display is after, both sourced. MuJoCo wxyz→Three xyzw; world Z-up. The grid is a ruler, not a collision plane; no collision response or physics backprop is invented.

Loss-plane direction lines hold origin-loss height; endpoint height does not imply recomputed loss. Residual covers every off-plane Actor coordinate. Signed small scientific-notation values remain nonzero, null gradients remain null. Edited forward inputs may leave the physical state manifold.

Mass/damping reset clears old SAC replay because mass is unobserved. Historical reward intervention recomputes full GAE, while physical frames retain original reward. train gathers valid new PPO data; fixed_batch is explicitly counterfactual.

.pgwork carries full safe checkpoint, notes and optional edited forward input/noise; it **does not embed all old12MB Traces**. Imported notes keep original IDs; explicit rerun creates local evidence after moving stores. No pickle/eval/executable suggestions. See WORKBENCH.md for operation details.

## Stage3 and honest limits

No successful policy, educational efficacy, real learner feedback or independent review is claimed. Course7 evidence013 used one train iteration,8×8 networks and16 interactions/experiment; actual mean distances around0.9m are poor. All ten results are retained, not cherry-picked; this workflow test does not replace meaningful-budget evaluation.

Stage3 must independently review numerical/graphical work, run meaningful multi-seed policy/failure studies with all seeds/failures/budgets, add optional official DeepSeek explanations with event citations, obtain real4–6 learners/content reviewer (ask user for actual participants), measure GPU FPS/latency/memory/accessibility/security, create offline package and clean cross-machine reproduction. Headless screenshots do not prove30FPS. Audit zero advisories is point-in-time; license metadata is not the complete redistribution notice archive. Video/PDF remain postponed unless user changes that instruction.

Keep genuine Git/conversations; never invent human fixing instructions, three Prompt chains or user feedback. First Stage3 action: independently verify this implementation, hashes,55 tests and6 browser scenarios and inspect actual UI/data, then begin its authorized stage. Chat IDs and explicit serial-message authorization are in CHAT_COORDINATION.json. No polling wait is needed after explicit completion delivery.

