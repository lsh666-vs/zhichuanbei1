# Reproducibility and serial handoff

The scientific foundation is developed in `D:/传智杯1/counterlab/lightforge` within the existing Git repository. The complete application is built in three serial stages. This document records the reproduction policy; the stage handoff supplies the exact commands and results verified for that stage.

## Filesystem and environment

Run PowerShell from this project directory and load the task environment before installation, tests or calculations:

```powershell
. .\scripts\env.ps1
```

The script redirects task caches, temporary data, plotting configuration and numerical output to the project's ignored `.runtime` directory. The Python environment is `.venv`. Current development targets Windows x86-64 and CPython 3.12. The shipping numerical path is three-dimensional Yee FDFD with NumPy/SciPy; NGSolve is optional after Windows application control rejected a required OpenCascade DLL. NumPy 2.2.6, SciPy 1.15.3 and h5py 3.13.0 are pinned in `pyproject.toml`; actual import and execution receipts must accompany these pins. Final dependency versions must be recorded from the installed environment and committed as a lock/receipt; broad version ranges alone are not a reproducible environment.

Do not install into the system Python or alter a global configuration. The user permits additional plugin installation on C:, but the normal development and runtime path continues to use D:. Image generation may create new files in its explicitly allowed generated-image directory before copying selected assets into this repository.

## Setup routes

For a normal full CPython 3.12 installation, an isolated setup route is:

```powershell
. .\scripts\env.ps1
python -m venv .venv
& '.\.venv\Scripts\python.exe' -m pip install -e '.[dev]'
```

The existing `D:/Dev/Python312` runtime is an embedded distribution and does not include `venv`. The initial attempt `D:/Dev/Python312/python.exe -m venv .venv` failed with `No module named venv`; this is an observed environment limitation, not a solver failure. The owner created `.venv` using a project-local `virtualenv` bootstrap on D:. A bootstrap script or exact commands must accompany the stage handoff so a second developer does not need to reconstruct that workaround.

All commands above are setup guidance. Package installation, solver import and scientific runs count as verified only when their actual receipts are recorded. Do not copy an environment's machine-specific `pip freeze` entries blindly into a portable lock.

## Repeatable experiment package

An export must identify the exact specification, canonical hash, schema version, solver and dependency versions, material model, coordinates and units, boundary/source conditions, grid discretization, resource settings and numerical tolerance. Stochastic scenarios additionally preserve distribution, sample count, correlation assumptions and seed. Include native grid coordinates and edge degrees of freedom or an equivalent documented reproducible representation; display textures alone are insufficient.

Keep original complex values and record display sampling separately. Artifact checksums detect corruption and accidental replacement. Hashing a file establishes identity, not scientific validity. Locally generated numerical reload files must not become a route for accepting untrusted executable object serialization.

Platform-dependent floating-point differences mean cross-machine comparisons use declared numerical tolerances rather than a promise of byte-identical fields. Serialized configuration/hash identity should remain exact. Seeds must be recorded even when a deterministic benchmark does not use randomness.

## Validation routes

Three routes serve different review needs:

1. A small genuine 3D example for fast setup verification. This demonstrates that the runtime and numerical path work; it does not claim a fully optimized splitter.
2. A numerical baseline suite with analytic/manufactured reference, discretization refinement and original-field reload/probe checks.
3. Full-product verification: calibrated optical ports, adjoint checks, constrained/robust optimization and independent three-dimensional comparison. These are delivered by subsequent stages.

`docs/SCIENTIFIC_VALIDATION.md` specifies evidence required by each route. The command-line entry point is declared as `lightforge` in `pyproject.toml`. The Stage 1 CLI contract is the following; commands count as verified only when their receipts are present in the handoff:

```powershell
& '.\.venv\Scripts\python.exe' -m lightforge.cli schema
& '.\.venv\Scripts\python.exe' -m lightforge.cli solve examples/cavity.json --output .runtime/cavity
& '.\.venv\Scripts\python.exe' -m lightforge.cli validate examples/cavity.json
& '.\.venv\Scripts\python.exe' -m lightforge.cli benchmarks --output .runtime/validation
& '.\.venv\Scripts\python.exe' -m lightforge.cli serve --port 4321
```

Run `--help` against the installed version to inspect options. The cavity is a known-source numerical benchmark, not an optimized photonic splitter.

The final Windows portable package targets download/extract/start plus a small real 3D calculation within ten minutes on the documented reference machine. Complete high-accuracy inverse design and independent Meep verification have separately stated durations. A saved replay may be available for inspection, with a clear saved-result label.

## Developer and AI evolution record

Each Git commit corresponds to an actual core discussion, module implementation or verified fix. Record the rationale and tests while doing the work. Keep old project commits; a product change does not authorize history rewriting. The first new-direction commit contains the plan and contract, followed by incremental implementations.

For each important iteration, preserve the real user prompt, AI proposal, relevant change, observed issue, correction and verification when those events exist. Mark autonomous AI checks separately from human feedback. At least three complete genuine core Prompt chains are required by the supplied competition rules. A prose index is useful navigation but is not a substitute for the actual exported visible conversation.

Never include private reasoning, credentials, private keys or unredacted secrets in an evidence export. Do not invent a missing user correction or backdate development events. A missing/truncated original history remains a disclosed gap.

## Serial ownership

Stage 1 owns the forward foundation and records `handoffs/STAGE_1.md`. Stage 2 waits for an explicit READY message and that file before modifying the project. Stage 2 completes adjoint, optimization, fabrication robustness and scientific gaps, then writes `handoffs/STAGE_2.md` and sends the authorized handoff to Stage 3. Stage 3 completes the interactive application, integration and release.

Each handoff records exact Git commits, verified commands, test counts and outputs, numerical scope, artifacts/data shapes, dependency setup, known failures, outstanding requirements and the next owner. A READY handoff means ready for the next stage, not that the complete competition product has passed acceptance.

## Required submission materials

The supplied competition text requires a public/reviewer-accessible repository, fine-grained Git evolution, at least three complete genuine Prompt chains, environment/dependency/template instructions and a ten-minute reproduction path. It also requires a 5–8 minute 1080p MP4 with at least two minutes of AI-collaboration demonstration and a technical PDF of at most thirty pages.

The user has deferred video and PDF production. During development retain screenshots, genuine command receipts, explanatory figures, architecture and demonstration notes so those materials can be prepared later. Deferred production does not mean the final submission requirement has disappeared.
