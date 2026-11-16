"""Check every published learned state can safely reload and actually update once."""

import argparse
import hashlib
import json
import platform
import time
from pathlib import Path

import torch

from policyglass.agents import Learner
from policyglass.checkpoint import decode

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    path = Path(args.output).resolve()
    if path.drive.upper() != "D:":
        raise ValueError("Evidence must stay on D:")
    document = json.loads(
        (ROOT / "evidence/025-stage3-study-results.json").read_text(encoding="utf-8")
    )
    rows, started = [], time.perf_counter()
    for source in document["runs"]:
        item = ROOT / f".runtime/stage3-study/{source['condition']}-{source['seed']}/final.pgz"
        blob = item.read_bytes()
        if hashlib.sha256(blob).hexdigest() != source["checkpoint_sha256"]:
            raise ValueError("Changed study checkpoint")
        state, _ = decode(blob)
        learner = Learner.from_state(state)
        try:
            before = {
                name: {key: value.detach().clone() for key, value in model.named_parameters()}
                for name, model in learner.models.items()
            }
            if learner.config.algorithm == "ppo":
                learner.update_ppo(learner.last_batch, record=False)
            else:
                learner.update_sac(learner.last_batch, record=False)
            after = learner.state()
            if after["updates"] != state["updates"] + 1 or after["env_steps"] != state["env_steps"]:
                raise ValueError("Fixed-batch update counters inconsistent")
            for model in learner.models.values():
                if any(not torch.isfinite(p).all() for p in model.parameters()):
                    raise ValueError("Nonfinite parameter after real update")
            rows.append(
                {
                    "condition": source["condition"],
                    "seed": source["seed"],
                    "source_sha256": source["checkpoint_sha256"],
                    "env_steps": learner.env_steps,
                    "before_updates": state["updates"],
                    "after_updates": learner.updates,
                    "max_parameter_change": max(
                        float((p.detach() - before[name][key]).abs().max())
                        for name, model in learner.models.items()
                        for key, p in model.named_parameters()
                    ),
                    "status": "passed",
                }
            )
        finally:
            learner.env.close()
    report = {
        "schema": "policyglass.all-learned-state-check.v1",
        "status": "passed",
        "rows": rows,
        "torch": torch.__version__,
        "platform": platform.platform(),
        "seconds": time.perf_counter() - started,
        "scope": "All 20 actual learned checkpoints hash-verified, safe reloaded and given one real fixed-batch counterfactual update. Sources untouched; not new on-policy training or an independent formula proof.",
    }
    path.write_text(json.dumps(report, indent=2, allow_nan=False), encoding="utf-8")
    print(json.dumps({"cases": len(rows), "status": "passed", "seconds": report["seconds"]}))


if __name__ == "__main__":
    main()
