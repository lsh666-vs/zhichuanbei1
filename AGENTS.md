# CounterLab development contract

## Filesystem and credentials
- Do not delete or modify any file on C:. All project files, dependency caches, temporary files, test profiles and runtimes must be written to D:.
- The user explicitly authorized ONLY newly generated image files under `C:/Users/MECHREVO/.codex/generated_images/` for the built-in image generator, followed by copying selected assets to this D: project. Do not delete or modify existing C: files. No other C: exception exists.
- Never commit API keys, SSH private keys, cookies, personal data or unredacted conversations. SSH configuration is outside this repository on D:.
- Install dependencies locally; do not modify global settings or system installations.

## Product and implementation
- Follow docs/DEVELOPMENT_PLAN.md. Build an original, local-first counterexample laboratory, not a fork or reskin of an existing application.
- Three domains: weighted/unweighted interval scheduling, 0-1 knapsack, nonnegative weighted graph routing.
- AI may propose typed contracts and explanations. Only deterministic execution and independently checked witnesses establish results.
- Never execute AI/user-generated JS, Python, shell or SQL. Interpret a bounded, validated strategy representation.
- Distinguish verified counterexample, finite exhaustive coverage, sampled-no-counterexample and incomplete search. Never claim a sampled result proves universal correctness.
- Every animation derives from real execution events. Shrinking must preserve validity and the original failure predicate.
- Preserve experiment versions, inputs, semantics, seeds, engine version and actual outputs for replay.

## Quality and history
- Keep changes modular and make truthful, incremental commits. Root agent owns git commits/pushes and shared package configuration.
- Record real development decisions and validation in evidence/; do not fabricate user conversations, bugs, reviews or test outcomes.
- Add meaningful tests for numerical semantics, reference agreement, shrinking, replay, API boundaries and end-to-end workflows.
- A worker is for responsiveness/resource management, not a security sandbox for arbitrary code.
- Use the user's requested image generation for high-quality original design reference and assets. Rebuild interactive parts as functional accessible components.
- Do not mark unimplemented or untested behavior complete. Report exact limits and evidence.

