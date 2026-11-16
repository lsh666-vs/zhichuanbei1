"""Rebuild tables and scientific figures from all preregistered runs, never best-seed filtering."""

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / ".runtime/analysis-libs"))
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np


def describe(values):
    return {
        "median": float(np.median(values)),
        "q25": float(np.quantile(values, 0.25)),
        "q75": float(np.quantile(values, 0.75)),
        "min": float(min(values)),
        "max": float(max(values)),
    }


def metric(row, key="mean_distance_m"):
    return float(np.mean([r[key] for r in row["evaluation"]]))


def main():
    protocol = json.loads((ROOT / "docs/STAGE3_STUDY.json").read_text(encoding="utf-8"))
    runs = []
    for condition in protocol["conditions"]:
        for seed in protocol["training_seeds"]:
            path = ROOT / f".runtime/stage3-study/{condition['name']}-{seed}/result.json"
            if not path.exists():
                raise ValueError(f"Missing preregistered run: {path.name} in {path.parent.name}")
            row = json.loads(path.read_text(encoding="utf-8"))
            if row["seed"] != seed or row["condition"] != condition["name"] or row["pilot"]:
                raise ValueError("Study row provenance mismatch")
            if row["status"] == "completed":
                blob = path.with_name("final.pgz").read_bytes()
                if hashlib.sha256(blob).hexdigest() != row["checkpoint_sha256"]:
                    raise ValueError("Study checkpoint hash mismatch")
            runs.append(row)
    summary = {}
    for condition in protocol["conditions"]:
        rows = [r for r in runs if r["condition"] == condition["name"]]
        completed = [r for r in rows if r["status"] == "completed"]
        summary[condition["name"]] = {
            "registered": len(rows),
            "completed": len(completed),
            "failures": [r for r in rows if r["status"] != "completed"],
            "per_seed": [
                {
                    "seed": r["seed"],
                    "env_steps": r["env_steps"],
                    "updates": r["updates"],
                    "seconds": r["seconds"],
                    "initial_mean_distance_m": metric(r["curve"][0]),
                    **{
                        key: metric(r["curve"][-1], key)
                        for key in (
                            "mean_distance_m",
                            "last32_distance_m",
                            "return",
                            "success_fraction",
                        )
                    },
                }
                for r in completed
            ],
        }
        for key in (
            "mean_distance_m",
            "last32_distance_m",
            "return",
            "success_fraction",
            "seconds",
        ):
            values = [r[key] for r in summary[condition["name"]]["per_seed"]]
            if values:
                summary[condition["name"]][key] = describe(values)
    paired = {}
    for label, left, right, steps in [
        ("sac_reuse4_minus_reuse1", "sac_reuse1", "sac_reuse4", 16384),
        ("ppo_large_minus_reference", "ppo_reference", "ppo_large_step", 8192),
    ]:
        values = []
        for seed in protocol["training_seeds"]:
            rows = [
                next(r for r in runs if r["seed"] == seed and r["condition"] == name)
                for name in (left, right)
            ]
            points = [next((p for p in r["curve"] if p["env_steps"] == steps), None) for r in rows]
            if all(points):
                values.append(
                    {
                        "seed": seed,
                        "right_minus_left_mean_distance_m": metric(points[1]) - metric(points[0]),
                    }
                )
        paired[label] = {
            "env_steps": steps,
            "rows": values,
            "interpretation": "negative favors right condition; paired training seeds, descriptive only",
        }
    document = {
        "schema": "policyglass.study-results.v1",
        "protocol": protocol,
        "runs": runs,
        "summary": summary,
        "paired": paired,
        "analysis_runtime": {"matplotlib": matplotlib.__version__, "numpy": np.__version__},
        "limitations": [
            "Fixed target and five held-out initial-state seeds; no new-target or real-hardware claim.",
            "Five training seeds are the descriptive replication unit; 25 evaluation episodes are not 25 independent trained policies.",
            "Training ran with two single-threaded learners initially and concurrent build/test work; wall times are observed inclusive times, not isolated algorithm speed benchmarks.",
            "Sources changed during long process lifetime only in import budget, trace derivative labels and temperature validation. Learner formulas unchanged. See deterministic fresh-process rerun evidence; per-run Git labels alone do not identify all loaded modules.",
            "No p-values, confidence intervals or educational efficacy are inferred. All preregistered runs retained.",
        ],
    }
    output = ROOT / "evidence/025-stage3-study-results.json"
    output.write_text(
        json.dumps(document, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8"
    )
    fig, axes = plt.subplots(2, 2, figsize=(12, 8), sharey=True, constrained_layout=True)
    colors = ["#117d76", "#cc653e", "#4178b9", "#7857a6"]
    for ax, condition, color in zip(axes.flat, protocol["conditions"], colors):
        rows = [r for r in runs if r["condition"] == condition["name"]]
        completed = [r for r in rows if r["status"] == "completed"]
        for r in rows:
            ax.plot(
                [p["env_steps"] for p in r["curve"]],
                [metric(p) for p in r["curve"]],
                color=color,
                alpha=0.35,
                lw=1,
                label=f"seed {r['seed']} ({r['status']})",
            )
        if len(completed) == len(rows):
            x = [p["env_steps"] for p in rows[0]["curve"]]
            y = np.array([[metric(p) for p in r["curve"]] for r in rows])
            ax.plot(x, np.median(y, axis=0), color=color, lw=2.5, label="median, all five seeds")
            ax.fill_between(
                x,
                np.quantile(y, 0.25, axis=0),
                np.quantile(y, 0.75, axis=0),
                color=color,
                alpha=0.12,
                label="IQR across training seeds",
            )
        ax.axhline(0.04, color="#555555", ls="--", lw=0.8, label="0.04m per-step threshold")
        ax.set(
            title=condition["name"],
            xlabel="training environment interactions",
            ylabel="episode mean distance (m)",
            ylim=(0, 1.1),
        )
        ax.grid(alpha=0.18)
        ax.legend(fontsize=6, loc="upper right")
    fig.suptitle(
        "Actual fixed-target learning: all preregistered seeds\nFrozen mean-action evaluation; five initial-state seeds per point. No efficacy/generalization claim.",
        fontsize=11,
    )
    figures = ROOT / "evidence/stage3-figures"
    figures.mkdir(exist_ok=True)
    fig.savefig(figures / "all-seed-learning.png", dpi=170)
    fig.savefig(figures / "all-seed-learning.svg")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
