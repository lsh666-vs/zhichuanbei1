"""Endpoint-only measurement of verified JSON byte responses on actual 033 Traces."""

import argparse
import hashlib
import http.client
import importlib.metadata
import json
import socket
import sqlite3
import subprocess
import sys
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path

from measure_runtime import ROOT, Client, distribution, machine, stop_owned


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8792)
    parser.add_argument("--samples", type=int, default=25)
    parser.add_argument(
        "--source-report", default="evidence/033-stage3-api-performance-projected.json"
    )
    parser.add_argument("--output", default="evidence/039-stage3-event-byte-response.json")
    args = parser.parse_args()
    output = (ROOT / args.output).resolve()
    if ROOT.drive.upper() != "D:" or output.drive.upper() != "D:":
        parser.error("All outputs must remain D:")
    if not 1024 <= args.port <= 65535 or not 3 <= args.samples <= 100:
        parser.error("Invalid port/sample budget")
    from os import environ

    if Path(environ.get("TEMP", "C:/")).resolve().drive.upper() != "D:":
        parser.error("Source scripts/Environment.ps1 first")
    source_path = (ROOT / args.source_report).resolve()
    prior_blob = source_path.read_bytes()
    prior = json.loads(prior_blob)
    sources = {
        algorithm: record["jobs"][-1]["job"]["trace"]
        for algorithm, record in prior["algorithms"].items()
    }
    matches = []
    for store in (ROOT / ".runtime" / "performance").glob("store-*"):
        database = store / "policyglass.sqlite"
        if database.is_file():
            with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as db:
                ids = {row[0] for row in db.execute("SELECT id FROM traces")}
                if set(sources.values()) <= ids:
                    matches.append(store)
    if len(matches) != 1:
        raise ValueError("Expected exactly one local benchmark store with the recorded 033 Traces")
    store = matches[0]
    with socket.socket() as guard:
        guard.bind(("127.0.0.1", args.port))
    log_path = ROOT / ".runtime" / "performance" / f"byte-response-{uuid.uuid4().hex}.log"
    report = {
        "schema": "policyglass.performance.trace-bytes.v1",
        "status": "running",
        "started_utc": datetime.now(UTC).isoformat(),
        "machine": machine(),
        "libraries": {
            name: importlib.metadata.version(name)
            for name in ("torch", "fastapi", "starlette", "pydantic")
        },
        "background_load": "Coordinator declared one independent SAC research process, 64x64/reuse4/seed71, one Torch CPU thread plus Node MuJoCo WASM. No browser measurement at start. Loaded endpoint observation, not an idle baseline.",
        "transport": "actual loopback HTTP keep-alive; no Origin; existing 033 immutable Traces; no new training",
        "source_report": {
            "path": args.source_report,
            "sha256": hashlib.sha256(prior_blob).hexdigest(),
        },
        "source_sha256": {
            str(path.relative_to(ROOT)).replace("\\", "/"): hashlib.sha256(
                path.read_bytes()
            ).hexdigest()
            for path in (
                Path(__file__),
                ROOT / "scripts" / "measure_runtime.py",
                ROOT / "src" / "policyglass" / "repository.py",
                ROOT / "src" / "policyglass" / "api.py",
            )
        },
        "git_revision": subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
        ).strip(),
        "algorithms": {},
        "log": str(log_path.relative_to(ROOT)).replace("\\", "/"),
        "limitations": [
            "This compares actual endpoint observations; OS/background scheduling is not controlled exactly across runs.",
            "Verified JSON bytes remove server-side large-part json.loads plus FastAPI dictionary traversal/re-encoding; manifest parsing and every hash/source/path guard remain.",
            "HTTP receive time excludes separately recorded client Python JSON parsing; UI commit/render time is not measured here.",
            "Existing hot immutable projections, three warmup requests per endpoint; no claim about cold disks.",
            "No storage/lifecycle changes were made for byte responses, so no additional 120-second memory soak is claimed.",
        ],
    }
    process = None
    client = Client(args.port)
    started = time.perf_counter()
    try:
        with log_path.open("wb") as log:
            process = subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "policyglass.cli",
                    "serve",
                    "--port",
                    str(args.port),
                    "--data",
                    str(store),
                ],
                cwd=ROOT,
                stdout=log,
                stderr=subprocess.STDOUT,
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
                start_new_session=sys.platform != "win32",
            )
            deadline = time.monotonic() + 60
            while True:
                try:
                    report["health"], _ = client.request("GET", "/api/health")
                    break
                except (OSError, http.client.HTTPException):
                    client.close()
                    client = Client(args.port)
                    if process.poll() is not None or time.monotonic() >= deadline:
                        raise RuntimeError("Owned endpoint API did not become ready") from None
                    time.sleep(0.1)
            for algorithm, trace_id in sources.items():
                prefix = f"/api/traces/{trace_id}"
                index, _ = client.request("GET", prefix + "/index")
                layer = next(i for i, e in enumerate(index["events"]) if e["kind"] == "layer")
                optimizer = next(
                    i for i, e in enumerate(index["events"]) if e["kind"] == "optimizer"
                )
                results = {"trace": trace_id, "origin": index["origin_checkpoint"], "requests": {}}
                report["algorithms"][algorithm] = results
                for name, path in {
                    "trace_index": prefix + "/index",
                    "layer_event": prefix + f"/events/{layer}",
                    "optimizer_event": prefix + f"/events/{optimizer}",
                    "frames": prefix + "/frames",
                }.items():
                    for _ in range(3):
                        client.request("GET", path)
                    raw = []
                    for sample in range(args.samples):
                        _, timing = client.request("GET", path)
                        raw.append(
                            {
                                "sample": sample,
                                "elapsed_seconds": time.perf_counter() - started,
                                **timing,
                            }
                        )
                    results["requests"][name] = {
                        "raw": raw,
                        "http_ms": distribution([r["http_ms"] for r in raw]),
                        "client_json_parse_ms": distribution(
                            [r["client_json_parse_ms"] for r in raw]
                        ),
                    }
                print(f"{algorithm}: endpoint collection complete", flush=True)
            report["status"] = "completed"
    except Exception as exc:
        report["status"] = "failed"
        report["error"] = f"{type(exc).__name__}: {exc}"
        raise
    finally:
        client.close()
        if process is not None:
            stop_owned(process)
        report["total_seconds"] = time.perf_counter() - started
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(
            json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8"
        )
        print(f"{report['status']}: {output}", flush=True)


if __name__ == "__main__":
    main()
