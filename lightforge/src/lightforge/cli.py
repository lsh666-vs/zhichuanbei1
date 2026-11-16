"""Reproducible entry points shared by validation, local API and later product UI."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .models import ExperimentSpec


def main():
    parser = argparse.ArgumentParser(prog="lightforge")
    sub = parser.add_subparsers(dest="command", required=True)
    for action in ["validate", "solve"]:
        item = sub.add_parser(action)
        item.add_argument("spec", type=Path)
        if action == "solve":
            item.add_argument("--output", required=True, type=Path)
    schema = sub.add_parser("schema")
    schema.add_argument("--output", type=Path)
    benchmark = sub.add_parser("benchmarks")
    benchmark.add_argument("--output", type=Path, required=True)
    serve = sub.add_parser("serve")
    serve.add_argument("--port", type=int, default=4321)
    serve.add_argument("--data-dir", type=Path)
    serve.add_argument("--timeout-seconds", type=int, default=180)
    args = parser.parse_args()
    if args.command == "benchmarks":
        from .benchmarks import validate_benchmarks

        report = validate_benchmarks(args.output)
        print(
            json.dumps(
                {
                    "manufactured_pass": report["manufactured_pass"],
                    "open_modal_reference_pass": report["open_modal_reference_pass"],
                    "ridge_pml_converged": report["pml_converged_to_one_percent"],
                    "report": str(args.output / "verification.json"),
                }
            )
        )
    elif args.command == "schema":
        content = json.dumps(ExperimentSpec.model_json_schema(), ensure_ascii=False, indent=2)
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(content + "\n", encoding="utf-8")
        else:
            print(content)
    elif args.command == "serve":
        import uvicorn

        from .api import create_app

        uvicorn.run(
            create_app(args.data_dir, timeout_seconds=args.timeout_seconds),
            host="127.0.0.1",
            port=args.port,
        )
    else:
        spec = ExperimentSpec.model_validate_json(args.spec.read_text(encoding="utf-8"))
        if args.command == "validate":
            print(json.dumps({"valid": True, "spec_hash": spec.spec_hash}))
        else:
            from .solver import solve

            result = solve(
                spec,
                args.output,
                progress=lambda s, p: print(json.dumps({"stage": s, "progress": p}), flush=True),
            )
            print(json.dumps(result, ensure_ascii=False, allow_nan=False, indent=2))


if __name__ == "__main__":
    main()
