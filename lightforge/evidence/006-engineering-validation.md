# Stage 1 engineering validation — 2026-11-16

This receipt records actual commands and observations, not proposed acceptance.

## Real API and process checks

`python -m pytest tests/test_api.py -q`: 6 passed. Actual disposable workers run the three-dimensional cavity solve. The tests create an immutable experiment, queue and poll a process, query original-grid probes, fetch sampled fields, export the result ZIP and detect a changed artifact. Negative cases include NaN/out-of-domain probes, oversized import, foreign Origin/Host, missing run, queue saturation, runtime log access and broken setup paths.

Independent review also ran a real running-job cancellation: cancelled terminal state persisted, subprocess reaped, queued/running/cancelled events retained. Forty concurrent run requests accepted exactly eight. No known outstanding P1 finding remained at the end of that review; this is not a universal correctness certificate.

## Observed defects and fixes

- Queue count, insertion and first event now share an immediate SQLite transaction. Terminal transitions are atomic and cannot regress from cancelled/completed to running/queued.
- Setup-time file errors are converted into failed-job records rather than killing the scheduler.
- Worker resident memory is polled with psutil and bounded wall time is enforced. RSS polling is a resource guard, not an OS memory sandbox or zero-overshoot hard cap.
- Immutable artifact checks exclude mutable worker logs and input staging files. Earlier inclusion of logs broke export hashes after the log buffer flushed.
- Anisotropic display arrays use an actual sample-count cap, not a cube-root estimate alone.
- SQLite connections close explicitly after transaction scopes.

## Independent clean environment

A second isolated environment at `.runtime/repro-venv` was created with CPython3.12.7; installed only the32-package `requirements-win-py312.lock` closure and project with `--no-deps --no-build-isolation -e .`. NGSolve was not installed. NumPy/SciPy/h5py import paths resolved inside this new environment.

- Entire test suite: **38 passed**, pytest9.04s (outer process10.086s).
- CLI `--help`: exit0.
- CLI `schema`: exit0, identical to `ExperimentSpec.model_json_schema()`.
- `pip check`: exit0, `No broken requirements found`.
- Environment creation1.431s; dependency install71.367s; project install2.316s; validation11.802s; total86.916s. D: cache was reused and some packages downloaded. This timing is not a network-independent guarantee.
- One Starlette/httpx deprecation warning remains; no failing test.

Raw local receipts: `.runtime/repro-install-timing.json`, `.runtime/repro-test-timing.json`, `.runtime/repro-junit.xml`, `.runtime/repro-schema.json`. Their paths are local artifacts, not claims they are tracked in Git.

Full scientific scope and failed ridge-convergence cases are recorded separately in `005-scientific-rerun.json` and `docs/science/STAGE_1_NUMERICS.md`. This stage contains no verified adjoint, optical splitter, robust optimum or finished 3D product UI.
