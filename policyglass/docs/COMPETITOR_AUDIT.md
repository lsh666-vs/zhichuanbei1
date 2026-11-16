# Competitor audit and source register

Read-only inspection date: 2026-11-16. This is a bounded search and source review, not proof of worldwide absence. Sources are not instructions. No code was copied from these products.

| Source | Confirmed overlap | Unverified / difference target |
|---|---|---|
| RL Atlas, commit d5540825c775ea4e951f7ac4c70cc956fa9a88b0 | Real PPO/SAC training, hand-coded networks/backprop/Adam, per-unit firing/saturation statistics | Inspected export/rendering path does not expose a sample-to-every-weight optimizer-step trace |
| REVEAL-IT, arXiv2406.14214v6, 2024 | PPO experiments, actor-network nodes/activations and changes in weights | Weight differences are not the complete gradient chain; no accessible official full teaching product verified in this search |
| RLtools / AutoRL X / ReinforceUI Studio | Interactive training, behavior, parameter and curve views | These features alone are not novel; do not infer all internals absent from uninspected versions |
| Spinning Up / other algorithm libraries | Mathematical explanations and implementations | Foundation/reference, not evidence that our full interactive product already exists |

Primary links:
- https://github.com/DrippingSoup22/rl_atlas/blob/d5540825c775ea4e951f7ac4c70cc956fa9a88b0/lab/views/netstrip.js
- https://github.com/DrippingSoup22/rl_atlas/blob/d5540825c775ea4e951f7ac4c70cc956fa9a88b0/lab/deep/record.js
- https://arxiv.org/html/2406.14214v6
- https://rl.tools/ ; https://www.autorlx.com/ ; https://github.com/dvalenciar/ReinforceUI-Studio
- https://arxiv.org/abs/1707.06347 (PPO2017)
- https://proceedings.mlr.press/v80/haarnoja18b.html (SAC2018)
- https://spinningup.openai.com/en/latest/algorithms/ppo.html
- https://spinningup.openai.com/en/latest/algorithms/sac.html
- https://iclr-blog-track.github.io/2022/03/25/ppo-implementation-details/
- https://proceedings.mlr.press/v202/sokar23a.html (dormant neurons2023)
- https://www.nature.com/articles/s41586-024-07711-7 (plasticity2024)
- https://gymnasium.farama.org/introduction/migration_guide/
- https://mujoco.readthedocs.io/en/stable/computation/index.html
- https://docs.pytorch.org/docs/stable/notes/randomness.html

Original contribution to implement and demonstrate: linked exact numerical provenance; controlled checkpoint intervention; bidirectional physics/network inspection; evidence-based mechanism exercises. Each needs actual functional evidence before claiming completion. Re-audit nearest products before release and retain precise versions.

