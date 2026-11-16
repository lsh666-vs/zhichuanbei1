# Stage2 development record (in progress)

Stage1 READY plus coordinator completion arrived before mutations. Reviewed scientific, development, HTTP and physics contracts and exact commits 8d944e6 / 3509ad2. Independently reran all 48 tests (16.19s), verify and demo. `009-stage2-science-review.json` is the actual new report, not the predecessor's copied results.

Implemented the React/TypeScript/R3F workbench, four data-driven 3D scenes, source-bound on-demand event/tensor inspector, optimizer/gradient inspection, eight course workflows, forward input experiments, full-state branches, physical interventions, persistent notebooks, `.pgwork` checkpoint/notebook envelopes and raw `.pgz` support. Training stays in the Python kernel. Scientific plots and motion use engine outputs.

Actual issues encountered and corrected:

- pnpm initially found the parent workspace and installed nothing. Created a project-local workspace and D: store; pinned packages and enabled only esbuild's required install script.
- First Chromium download reset the connection; automatic fallback succeeded, entirely in D: `.runtime/browsers`. Early E2E attempts before browser installation finished failed to launch; no UI success was claimed.
- Vitest initially collected Playwright files. Restricted it to `*.test.ts`.
- The new reopen test exposed FileLock ownership crossing API factory/lifespan threads. Used process-wide lock context; the new close/reopen test passes, while exclusive ownership remains enforced.
- Native form constraints rejected the valid default learning rate because min and step had incompatible offsets. Decimal controls now accept any finite step and defer semantic bounds to the server.
- A running API process still had the previous config schema while spawned workers read the newly added mass field. Restarted the owned service; documented schema changes require a matching server restart.
- Switching R3F Html portals under React's strict lifecycle caused `removeChild` errors. Replaced DOM-root labels with disposed CanvasTexture sprites and kept the WebGL context stable. Camera pose is explicitly reset per view.
- A tiny nonzero policy loss was correctly displayed in scientific notation; corrected an E2E assertion that had incorrectly expected fixed-decimal zero.
- Replayed minibatch rows are shuffled/nonchronological. Draw only recorded before→after segments, never a fabricated line connecting sampled rows.

Initial real service browser suite passed both tests in 25.7s (see `008-stage2-initial-e2e.json`). PPO: create→train→actual layer values→loss slice→branch→fixed batch→note→export→close/import→identical optimizer tensors after recompute. SAC: grid points matched actual API values, actor-path selection, eight course controls, 390px no-overflow layout, no page errors. Initial screenshots are real captures in `stage2-ui/`; final checks will supersede this initial checkpoint.

No learner feedback, pedagogical efficacy, long-run policy success or independent review is claimed. Coordinator handoffs are not human feedback. Runtime artifacts stay ignored on D:; only scoped evidence is tracked. C: was not modified or deleted.
