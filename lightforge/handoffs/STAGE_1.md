# LightForge Stage 1 handoff

Status: **READY** for Stage 2. Date:2026-11-16. This is a foundation handoff, not complete-product acceptance. User explicitly requires interactive functionality, scientific truthfulness and all four core capabilities; deadlines do not authorize lowering quality.

## Location and serial ownership

- Checkout: D:/传智杯1/counterlab/lightforge; Git root is its parent counterlab.
- Root owns Stage1; Stage2 thread:01a1e377-ff56-7842-8f68-6ca6b2e18756; Stage3 thread:01a1e377-452e-74b2-8e4d-b57291d31d92, host local.
- Stage2 starts only after explicit READY message. Stage3 waits for Stage2 READY, and must receive the authorized handoff after Stage2 commits/pushes and stops modifications.
- All code/runtime/cache/log/test data on D:. User allows plugin installation on C:, but prefer D: and never modify unrelated/system files. Existing image-generation new-file permission is retained.
- Preserve real Git history, visible prompts, failed scientific results and genuine corrections; no fabricated human dialogue.

## Delivered and tested

1. Complete approved plan, architecture, numerical/data contract, scientific/visual/interaction acceptance and JSON schema.
2. Strict immutable physical configuration with canonical SHA256; meaningful size/resource/source guards.
3. Shared true3D ridge/slab/sidewall geometry and material sampling in micrometres.
4. Original full-vector staggered-Yee FDFD Maxwell solver; exterior tensor PML; raw complex E, reconstructed H, display samples, physical probes, signed flux diagnostics.
5. Independent analytic manufactured-cavity and discrete infinite-guide reference benchmarks, mesh/PML tests, transparent failed real-ridge accuracy checks.
6. SQLite experiment snapshots; one disposable worker per job; bounded queue; durable SSE replay; restart interruption recovery; cancellation/timeout/RSS guard; integrity-checked artifacts, probes and ZIP export.
7. Command-line solve/validate/schema/benchmarks/serve; locked32-package Windows Python3.12 dependency closure and D: bootstrap scripts.
8. Self-contained interactive actual-data diagnostics: rotate3D isosurfaces, select Re(Ey)/amplitude, move actual z-sample slices; original imagegen concept artwork separately labelled illustrative.
9. Actual evidence, screenshot, visible-history snapshot excluding private reasoning and secrets; snapshots may have upstream/tool truncation and are not represented as three complete human debugging chains.

## Actual scientific evidence and limits

Current report: evidence/005-scientific-rerun.json from .runtime/science-final-rerun/verification.json. Earlier004 is retained historical development evidence; use005 for current code.

- Manufactured cavity4/8/12 cells/axis: relative electric errors0.00664819/0.00169627/0.000756763; measured order1.977994727. Errors agree with independently derived Yee eigenvalues, not only small residuals.
- Full3D homogeneous modal-line/open-x, transverse PEC analytic benchmark: PML.4/.8/1.6um field-reference errors0.3349%/0.2593%/0.2073%; reflected amplitude0.2445%/0.1892%/0.1515%; source/consistent staggered-flux mismatch around1e-15.
- These references do NOT equal Meep independent-solver validation, a calibrated dielectric-waveguide optical port, or a dual-band splitter.
- Actual fully open SiN ridge at coarse h=.2um still fails accuracy: fixed-physical-grid PML-doubling selected-field changes33.90% then12.20%; interpolated surface/source power discrepancy about9-10%. Stage2 must resolve interface/mesh/PML/flux and validate transport BEFORE publishing efficiency or optimizing the flagship on an untrustworthy objective.
- Source is arbitrary compact impressed current, explicitly uncalibrated. No S parameters/optical efficiency are provided.
- Interfaces use point material sampling; native probes use documented interpolation which can mix materials. No exact-continuum claim.
- Independent Meep3D, adjoint, constrained optimization, manufacturing robustness and polished product UI remain required downstream.
- NGSolve/OCC import was blocked by Windows application control4551. No system security settings changed. Implemented3D Yee/FDFD is a documented numerical-method adaptation; see IMPLEMENTATION_DECISIONS.md.

## Executed commands

Run from lightforge in PowerShell:
```powershell
. .\scripts\env.ps1
& '.\.venv\Scripts\python.exe' -m pytest tests -q
& '.\.venv\Scripts\python.exe' -m ruff check src tests scripts
& '.\.venv\Scripts\python.exe' -m lightforge.cli schema --output docs/schemas/experiment.schema.json
& '.\.venv\Scripts\python.exe' -m lightforge.cli validate examples/cavity.json
& '.\.venv\Scripts\python.exe' -m lightforge.cli benchmarks --output .runtime/science-final-rerun
& '.\.venv\Scripts\python.exe' -m lightforge.cli solve examples/cavity.json --output .runtime/cavity
& '.\.venv\Scripts\python.exe' -m lightforge.cli serve --port 4321
```
API docs are /docs; stage1 does not serve the finished website.

