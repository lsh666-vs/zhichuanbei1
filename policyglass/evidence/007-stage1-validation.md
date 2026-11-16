# Stage1 actual acceptance

Verified implementation: `8d944e683ff2a00621af28a8611c1c5d9aa4e90e` (preceding the documentation-only handoff seal).

## Actual results

- Clean isolated environment created with `scripts/Setup.ps1 -VenvDirectory .runtime/repro-venv`, using D: caches. Elapsed **160.1052212s**, including some downloads and the cached619MB torch wheel. This is not a cold-network or final offline-package timing claim.
- CPython3.12.7; torch2.8.0+cpu; NumPy2.2.6; canonical MuJoCoWASM4.0.1; Node24.22.1; pnpm11.25.0. All project/dependency writes on D:.
- Final clean-environment test run: **48 passed, 1 non-failing third-party test-client deprecation warning, 10.45s**. JUnit in006. Independent numerical report in003. Actual TCP/uvicorn/spawned-worker workflow in004. `pip check`, Ruff check and format check passed.
- Actual reference64x64 iteration with full trace: PPO about0.090s, SAC about0.114s in the recorded run, excluding cold process startup and HTTP transfer. Full traces are about12MB; interface supports lightweight indices and on-demand event payloads.
- Independent sample-gradient reconstruction max absolute error: PPO4.44e-16; SAC1.78e-15. Adam reconstruction max absolute error1.09e-19. Following checkpoint roundtrip/resume, maximum parameter difference0 in the pinned environment.
- Independent spatial FK error1.67e-16m; damped kinetic energy decreases; timestep refinement reduces trajectory error. Analytic static gravity torque also matches the actual engine, and the default5Nm motor bound makes the target statically holdable.

## Additional actual fixes

- A hardcoded test originally edited a hidden bias rather than the output mean bias. The test now reads the output-layer index from configured depth; direct physical action change is verified, with parent unchanged.
- SAC sampled replay points now preserve their own original before/after physical states and reward decomposition, rather than displaying latest collection frames.
- PPO snapshots retain complete temporal rollout and actual shuffled minibatch indices. Gamma/lambda interventions recompute chronological GAE before selecting the same minibatch. Tail batches of size1 and exact trace-origin-to-output replay are verified.
- SAC configurable replay ratio performs real newly sampled updates, with actual environment/update counters.
- Duplicate server ownership is rejected before restart recovery can alter active tasks. Task manager operations are synchronized.
- Exported native dialogue JSONL uses explicit LF to avoid Windows CRLF diff-check noise; native original remains untouched on C: and retained privately on D:.

## Boundaries

Stage1 is a scientific foundation, not a finished graphical product, trained successful policy, final teaching-effect study or release. Eight lessons/four actual3D views are Stage2. Long-run evaluations, explanations, user feedback and offline packaging are Stage3. No human feedback, independent review or three complete human-guided development chains is fabricated.

The raw native original is ignored/private. Public dialogue is an exact role-preserving excerpt with recorded scope/redaction; coordinator-created successor prompts must not be relabeled as new human feedback. Existing genuine history remains intact.
