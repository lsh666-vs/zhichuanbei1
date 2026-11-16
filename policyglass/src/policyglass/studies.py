"""Preregistered, real CPU training and controlled mechanism evidence. No web server."""

import argparse
import copy
import hashlib
import json
import platform
import subprocess
import time
from pathlib import Path

import numpy as np
import torch

from .agents import Learner
from .checkpoint import encode
from .config import ExperimentConfig
from .environment import SpatialArm
from .numerics import tensor

ROOT = Path(__file__).resolve().parents[2]


def write(path, document):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(document, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8"
    )
    temporary.replace(path)


def evaluate(learner, seeds, steps):
    """Separate world: evaluation cannot change learner physics, RNG, replay or counters."""
    env = SpatialArm(copy.deepcopy(learner.config.environment), 0)
    rows = []
    try:
        for seed in seeds:
            obs, _ = env.reset(seed=seed)
            distances, rewards = [], []
            for _ in range(steps):
                action = learner.act(tensor(obs), deterministic=True)[0][0].numpy()
                obs, reward, terminated, truncated, info = env.step(action)
                distances.append(info["distance_m"])
                rewards.append(reward)
                if terminated or truncated:
                    break
            rows.append(
                {
                    "seed": seed,
                    "steps": len(distances),
                    "return": sum(rewards),
                    "mean_distance_m": float(np.mean(distances)),
                    "final_distance_m": distances[-1],
                    "last32_distance_m": float(np.mean(distances[-32:])),
                    "success_fraction": float(np.mean(np.array(distances) < 0.04)),
                }
            )
    finally:
        env.close()
    return rows


def run(protocol, condition, seed, out, pilot=False):
    name = condition["name"]
    target = 512 if pilot else condition["environment_steps"]
    dest = out / f"{name}-{seed}"
    if (dest / "result.json").exists():
        raise ValueError(f"Refusing to overwrite existing run {dest}")
    cfg = ExperimentConfig(
        algorithm=condition["algorithm"],
        seed=seed,
        network={"hidden": protocol["network"]},
        ppo={**protocol["ppo"], "learning_rate": condition.get("learning_rate", 0.0003)},
        sac={**protocol["sac"], "updates_per_step": condition.get("updates_per_step", 1)},
    )
    started = time.perf_counter()
    result = {
        "condition": name,
        "seed": seed,
        "status": "running",
        "pilot": pilot,
        "config": cfg.model_dump(),
        "protocol_sha256": hashlib.sha256(
            (ROOT / "docs/STAGE3_STUDY.json").read_bytes()
        ).hexdigest(),
        "source_revision": subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
        ).strip(),
        "script_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "platform": platform.platform(),
        "python": platform.python_version(),
        "torch": torch.__version__,
        "mode": "cpu_float64_one_thread",
        "curve": [],
        "started_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    learner = None
    try:
        learner = Learner(cfg)
        next_eval = 0
        while learner.env_steps < target:
            if time.perf_counter() - started > 3600:
                raise TimeoutError("Preregistered 3600s per-run timeout")
            if learner.env_steps >= next_eval:
                row = {
                    "env_steps": learner.env_steps,
                    "updates": learner.updates,
                    "seconds": time.perf_counter() - started,
                    "evaluation": evaluate(
                        learner, protocol["evaluation_seeds"], protocol["evaluation_steps"]
                    ),
                }
                result["curve"].append(row)
                write(dest / "progress.json", result)
                print(
                    json.dumps(
                        {
                            "condition": name,
                            "seed": seed,
                            "step": learner.env_steps,
                            "seconds": round(row["seconds"], 2),
                            "distance": np.mean([r["mean_distance_m"] for r in row["evaluation"]]),
                        }
                    ),
                    flush=True,
                )
                next_eval += protocol["evaluation_interval"]
            outputs = learner.iteration(record=False)
            if any(
                not np.isfinite(v)
                for summary, _ in outputs
                for v in summary.values()
                if isinstance(v, (int, float))
            ):
                raise FloatingPointError("Non-finite training summary")
        final = {
            "env_steps": learner.env_steps,
            "updates": learner.updates,
            "seconds": time.perf_counter() - started,
            "evaluation": evaluate(
                learner, protocol["evaluation_seeds"], protocol["evaluation_steps"]
            ),
        }
        result["curve"].append(final)
        dest.mkdir(parents=True, exist_ok=True)
        blob = encode(learner.state())
        (dest / "final.pgz").write_bytes(blob)
        result.update(
            status="completed",
            checkpoint_sha256=hashlib.sha256(blob).hexdigest(),
            **{k: final[k] for k in ("env_steps", "updates")},
        )
    except Exception as exc:
        result.update(status="failed", error=f"{type(exc).__name__}: {exc}")
        if learner is not None:
            result.update(env_steps=learner.env_steps, updates=learner.updates)
    finally:
        if learner is not None:
            learner.env.close()
        result["seconds"] = time.perf_counter() - started
        write(dest / "result.json", result)
    print(
        json.dumps({k: result[k] for k in ("condition", "seed", "status", "seconds")}), flush=True
    )
    return result


