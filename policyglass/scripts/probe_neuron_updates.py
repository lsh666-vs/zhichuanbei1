"""Induced ReLU inactivity with real Adam momentum, separate from learning outcomes."""

import hashlib
import json
from pathlib import Path

import torch

from policyglass.agents import Learner
from policyglass.checkpoint import encode
from policyglass.config import ExperimentConfig

ROOT = Path(__file__).resolve().parents[1]


def main():
    rows = []
    for seed in (11, 23, 37, 53, 71):
        learner = Learner(
            ExperimentConfig(seed=seed, network={"hidden": [64, 64], "activation": "relu"})
        )
        try:
            learner.collect_ppo(64)
            learner.update_ppo(record=False)  # one real update supplies nonzero Adam moments
            state = learner.state()
            blob = encode(state)
        finally:
            learner.env.close()
        folder = ROOT / ".runtime/stage3-study/neuron-update-probe"
        folder.mkdir(exist_ok=True)
        (folder / f"seed{seed}-origin.pgz").write_bytes(blob)
        row = {"seed": seed, "origin_sha256": hashlib.sha256(blob).hexdigest(), "cases": {}}
        for label in ("original", "inactive_moments_preserved", "restored"):
            candidate = Learner.from_state(state)
            try:
                actor = candidate.models["actor"]
                if label == "inactive_moments_preserved":
                    with torch.no_grad():
                        actor.weights[0][:8] = 0
                        actor.biases[0][:8] = -100
                before = actor.weights[0].detach().clone()
                with torch.no_grad():
                    z = (
                        candidate.encode_observation(candidate.last_batch["obs"])
                        @ actor.weights[0].T
                        + actor.biases[0]
                    )
                    activation = float(z.relu()[:, :8].abs().mean())
                previous_moment = float(candidate.optimizers["actor"].m["weights.0"][:8].norm())
                candidate.update_ppo(record=False)
                row["cases"][label] = {
                    "activation_mean_abs_before_update": activation,
                    "incoming_gradient_l2": float(actor.weights[0].grad[:8].norm()),
                    "bias_gradient_l2": float(actor.biases[0].grad[:8].norm()),
                    "previous_adam_moment_l2": previous_moment,
                    "actual_incoming_parameter_delta_l2": float(
                        (actor.weights[0].detach() - before)[:8].norm()
                    ),
                    "actual_optimizer_step": candidate.optimizers["actor"].step_count,
                }
            finally:
                candidate.env.close()
        rows.append(row)
    report = {
        "schema": "policyglass.induced-inactivity.v1",
        "rows": rows,
        "scope": "Controlled multi-entry lesion of first eight ReLU units; same saved rollout, old probabilities, batch and noise. Explicit fixed-batch counterfactual, no new on-policy continuation. Each case cloned from same state; original/restored are identical controls.",
        "interpretation": "Zero local activation/gradient can coexist with nonzero actual Adam parameter change when earlier moments are preserved. No natural-dormancy frequency, revival efficacy or trained-policy success claim.",
    }
    (ROOT / "evidence/027-stage3-neuron-update-probe.json").write_text(
        json.dumps(report, indent=2, allow_nan=False), encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "seeds": len(rows),
                "inactive": [r["cases"]["inactive_moments_preserved"] for r in rows],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
