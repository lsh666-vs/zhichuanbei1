"""Compare complete resumed states across two isolated Torch runtimes.

The coordinator launches two numerical workers and then a third read-only
comparator. Safetensors/JSON states are compared, not versioned ZIP manifests.
No training starts from scratch; each worker resumes the same self-produced
PPO/SAC final checkpoint for three fixed-batch updates then three collections.
"""

import argparse
import hashlib
import importlib.metadata
import json
import os
import platform
import struct
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ATOL, RTOL = 1e-8, 1e-6
SOURCES = {"ppo": "ppo_reference-11", "sac": "sac_reuse1-11"}


def d_path(value):
    path = Path(value).resolve()
    if path.drive.upper() != "D:":
        raise ValueError("All runtime comparison paths must remain on D:")
    return path


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write(path, value):
    path = d_path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False), "utf-8")


def source_hashes():
    files = [*sorted((ROOT / "src/policyglass").glob("*.py")), Path(__file__).resolve()]
    return {str(path.relative_to(ROOT)).replace("\\", "/"): digest(path) for path in files}


def worker(output):
    import numpy as np
    import torch

    from policyglass.agents import Learner
    from policyglass.checkpoint import decode, encode

    output.mkdir(parents=True, exist_ok=False)
    started = time.perf_counter()
    hashes_before = source_hashes()
    document = {
        "python": platform.python_version(),
        "torch": torch.__version__,
        "numpy": np.__version__,
        "setuptools": importlib.metadata.version("setuptools"),
        "platform": platform.platform(),
        "mode": "CPU float64, one Torch thread, same persisted RNG/noise/batch/physics",
        "source_hashes_before": hashes_before,
        "algorithms": {},
    }
    for algorithm, folder in SOURCES.items():
        path = d_path(ROOT / ".runtime/stage3-study" / folder / "final.pgz")
        blob = path.read_bytes()
        state, source_manifest = decode(blob)
        learner = Learner.from_state(state)
        snapshots = []

        def save(label, algorithm=algorithm, learner=learner, snapshots=snapshots):
            checkpoint = output / f"{algorithm}-{label}.pgz"
            checkpoint.write_bytes(encode(learner.state()))
            snapshots.append(
                {
                    "stage": label,
                    "filename": checkpoint.name,
                    "sha256": digest(checkpoint),
                    "env_steps": learner.env_steps,
                    "updates": learner.updates,
                }
            )

        try:
            save("loaded")
            for index in range(1, 4):
                if algorithm == "ppo":
                    learner.update_ppo(learner.last_batch, record=False)
                else:
                    learner.update_sac(learner.last_batch, record=False)
                save(f"fixed_batch_{index}")
            for index in range(1, 4):
                learner.iteration(record=False)
                save(f"fresh_collection_{index}")
            document["algorithms"][algorithm] = {
                "input": str(path.relative_to(ROOT)).replace("\\", "/"),
                "input_sha256": hashlib.sha256(blob).hexdigest(),
                "input_manifest_torch": source_manifest["torch"],
                "snapshots": snapshots,
            }
        finally:
            learner.env.close()
    document["seconds"] = time.perf_counter() - started
    document["source_hashes_after"] = source_hashes()
    document["source_unchanged"] = document["source_hashes_after"] == hashes_before
    write(output / "worker.json", document)
    print(
        json.dumps(
            {
                "torch": torch.__version__,
                "seconds": document["seconds"],
                "source_unchanged": document["source_unchanged"],
            }
        ),
        flush=True,
    )


