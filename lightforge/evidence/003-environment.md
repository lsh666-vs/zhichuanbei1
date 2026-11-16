# 003 — Environment and physical input contract

2026-11-16, Stage 1. All environments/cache created in lightforge/.venv and .runtime on D:.

- Base Python 3.12.7 is an embedded installation with no stdlib venv module. The first `python -m venv` failed. Created an isolated environment using virtualenv installed into D: bootstrap, loaded via an explicit sys.path entry (the embedded executable ignores PYTHONPATH).
- Installed NGSolve6.2.2608, but actual import failed with Windows application-control WinError4551 in native OCC DLL loading. Latest NumPy's native random extension was also blocked. Security settings were not changed.
- Chose actual vector 3D Yee/FDFD sparse Maxwell solve as a documented implementation adaptation, not a 2D substitute. FEM remains optional pending a trusted native runtime. Numerical validation targets are unchanged; Stage2 must address any remaining baseline/optical-port gaps.
- Pinning NumPy2.2.6, SciPy1.15.3 and h5py3.13.0; actual import and tests must be checked before handoff.
- Added immutable Pydantic schema with units, physical fit, finite values, source/model compatibility, sample/mesh budgets, canonical configuration hash, and explicit cavity-resonance guard.
- First schema test run: 10 passed. Added two further regression cases after independent review found microscopic geometry and resonant-source issues; their later result will be recorded with the validation commit.

No end product or optical efficiency is claimed by this setup commit.
