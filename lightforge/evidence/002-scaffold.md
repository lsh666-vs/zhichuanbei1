# 002 — Foundation architecture and reproducibility scaffold

Date: 2026-11-16. This entry describes actual planning and environment work; numerical acceptance results are not yet asserted here.

The owner created the new `lightforge` project beneath the existing repository. The first new-direction commit contains the approved plan, new project contract and restart evidence. Stage 2 and Stage 3 were created as independent chats instructed to wait for explicit serial handoffs; their identities are recorded in `handoffs/SEQUENCE.json`.

The initial scaffold declared CPython 3.12, NGSolve 6.2.2608, NumPy/SciPy, FastAPI/Pydantic, HDF5 and development test tools. Windows application control subsequently rejected a required OpenCascade DLL. The owner retained machine policy and switched the primary numerical implementation to original full-vector three-dimensional staggered-Yee FDFD with SciPy sparse algebra; NGSolve is an optional dependency. NumPy 2.2.6, SciPy 1.15.3 and h5py 3.13.0 are pinned for the local runtime. Import success and scientific validation remain separate observed checks, recorded by their owners. Task-local PowerShell environment variables redirect caches, temporary files and runtime data to D:.

Observed setup issue: `D:/Dev/Python312/python.exe -m venv .venv` failed because that embedded runtime lacks `venv`. Installing a local virtualenv bootstrap and invoking it with an explicitly extended Python import path created the project `.venv`. The package installation and numerical validation receipts will be recorded by their actual owner after completion.

Architecture and scientific validation documents separate a solved discrete system from physical accuracy, a driven-field demonstration from calibrated optical transmission, and Stage 1 completion from the complete application. The visual brief binds meaningful 3D inspection/editing to real geometry and data and reserves generated raster art for illustration.

No test counts, passing scientific targets, user bug reports, fabricated conversation chains or model identities are inferred by this entry.