def compare_state(left, right):
    import numpy as np
    import torch

    def statistics():
        return {
            "all_bit_equal": True,
            "within_tolerance": True,
            "max_abs": 0.0,
            "max_scaled_error": 0.0,
            "floating_values": 0,
            "integer_values": 0,
            "non_numeric_exact": True,
            "non_numeric_leaves": 0,
            "differences": [],
        }

    total, groups = statistics(), {}

    def issue(stats, path, reason):
        stats["all_bit_equal"] = False
        stats["within_tolerance"] = False
        stats["non_numeric_exact"] = False
        if len(stats["differences"]) < 24:
            stats["differences"].append({"path": path, "reason": reason})

    def walk(a, b, path, stats):
        if isinstance(a, torch.Tensor) or isinstance(b, torch.Tensor):
            if not isinstance(a, torch.Tensor) or not isinstance(b, torch.Tensor):
                issue(stats, path, "tensor/non-tensor mismatch")
                return
            if a.shape != b.shape or a.dtype != b.dtype:
                issue(stats, path, "tensor shape or dtype mismatch")
                return
            x, y = a.detach().cpu().contiguous().numpy(), b.detach().cpu().contiguous().numpy()
            exact = x.tobytes() == y.tobytes()
            stats["all_bit_equal"] &= exact
            if np.issubdtype(x.dtype, np.floating):
                stats["floating_values"] += x.size
                error = np.abs(x - y)
                scaled = error / (ATOL + RTOL * np.abs(x))
                stats["max_abs"] = max(stats["max_abs"], float(error.max(initial=0)))
                stats["max_scaled_error"] = max(
                    stats["max_scaled_error"], float(scaled.max(initial=0))
                )
                good = bool(np.all(error <= ATOL + RTOL * np.abs(x)))
                stats["within_tolerance"] &= good
                if not exact and len(stats["differences"]) < 24:
                    stats["differences"].append(
                        {
                            "path": path,
                            "reason": "floating tensor differs",
                            "max_abs": float(error.max(initial=0)),
                            "within_tolerance": good,
                        }
                    )
            else:
                stats["integer_values"] += x.size
                stats["within_tolerance"] &= exact
                if not exact:
                    issue(stats, path, "integer/bool/RNG tensor differs")
            return
        if type(a) is not type(b):
            issue(stats, path, "Python type mismatch")
        elif isinstance(a, dict):
            if a.keys() != b.keys():
                issue(stats, path, "mapping keys differ")
            for key in sorted(a.keys() & b.keys()):
                walk(a[key], b[key], path + "/" + str(key), stats)
        elif isinstance(a, list):
            if len(a) != len(b):
                issue(stats, path, "list lengths differ")
            for index, (x, y) in enumerate(zip(a, b)):
                walk(x, y, f"{path}/{index}", stats)
        elif isinstance(a, float):
            stats["floating_values"] += 1
            exact = struct.pack(">d", a) == struct.pack(">d", b)
            error = abs(a - b)
            good = error <= ATOL + RTOL * abs(a)
            stats["all_bit_equal"] &= exact
            stats["within_tolerance"] &= good
            stats["max_abs"] = max(stats["max_abs"], error)
            stats["max_scaled_error"] = max(
                stats["max_scaled_error"], error / (ATOL + RTOL * abs(a))
            )
            if not exact and len(stats["differences"]) < 24:
                stats["differences"].append(
                    {
                        "path": path,
                        "reason": "floating metadata differs",
                        "max_abs": error,
                        "within_tolerance": good,
                    }
                )
        else:
            stats["non_numeric_leaves"] += 1
            if isinstance(a, int) and not isinstance(a, bool):
                stats["integer_values"] += 1
            if a != b:
                issue(stats, path, "integer or non-numeric metadata differs")

    for key in sorted(left.keys() | right.keys()):
        stats = statistics()
        if key not in left or key not in right:
            issue(stats, key, "top-level state component missing")
        else:
            walk(left[key], right[key], key, stats)
        groups[key] = stats
        for field in ("all_bit_equal", "within_tolerance", "non_numeric_exact"):
            total[field] &= stats[field]
        for field in ("max_abs", "max_scaled_error"):
            total[field] = max(total[field], stats[field])
        for field in ("floating_values", "integer_values", "non_numeric_leaves"):
            total[field] += stats[field]
        total["differences"].extend(stats["differences"][: max(0, 24 - len(total["differences"]))])
    return {"total": total, "state_components": groups}


