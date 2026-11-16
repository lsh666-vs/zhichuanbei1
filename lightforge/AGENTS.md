# LightForge development contract

This is the replacement competition project authorized on 2026-11-16. Parent CounterLab product rules are superseded here; retain its genuine Git history and evidence. Do not rewrite commits or fabricate conversation chains.

- Working directory: D:/传智杯1/counterlab/lightforge. All task caches, environments, logs and outputs stay on D:. User permits plugin installation on C: but prefer no C: writes; image generation has its existing new-file exception.
- Quality first. Four required capabilities: Maxwell equations, verified adjoint gradients, constrained optimization, manufacturing robustness. Real 3D geometry/fields/interaction must participate in the workflow.
- Three serial delivery stages: foundation; optimization/robustness; integrated 3D product/release. A downstream stage may start only after its predecessor's handoff is READY and a user-visible handoff message arrives. No concurrent downstream mutations.
- Stage 1 owns geometry, numerical forward model, schemas, persistence/jobs/API, scientific baselines, visual assets, and explicit handoff. Stage 2 owns adjoint, optimization and manufacturing robustness. Stage 3 owns polished interactive product, AI integration, end-to-end acceptance and packaging.
- Use independent, meaningful scientific checks. A residual alone does not prove physical accuracy. Label model scope, solver fidelity, normalization, units and evidence.
- All animations and quantitative visualizations derive from actual results. Geometry preview, 2D approximation and 3D computed fields must be explicitly distinguished.
- Never run generated code. Keep credentials out of Git, logs and exports. Validate imported configuration and resource budgets.
- Root owns commits and pushes. Each commit corresponds to a real module, core discussion or verified correction. Update evidence as work happens; do not invent feedback, bugs, approvals or test outcomes.
- Read docs/DEVELOPMENT_PLAN.md, docs/CONTRACTS.md and the current handoff before implementation. Preserve API compatibility or document migrations with tests.
