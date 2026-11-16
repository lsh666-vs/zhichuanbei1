"""Stage1 reproducible entry points; no GUI success claim."""

import argparse
import json
import multiprocessing
from pathlib import Path

from .agents import Learner
from .checkpoint import encode
from .config import ExperimentConfig
from .experiments import loss_slice, q_slice
from .science import audit_trace, report


def output_path(value):
    path = Path(value).resolve()
    if path.drive.upper() == "C:":
        raise ValueError("Output must not be on C:")
    return path


def main():
    multiprocessing.freeze_support()
    parser = argparse.ArgumentParser(description="PolicyGlass actual PPO/SAC numerical laboratory")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("schema")
    science = sub.add_parser("verify")
    science.add_argument("--output", default=".runtime/science-report.json")
    demo = sub.add_parser("demo")
    demo.add_argument("--output", default=".runtime/demo")
    server = sub.add_parser("serve")
    server.add_argument("--port", type=int, default=8787)
    server.add_argument("--data", default=".runtime/data")
    args = parser.parse_args()
    if args.command == "schema":
        print(json.dumps(ExperimentConfig.model_json_schema(), ensure_ascii=False, indent=2))
    elif args.command == "verify":
        result = report()
        path = output_path(args.output)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(result, indent=2, allow_nan=False), encoding="utf-8")
        print(json.dumps(result, indent=2, allow_nan=False))
    elif args.command == "demo":
        folder = output_path(args.output)
        folder.mkdir(parents=True, exist_ok=True)
        summary = {}
        for algorithm in ("ppo", "sac"):
            learner = Learner(ExperimentConfig(algorithm=algorithm))
            outputs = learner.iteration(record=True)
            trace = next(trace for _, trace in outputs if trace is not None)
            (folder / f"{algorithm}.origin.pgz").write_bytes(encode(learner.trace_origin_state))
            (folder / f"{algorithm}.output.pgz").write_bytes(encode(learner.trace_result_state))
            (folder / f"{algorithm}.current.pgz").write_bytes(encode(learner.state()))
            (folder / f"{algorithm}.trace.json").write_text(
                json.dumps(trace, allow_nan=False), encoding="utf-8"
            )
            surface = loss_slice(
                learner, "actor/biases.2", [0], "actor/biases.2", [1], resolution=11
            )
            (folder / f"{algorithm}.loss-slice.json").write_text(
                json.dumps(surface), encoding="utf-8"
            )
            if algorithm == "sac":
                (folder / "sac.q-slice.json").write_text(
                    json.dumps(q_slice(learner)), encoding="utf-8"
                )
            summary[algorithm] = {
                "updates": learner.updates,
                "env_steps": learner.env_steps,
                "trace_events": len(trace["events"]),
                "audit": audit_trace(trace),
            }
            learner.env.close()
        (folder / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
        print(json.dumps(summary, indent=2))
    else:
        import uvicorn

        from .api import create_app

        uvicorn.run(create_app(output_path(args.data)), host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()
