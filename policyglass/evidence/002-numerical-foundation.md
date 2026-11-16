# Actual numerical foundation validation

Date: 2026-11-16. Command: `. .\scripts\Environment.ps1; .\.venv\Scripts\python.exe -m pytest -q --tb=short` (semicolon here describes two commands, not a shell reproduction requirement).

Observed result: **26 passed in 1.31s**, CPython3.12.7, CPU torch2.8.0+cpu, NumPy2.2.6, canonical MuJoCo WASM4.0.1, Node24.22.1. This is Stage1 numerical/persistence testing, not final frontend or trained-policy evaluation.

Independent checks include NumPy MLP chain rule, torch.optim.Adam agreement, finite differences of transformed policy and SAC actor-through-critic path, GAE truncation handling, PPO positive/negative clipping branches, trace on/off equality and per-sample gradient sums, resumed real-environment updates, checksummed pickle-free bundle integrity, real Q/loss slice evaluation, analytic spatial-arm FK and physical-state restore.

Real failures and fixes retained in native tool history:
- Embedded D: Python ignored PYTHONPATH during initial virtualenv bootstrap. Explicit sys.path setup enabled D:-only environment creation.
- Native MuJoCo Windows wheels hit DLL initialization/access-violation/application-control errors. Version probes did not yield a dependable native engine. An optional-plugin exclusion probe in the ignored D: environment did not solve native model construction and is not part of the final runtime. No system DLL or C: file was changed.
- Official current @mujoco/mujoco4.0.1 WASM ran under existing Node without loading those native binaries. Product keeps actual MuJoCo dynamics. Python MuJoCo wheel removed from the isolated D: environment; WASM dependency locked in physics/pnpm-lock.yaml.
- Current WASM DoubleBuffer constructor and mj_getState signature differ from the initially assumed pointer/array usage. Adjusted to the shipped typed binding; snapshot/restore tests now pass.
- Retained activation gradients can accumulate during per-sample autograd queries. Clear the retained intermediate gradients before the actual batch backward; independently checked against NumPy.

These are actual technical observations, not simulated human feedback. The native-engine root cause was not exhaustively diagnosed; application-control errors are observed, not a claim that all versions fail on all Windows computers.

Public full current-turn dialogue export is maintained by scripts/export_dialogue.py; private native original stays ignored. Three complete human-guided prompt chains are not claimed by this test report.

