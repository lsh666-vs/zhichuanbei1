"""Actual TCP/uvicorn/spawn-worker smoke. All output remains inside D: project."""

import json
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

root = Path(__file__).resolve().parents[1]
runtime = root / ".runtime"
if root.drive.upper() != "D:":
    raise SystemExit("Smoke output must remain D:")
with socket.socket() as port_socket:
    port_socket.bind(("127.0.0.1", 0))
    port = port_socket.getsockname()[1]
base = f"http://127.0.0.1:{port}"


def call(path, data=None, raw=False):
    body = (
        None if data is None else (data if isinstance(data, bytes) else json.dumps(data).encode())
    )
    request = urllib.request.Request(
        base + path,
        data=body,
        headers={
            "Content-Type": "application/octet-stream"
            if isinstance(data, bytes)
            else "application/json"
        },
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        content = response.read()
    return content if raw else json.loads(content)


def wait_job(job):
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        result = call(f"/api/jobs/{job['id']}")
        if result["status"] in ("completed", "cancelled", "failed"):
            if result["status"] != "completed":
                raise AssertionError(result)
            return result
        time.sleep(0.05)
    raise TimeoutError("Real worker did not complete")


def main():
    runtime.mkdir(exist_ok=True)
    results = {
        "transport": "actual_loopback_tcp_uvicorn_and_spawned_workers",
        "port": port,
        "algorithms": {},
    }
    with (runtime / "tcp-server.log").open("wb") as log:
        process = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "policyglass.cli",
                "serve",
                "--port",
                str(port),
                "--data",
                str(runtime / f"tcp-store-{uuid.uuid4().hex}"),
            ],
            cwd=root,
            stdout=log,
            stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
        )
        try:
            deadline = time.monotonic() + 30
            while True:
                try:
                    results["health"] = call("/api/health")
                    break
                except urllib.error.URLError:
                    if process.poll() is not None or time.monotonic() >= deadline:
                        raise RuntimeError("TCP server failed to start") from None
                    time.sleep(0.1)
            for algorithm in ("ppo", "sac"):
                experiment = call(
                    "/api/experiments",
                    {
                        "label": "Actual TCP integration",
                        "config": {
                            "algorithm": algorithm,
                            "network": {"hidden": [8, 8]},
                            "ppo": {"rollout_steps": 8, "epochs": 2},
                            "sac": {"batch_size": 4, "warmup_steps": 8, "replay_capacity": 128},
                        },
                    },
                )
                experiment_id = experiment["id"]
                prediction = call(f"/api/experiments/{experiment_id}/predict", {})
                assert prediction["phase"] == "forward_only_no_parameter_update"
                job = wait_job(call(f"/api/experiments/{experiment_id}/jobs", {"record": True}))
                trace = call(f"/api/traces/{job['trace']}/index")
                frames = call(f"/api/traces/{job['trace']}/frames")
                assert frames["sample_ids"] == [frame["sample_id"] for frame in frames["frames"]]
                branch = call(
                    f"/api/experiments/{experiment_id}/branches",
                    {
                        "checkpoint": trace["origin_checkpoint"],
                        "intervention": {
                            "kind": "hyperparameter",
                            "path": f"{algorithm}.learning_rate",
                            "value": 0.001,
                        },
                    },
                )
                changed = wait_job(
                    call(f"/api/experiments/{branch['id']}/jobs", {"mode": "fixed_batch"})
                )
                blob = call(f"/api/checkpoints/{job['checkpoint']}/download", raw=True)
                imported = call("/api/import", blob)
                result = {
                    "experiment_id": experiment_id,
                    "job_status": job["status"],
                    "events": len(trace["events"]),
                    "fixed_batch_branch_status": changed["status"],
                    "bundle_bytes": len(blob),
                    "imported_id": imported["experiment"]["id"],
                    "physical_sample_link_verified": True,
                }
                if algorithm == "sac":
                    result["q_grid"] = len(
                        call(f"/api/experiments/{experiment_id}/q-slice", {"resolution": 5})["q1"]
                    )
                results["algorithms"][algorithm] = result
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
    (runtime / "tcp-smoke-result.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
