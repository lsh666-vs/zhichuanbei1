"""One scientific job in one disposable process. stdout carries bounded progress JSON."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from .models import ExperimentSpec


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--spec", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    spec = ExperimentSpec.model_validate_json(Path(args.spec).read_text(encoding="utf-8"))
    from .solver import solve

    def progress(stage, fraction):
        print(json.dumps({"stage": str(stage)[:120], "progress": float(fraction)}), flush=True)

    result = solve(spec, Path(args.output), progress=progress)
    result.update({"spec_hash": spec.spec_hash, "schema_version": 1})
    output = Path(args.output) / "result.json"
    temporary = output.with_suffix(".tmp")
    temporary.write_text(
        json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8"
    )
    os.replace(temporary, output)


if __name__ == "__main__":
    main()