def neuron_probe(protocol, out):
    rows = []
    for seed in protocol["training_seeds"]:
        learner = Learner(
            ExperimentConfig(
                algorithm="ppo", seed=seed, network={"hidden": [64, 64], "activation": "relu"}
            )
        )
        try:
            learner.collect_ppo(64)
            actor = learner.models["actor"]
            weight = actor.weights[0].detach().clone()
            bias = actor.biases[0].detach().clone()
            row = {
                "seed": seed,
                "intervention": "incoming weights of units0..7=0, biases=-100; fixed batch/noise; no optimizer step",
            }
            for label in ("original", "inactive", "restored"):
                with torch.no_grad():
                    actor.weights[0].copy_(weight)
                    actor.biases[0].copy_(bias)
                    if label == "inactive":
                        actor.weights[0][:8] = 0
                        actor.biases[0][:8] = -100
                actor.zero_grad(set_to_none=True)
                loss = learner.ppo_objective(learner.last_batch)[0].mean()
                loss.backward()
                with torch.no_grad():
                    z = (
                        learner.encode_observation(learner.last_batch["obs"]) @ actor.weights[0].T
                        + actor.biases[0]
                    )
                    row[label] = {
                        "loss": float(loss.detach()),
                        "activation_mean_abs": float(z.relu()[:, :8].abs().mean()),
                        "incoming_gradient_l2": float(actor.weights[0].grad[:8].norm()),
                        "bias_gradient_l2": float(actor.biases[0].grad[:8].norm()),
                    }
            rows.append(row)
        finally:
            learner.env.close()
    write(
        out / "neuron-probe.json",
        {
            "scope": "controlled induced ReLU inactivity, no natural-dormancy or recovery-training claim",
            "rows": rows,
        },
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--condition",
        choices=["ppo_reference", "ppo_large_step", "sac_reuse1", "sac_reuse4", "all", "neurons"],
        default="all",
    )
    parser.add_argument("--seed", type=int)
    parser.add_argument("--pilot", action="store_true")
    parser.add_argument("--output", default=".runtime/stage3-study")
    args = parser.parse_args()
    out = Path(args.output).resolve()
    if out.drive.upper() != "D:":
        raise ValueError("Studies must write only to D:")
    protocol = json.loads((ROOT / "docs/STAGE3_STUDY.json").read_text(encoding="utf-8"))
    if args.condition == "neurons":
        neuron_probe(protocol, out)
        return
    for condition in protocol["conditions"]:
        if args.condition not in ("all", condition["name"]):
            continue
        for seed in (
            [999]
            if args.pilot
            else ([args.seed] if args.seed is not None else protocol["training_seeds"])
        ):
            if not args.pilot and seed not in protocol["training_seeds"]:
                raise ValueError("Unregistered seed")
            run(protocol, condition, seed, out, args.pilot)


if __name__ == "__main__":
    main()