def compare(left, right, output, candidate_lock, candidate_audit):
    import torch

    from policyglass.checkpoint import decode

    documents = [
        json.loads((folder / "worker.json").read_text("utf-8")) for folder in (left, right)
    ]
    result = {
        "schema": "policyglass.runtime-compatibility.v1",
        "created_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "comparison_process": {
            "python": platform.python_version(),
            "torch": torch.__version__,
            "operation": "read-only decode and recursive complete internal-state comparison; no learner/world created",
        },
        "versions": [
            {
                key: document[key]
                for key in ("python", "torch", "numpy", "setuptools", "platform", "mode", "seconds")
            }
            for document in documents
        ],
        "tolerance": {
            "abs": ATOL,
            "rel": RTOL,
            "rule": "abs(left-right) <= abs_tolerance + rel_tolerance*abs(left); integer/RNG/non-numeric exact",
        },
        "sequence": "same saved final checkpoint -> 3 sequential fixed-batch/noise counterfactual updates -> 3 fresh collection/update iterations",
        "source_hashes": documents[0]["source_hashes_before"],
        "source_identical_and_stable": all(document["source_unchanged"] for document in documents)
        and documents[0]["source_hashes_before"] == documents[1]["source_hashes_before"],
        "algorithms": {},
        "limitations": [
            "Two self-produced seed11 trained states only, three updates and three subsequent collections; not all seeds or arbitrary future horizons.",
            "Historical training remains attributed to Torch2.8.0+cpu. Runtime migration does not relabel old results.",
            "Versioned bundle manifests differ by design and are not the equality criterion. All learner state fields including optimizer/RNG/replay/physical integration state are checked.",
            "No main environment was modified or selected by this script.",
        ],
    }
    all_exact = all_close = result["source_identical_and_stable"]
    for algorithm in SOURCES:
        a, b = [document["algorithms"][algorithm] for document in documents]
        if a["input_sha256"] != b["input_sha256"]:
            raise ValueError("Workers did not load the identical source checkpoint")
        comparisons = []
        for x, y in zip(a["snapshots"], b["snapshots"]):
            if x["stage"] != y["stage"]:
                raise ValueError("Worker stages differ")
            blobs = [
                (folder / snapshot["filename"]).read_bytes()
                for folder, snapshot in ((left, x), (right, y))
            ]
            if any(
                hashlib.sha256(blob).hexdigest() != snapshot["sha256"]
                for blob, snapshot in zip(blobs, (x, y))
            ):
                raise ValueError("Comparison artifact hash changed")
            states = [decode(blob)[0] for blob in blobs]
            comparison = compare_state(*states)
            comparison.update(
                stage=x["stage"],
                source_env_steps=[x["env_steps"], y["env_steps"]],
                source_updates=[x["updates"], y["updates"]],
            )
            all_exact &= comparison["total"]["all_bit_equal"]
            all_close &= comparison["total"]["within_tolerance"]
            comparisons.append(comparison)
        result["algorithms"][algorithm] = {
            "input": a["input"],
            "input_sha256": a["input_sha256"],
            "input_manifest_torch": a["input_manifest_torch"],
            "stages": comparisons,
        }
    audit = candidate_audit
    if audit.exists():
        result["candidate_osv_queries"] = json.loads(audit.read_text("utf-8-sig"))
    lock = candidate_lock
    if lock.exists():
        result["candidate_lock_sha256"] = digest(lock)
    result.update(all_bit_equal=bool(all_exact), all_within_tolerance=bool(all_close))
    result["status"] = "VERIFIED" if all_close else "DIFFERENT"
    write(output, result)
    print(
        json.dumps(
            {
                "all_bit_equal": result["all_bit_equal"],
                "all_within_tolerance": result["all_within_tolerance"],
                "old_torch": documents[0]["torch"],
                "candidate_torch": documents[1]["torch"],
            }
        ),
        flush=True,
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("run", "worker", "compare"), default="run")
    parser.add_argument(
        "--output", default=str(ROOT / "evidence/038-stage3-runtime-compatibility.json")
    )
    parser.add_argument("--old-python", default=str(ROOT / ".venv/Scripts/python.exe"))
    parser.add_argument(
        "--candidate-python", default=str(ROOT / ".runtime/secure-venv/Scripts/python.exe")
    )
    parser.add_argument("--left")
    parser.add_argument("--right")
    parser.add_argument(
        "--candidate-lock", default=str(ROOT / ".runtime/requirements-secure-candidate.lock")
    )
    parser.add_argument(
        "--candidate-audit", default=str(ROOT / ".runtime/candidate-advisories.json")
    )
    args = parser.parse_args()
    if args.mode == "worker":
        worker(d_path(args.output))
    elif args.mode == "compare":
        compare(
            d_path(args.left),
            d_path(args.right),
            d_path(args.output),
            d_path(args.candidate_lock),
            d_path(args.candidate_audit),
        )
    else:
        folder = d_path(
            ROOT
            / f".runtime/runtime-compatibility/{time.strftime('%Y%m%dT%H%M%S', time.gmtime())}-{os.getpid()}"
        )
        folder.mkdir(parents=True, exist_ok=False)
        paths = [folder / "original", folder / "candidate"]
        interpreters = [d_path(args.old_python), d_path(args.candidate_python)]
        try:
            for interpreter, output in zip(interpreters, paths):
                with (folder / f"{output.name}.log").open("wb") as stream:
                    command = [
                        str(interpreter),
                        str(Path(__file__).resolve()),
                        "--mode",
                        "worker",
                        "--output",
                        str(output),
                    ]
                    subprocess.run(
                        command,
                        cwd=ROOT,
                        stdout=stream,
                        stderr=subprocess.STDOUT,
                        check=True,
                        timeout=300,
                    )
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
            write(
                args.output,
                {
                    "schema": "policyglass.runtime-compatibility.v1",
                    "status": "NOT_VERIFIED",
                    "error_type": type(exc).__name__,
                    "command": command,
                    "worker_logs": str(folder.relative_to(ROOT)).replace("\\", "/"),
                    "all_bit_equal": None,
                    "all_within_tolerance": None,
                    "scope": "A worker failed before comparison; no compatibility conclusion or migration",
                },
            )
            raise
        subprocess.run(
            [
                str(interpreters[0]),
                str(Path(__file__).resolve()),
                "--mode",
                "compare",
                "--left",
                str(paths[0]),
                "--right",
                str(paths[1]),
                "--output",
                str(d_path(args.output)),
                "--candidate-lock",
                str(d_path(args.candidate_lock)),
                "--candidate-audit",
                str(d_path(args.candidate_audit)),
            ],
            cwd=ROOT,
            check=True,
            timeout=180,
        )


if __name__ == "__main__":
    main()