Whole suite **38 passed** (root latest6.58s), Ruff passed. Independent clean environment .runtime/repro-venv installed only lock closure and project --no-deps --no-build-isolation -e .:38 passed9.04s; schema/help/pipcheck passed; imports came from isolated environment; no NGSolve installed. Creation+install+checks86.916s using D: cache. See evidence/006-engineering-validation.md.

The standard full Python route uses python -m venv then pip lock install. Embedded Python route is scripts/setup.ps1 with D:/Dev/Python312/python.exe and project-local virtualenv21.15.6 bootstrap. pip freeze editable handling failed on the Unicode Git path; lock_environment.py uses importlib metadata dependency closure instead. One Starlette/httpx deprecation warning remains, no failing test.

Root actual Chromium check loaded4 figures/3WebGL canvases/2slice sliders; clicked Re(Ey), then moved slice index4 to8, visible trace z=.8um. Zero page errors/external scripts/desktop overflow. Diagnostic script is scripts/render_diagnostics.py; browser replay scripts/verify_diagnostics.cjs uses parent's existing Playwright/browser runtime. Current generated diagnostic .runtime/diagnostics/field-diagnostics.html is inspectable locally. It is not the final workbench.

## Numerical/API extension contract

Read docs/CONTRACTS.md and source.
- ExperimentSpec immutable/frozen schema_version1; unknown/nonfinite rejected; name participates in hash.
- geometry.build_scene/material_at/epsilon_at define the same model.
- solver.assemble returns MaxwellSystem(matrix,rhs,grid,epsilon_edges,mu_inverse_faces,exact/current vectors); grid exposes axes,curl,free edges and component placements. Build adjoint from this discrete system and proper conjugates; do not differentiate rendered textures.
- solve writes spec.json,scene.json,result.json,coefficients.npy,grid.npz,fields.h5. Manifest scientific allowlist excludes logs/input staging.
- Native E is staggered raw edges; H uses transformed inverse-mu and impedance. HDF5 display shape(nx,ny,nz,3), real/imag datasets and material IDs; metadata declares units and coordinates. Probe verifies saved-grid identity.
- API /api/schema, /api/health, POST/GET experiments, POST experiment runs, GET run, POST cancel, SSE events with Last-Event-ID, probe, field, artifacts, export; JSON spec import only. No untrusted ZIP import.
- Job RSS polling6GiB default and180s default are resource guards; configure larger justified budgets, not silent unbounded resources. No hard memory sandbox claim. Single worker ensures serialized numerical load. Pause/checkpoint optimizer is Stage2.
- Coordinate conventions: right-handedx/y,zthickness; um; exp(-iomega t); E V/m,H A/m,Poynting W/m2. Display-only scene manipulations never alter physical parameters.

## Mandatory next stage

Stage2 completes calibrated optical transport, verified full3D adjoint/parameter derivatives, design/filter/projection and MMA constraints, dual-band flagship, independent final geometry checks, actual3D process perturbations, robust objectives and held-out assessment, independent3D validation. Treat ridge gap as prerequisite, not an optional quality reduction. Add actual interaction-ready command/API contracts for gradient perturbation, optimization control/history/branch and process sliders.

Preserve the mandatory interactive acceptance docs/INTERACTION_ACCEPTANCE.md:38 operations and8 real E2E workflows. Static pictures, exported reports and prerecorded results cannot substitute editable/recomputable experiments. Stage3 implements polished React/Three.js linked workbench, educational flow, AI, full integration, portable release and competition evidence. Video/PDF production remains deferred.

If changing schema/numerical layout, version it, migrate existing valid samples or explicitly require recomputation. Tests may not silently accept old-field/new-geometry mismatch.

## Git and evidence

Stage1 incremental commits so far:
- dce3d41 approved plan/serial contract.
- e6d426f immutable inputs/environment.
- 1b64be2 shared3D geometry.
- 1833152 actual Maxwell/benchmarks.
- f70bcf2 jobs/API/lock/integration.
- 43763f5 actual-data interactive diagnostic/assets/interaction acceptance.

The final documentation/handoff commit containing this file seals Stage1; sender supplies its exact SHA in the READY message. Verify local HEAD against remote before continuing. No history rewrite or initial-all-features commit.

SEQUENCE.json records serial state. Stage2 updates its state after receiving the READY message, then owns all mutations until its own completed handoff.
