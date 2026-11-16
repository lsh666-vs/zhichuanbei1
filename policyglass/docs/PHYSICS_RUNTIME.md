# Actual MuJoCo runtime

The approved design selected MuJoCo as the numerical source of physical motion. On this Windows host the native Python wheel failed at DLL/plugin loading or model construction. C: files, Windows security settings, drivers and global runtimes were not changed.

Production Stage1 uses **the canonical Google DeepMind @mujoco/mujoco4.0.1 single-threaded WebAssembly engine**, not an approximate animation. This is a supported source distribution with experimental platform/binding aspects; pinned binding behavior is therefore covered by actual tests. The two-layer bridge is original: `physics/host.mjs` exposes a bounded JSONL protocol, and `physics_host.py` manages a persistent local Node process. PPO/SAC and gradients stay in PyTorch. Engine outputs are double-precision world states; rendering remains Stage2.

Install the locked package under physics/ with pnpm; no native build or system installation. Full environment instructions are maintained in README. Snapshot uses mjSTATE_INTEGRATION, including warm start and applied forces, plus Python reward/episode/RNG state. Engine version is in snapshots and bundles; incompatible versions are rejected.

Official source: https://github.com/google-deepmind/mujoco/tree/main/wasm . The package author's work-in-progress/platform caveats are not hidden; scientific checks include independent FK, temporal refinement, energy behavior, and exact resumed transition equivalence.

Resource handling: one persistent host per Python process; independent worlds for each learner; explicit Embind `.delete()` for models/data/buffers; lock and sequence numbers for protocol serialization; timeout/error handling. A host crash fails the task rather than silently producing guessed motion. All project writes remain D:.

