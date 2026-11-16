# Stage2 technical acceptance

Machine: Windows11 x64, AMD Ryzen7 8745HS (8 cores/16 logical),33,599,430,656 bytes RAM. Python3.12.7, PyTorch2.8 CPU float64, NumPy2.2.6, canonical MuJoCoWASM4.0.1. Node24.22.1 / pnpm11.25.0. Browser tests use pinned Chromium141.0.7390.37 with headless software rendering,1440×1100 and390×844. This is not a measured hardware30FPS/performance claim.

Executed from project after sourcing `scripts/Environment.ps1` (all runtime/cache/browser/profile/temp/output in D:):

| Actual command | Actual result |
|---|---|
| `.runtime/repro-venv/Scripts/python.exe -m pytest -q` before implementation |48 passed,16.19s; independently reviewed predecessor |
| same environment `-m policyglass.cli verify --output .runtime/stage2-science.json` and `demo --output .runtime/stage2-demo` |actual numerical/physical checks and artifacts; report009 |
| `.venv/Scripts/python.exe -m pytest -q --junitxml=.runtime/stage2-pytest.xml` |55 passed,19.30s; report012 |
| `.venv/Scripts/python.exe -m ruff check src tests scripts/export_stage2_dialogue.py` |all checks passed |
| `.venv/Scripts/python.exe -m ruff format --check src tests scripts/export_stage2_dialogue.py` |30 files already formatted |
| frontend `pnpm test` on Vitest4.1.12 |4 passed; quaternion order/handedness, asymmetric grid indexing, projected residual and architecture-derived output index |
| `scripts/Test-Workbench.ps1` |production build and six real service browser scenarios; final report016 |
| frontend `pnpm audit --json` |zero reported advisories across217 dependencies, including dev; report014 |

Source/test/config file hashes at final check are in017. The implementation commit recorded in Stage2 handoff binds these files; later seal changes only documentation/evidence. Original native transcript copied read-only from C: to ignored D: private evidence; public excerpt has a hash/scope manifest. No C: file was modified/deleted, no global install/system setting change was made. No unrelated CounterLab/LightForge file was included.

Checks include actual reward-edit temporal propagation, preservation of parent checkpoint bytes, frozen-policy evaluation determinism without learning, persisted notebook reopening, cancelled loss parameter restoration, explicit mass/damping reset and actual gravity scaling. SAC loss-slice finite differences match the **recorded post-critic Actor** gradient at abs1e-8/rel1e-6. Detach comparison uses actual autograd, same values/noise and no optimizer step; the Q action derivative disappears but entropy gradients remain.

Browser acceptance uses no mocked API:

1. PPO creation/actual training; shared sample identity; actual layer values and expanded3D neuron display; real loss slice; origin branch; fixed-batch recompute; notebook; export; close/import; matching optimizer tensors after rerun; persisted notes after reload; no page errors.
2. SAC doubleQ grid values at selected i/j match independent service requests; Q action path; all eight lesson controls;390px page has no horizontal overflow; no page errors.
3. Pause at safe boundary; reload/reconnect; resume; cancel; corrupted checkpoint rejected visibly and committed state remains accessible.
4. Forward-only event persists across reload with no learning; explicit doubled-mass/reset branch has correct masses/time and invalidated old batch; parent checkpoint unchanged.
5. Actual frozen-parameter vs detach-Q lesson probe; five preregistered seeds×ratios1/4, all ten actual training jobs, real evaluations, full export and five valid results per group.
6. Built production workbench served by FastAPI, connected health, no CDN/external asset requests or browser errors.

Short course protocol evidence013 retains all ten results, metrics, IDs, elapsed times and failures (none in that run). It used only **one train iteration**,16 interactions per experiment, small8×8 networks, then deterministic evaluation on seeds701–703 for64 steps. Ratio1 mean-distance median0.916397m (range0.913065–0.919680); ratio4 median0.917975m (range0.913949–0.922150). These poor short-run results do not establish improvement, learning success or a general replay-ratio effect. Full frozen-policy frames remain in ignored raw exports; public summary explicitly omits frame arrays. Stage3 must conduct meaningful-budget independent research and report every seed/failed run.

Actual earlier failures/fixes remain in010 and native conversation: browser download/incomplete-install launches, test-runner collection, cross-thread lock release, HTML decimal stepping, mixed old/new server schema, DOM portal lifecycle and a scientific-notation assertion. The initial dependency choices were audited and updated to patched KaTeX0.19.1, Vite7.3.8 and Vitest4.1.12, followed by the final build/unit/browser checks. pnpm11 license-index lookup failed; report015 instead reads all70 actual production manifests and hashes their local license notices. Stage3 retains the full redistribution-notice/release audit obligation.

Limits: no real learner observations or independent expert review; no trained-policy convergence or educational-efficacy claim; no final offline package, cross-machine10-minute reproduction, sustained GPU FPS/memory benchmark or optional DeepSeek feature yet. Video/PDF remain deferred. `.pgwork` exports checkpoint/notebook/input provenance, not all historical12MB Traces; old imported references retain source IDs and explicit recomputation creates new local events. These remaining final-release obligations belong to Stage3 and are not silently represented as completed.
