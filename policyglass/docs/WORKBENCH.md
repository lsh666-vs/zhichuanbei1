# Stage2 workbench operation and boundaries

React/TypeScript, R3F/Three.js, Zustand and KaTeX form the local graphical product. The Python learner remains the only learning kernel. No external fonts/CDN, model keys or network calls are required after installation/build. A built frontend is served by the API at `/`; development uses Vite5173 proxying `/api` to8787.

## Open and run

```powershell
. .\scripts\Environment.ps1
& .\scripts\Build-Frontend.ps1
& .\Start-PolicyGlass.ps1
```

Open http://127.0.0.1:8787/ . Create an experiment (PPO/SAC, seed,1–3 hidden layers2–128 units, activation, budgets and bounded structured overrides). The new policy is randomly initialized, not a claimed successful policy. Current environment interactions and optimizer updates have separate counters. Jobs are queued/running/paused/completed/cancelled/failed; controls act between committed iterations. Reopening the current job URL reconnects via real GET state. A failed synchronization is displayed, not silently treated as success.

`train` collects valid new data and resumes from the current committed state. `fixed_batch` explicitly reuses the saved batch/noise for a counterfactual. The source dropdown used for prediction/branches/slices/export is separate from the selected historical Trace. Each event's inspector shows its own origin version even if that dropdown changes. `origin/output` refer to exactly one traced update; latest state may include more PPO epochs/SAC updates.

## Four computed3D views

- **Arm:** geometry dimensions from the API and body poses from real MuJoCo; wxyz is converted to xyzw, Z is up, units are SI. Dragging the target changes only a preview marker until “记录并计算干预”. A branch stores the target/force/duration; unreachable targets fail visibly. Mass/damping changes require the explicit reset checkbox. Reset clears old batch and SAC replay because masses are not an observed policy feature. Discrete minibatch rows are never connected as chronological motion; only actual before→after segments are drawn. The grid is a ruler, not a collision plane.
- **Network:** architecture-derived modules, layers and instanced units. Expand the module, filter model/path and select a neuron or edge. Positive/negative colors are accompanied by signed values. Forward shows activations and W·x; the explicit backward toggle shows the recorded completed backward and W·dL/dz. Null is never fabricated as zero. Physical dynamics are not in the differentiation graph.
- **DoubleQ:** SAC observation is the selected experience's **before** frame, with two physical torque coordinates varied and the other coordinate fixed. Every height comes from actual Q1/Q2 evaluation. Choose Q1, Q2, both or min, rotate, click or numerically select a grid point. Full grid data is available as a2D alternative and JSON export.
- **Loss:** two independent Actor scalar parameter directions; batch/targets/noise/other models fixed. Trace-aligned SAC slices use **post-critic** Q with origin Actor/alpha so the recorded Actor gradient matches the plane. This version mixture is intentional, read-only and labeled. Ordinary checkpoint slices retain that checkpoint's Q. `origin_loss` is evaluated even for an even grid. Orange is actual Adam projection; blue is −η∇L as a plain-gradient-descent comparison, not an executed update. Heights of these projected direction lines are held at origin loss and do not imply endpoint loss. Off-plane update residual is reported. Learning-rate comparison creates a genuine child and reruns a fixed update. This is a2D slice, not the full loss landscape.

The WebGL context stays stable while modes change; camera resets explicitly. Labels are locally rendered CanvasTexture sprites with disposal; no DOM-root portals or remote glyph fonts. A numeric view remains available when WebGL fails. Browser/headless software rendering is not evidence of a hardware30FPS guarantee.

## Deep inspection and evidence

Timeline lists real event IDs; tensors are fetched on demand instead of polling12MB traces. Shared selection links sample row/sample_id, physical transition, network, formula, local derivative, actual batch backward and optimizer. Matrices have full raw values, paging and copy. For sample gradients, sum the contributions (already divided by batch size), then compare pre-clip raw gradients. Do not sum sample-wise Adam updates. Adam moments, norm clipping, corrected moments/variance, delta and parameters are distinct fields.

Forward experiments accept edited observations and fixed noise without learning/physical motion. Their complete events are saved as immutable forward-only Traces, with identical origin/output checkpoint and `job_id:null`; no training task is invented. Interactive input row0 is explicitly not an environment transition. Edited observations can leave the physical state manifold. Import/export preserves forward input/noise for explicit rerun.

Eight lessons each have background, prediction, actual operation, numeric evidence, explanation, free exploration and saved record. A saved course record requires a prediction, explanation and real source event. Lesson2 can change exactly one historical PPO reward, recomputing full temporal GAE before reselection; it is labeled a counterfactual reward, not recomputed physics. Lesson5 uses actual autograd to compare frozen Critic parameters and detached Q while keeping the entropy Actor path. Lesson7 preregisters five seeds, trains ratios1/4 with identical interaction budgets, evaluates frozen deterministic policies on seeds701–703 and exports every row/failure/timing. The one-iteration E2E protocol demonstrates the workflow, not educational efficacy or policy convergence.

## Save, close, import and compare

Notebook records live in the project's D: SQLite store, with exact checkpoint/Trace/event/sample references. `.pgwork` is a bounded JSON envelope containing a base64 safe `.pgz` checkpoint, notebook and source references (plus edited forward input when present). It is **not** a whole archive of old12MB Traces. After moving to a fresh store, imported notes retain their old source IDs; run `fixed_batch` or the stored forward input to create new local events. Original physics rewards remain distinct from counterfactual GAE rewards.

Raw `.pgz` remains supported. The server validates hashes, names, shapes, finite values and state. Notebook imports validate typed size-limited fields and render as text, never executable markup/code. Export uses a selected checkpoint; it does not mutate historical artifacts. Comparison identifies current state vs exact Trace versions separately. Network parameter differences require matching architecture; an orange ghost arm shows the comparison's actual current state, not an invented time-synchronized rollout.

## Tests and later work

`scripts/Test-Workbench.ps1` builds and starts owned API/Vite processes on8787/5173, runs real-browser checks, then stops only those owned processes. It refuses occupied ports. Playwright binaries/profiles/temp/output are D: `.runtime`. Tests do not mock the API. `pnpm test` verifies coordinate/index/projection bridges. Pytest includes exact reward propagation, no-update probes, cancellation restoration, restart persistence, physical reset and SAC slice finite differences.

Stage3 still owns independent scientific evaluation, successful-policy/multi-seed research at meaningful budgets, optional official DeepSeek explanations, real learner feedback, measured performance/accessibility/security hardening and offline release packaging. Videos/PDF remain postponed. Small local technical checks do not stand in for real participants or an independent review.
