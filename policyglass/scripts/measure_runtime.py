"""Actual loopback API measurements; no mocks, external origins or global installs.

Source scripts/Environment.ps1 first. This command owns a fresh server/store on
8792 and stops only its process tree. Run without other training/tests for useful
performance evidence. All numbers, including failed targets, remain in JSON.
"""

import argparse
import ctypes
import hashlib
import http.client
import json
import os
import platform
import socket
import statistics
import subprocess
import sys
import threading
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def distribution(values):
    if not values:
        return {"count": 0, "p50": None, "p95": None, "min": None, "max": None}
    ordered = sorted(values)

    def quantile(fraction):
        position = (len(ordered) - 1) * fraction
        lower = int(position)
        upper = min(lower + 1, len(ordered) - 1)
        return ordered[lower] + (position - lower) * (ordered[upper] - ordered[lower])

    return {
        "count": len(values),
        "p50": quantile(0.5),
        "p95": quantile(0.95),
        "min": ordered[0],
        "max": ordered[-1],
    }


def windows_api():
    from ctypes import wintypes

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = (wintypes.HANDLE,)
    kernel.CreateToolhelp32Snapshot.argtypes = (wintypes.DWORD, wintypes.DWORD)
    kernel.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    return kernel, wintypes


def process_tree(root_pid):
    if sys.platform != "win32":
        return [root_pid]
    kernel, wintypes = windows_api()

    class Entry(ctypes.Structure):
        _fields_ = [
            ("dwSize", wintypes.DWORD),
            ("cntUsage", wintypes.DWORD),
            ("th32ProcessID", wintypes.DWORD),
            ("th32DefaultHeapID", ctypes.c_size_t),
            ("th32ModuleID", wintypes.DWORD),
            ("cntThreads", wintypes.DWORD),
            ("th32ParentProcessID", wintypes.DWORD),
            ("pcPriClassBase", wintypes.LONG),
            ("dwFlags", wintypes.DWORD),
            ("szExeFile", wintypes.WCHAR * 260),
        ]

    snapshot = kernel.CreateToolhelp32Snapshot(2, 0)
    if snapshot == ctypes.c_void_p(-1).value:
        raise OSError("Cannot inspect owned process tree")
    first, next_entry = kernel.Process32FirstW, kernel.Process32NextW
    for function in (first, next_entry):
        function.argtypes = (wintypes.HANDLE, ctypes.POINTER(Entry))
        function.restype = wintypes.BOOL
    entry = Entry()
    entry.dwSize = ctypes.sizeof(entry)
    parents = {}
    try:
        more = first(snapshot, ctypes.byref(entry))
        while more:
            parents[int(entry.th32ProcessID)] = int(entry.th32ParentProcessID)
            more = next_entry(snapshot, ctypes.byref(entry))
    finally:
        kernel.CloseHandle(snapshot)
    owned = {root_pid}
    while True:
        expanded = owned | {pid for pid, parent in parents.items() if parent in owned}
        if expanded == owned:
            return sorted(owned)
        owned = expanded


def process_memory(pid):
    if sys.platform != "win32":
        return {"pid": pid, "supported": False}
    kernel, wintypes = windows_api()

    class Counters(ctypes.Structure):
        _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD)] + [
            (name, ctypes.c_size_t)
            for name in (
                "PeakWorkingSetSize",
                "WorkingSetSize",
                "QuotaPeakPagedPoolUsage",
                "QuotaPagedPoolUsage",
                "QuotaPeakNonPagedPoolUsage",
                "QuotaNonPagedPoolUsage",
                "PagefileUsage",
                "PeakPagefileUsage",
                "PrivateUsage",
            )
        ]

    class IO(ctypes.Structure):
        _fields_ = [
            (name, ctypes.c_ulonglong)
            for name in (
                "ReadOperationCount",
                "WriteOperationCount",
                "OtherOperationCount",
                "ReadTransferCount",
                "WriteTransferCount",
                "OtherTransferCount",
            )
        ]

    handle = kernel.OpenProcess(0x1000 | 0x10, False, pid)
    if not handle:
        return {"pid": pid, "supported": False, "reason": "process exited or access denied"}
    try:
        psapi = ctypes.WinDLL("psapi", use_last_error=True)
        memory = psapi.GetProcessMemoryInfo
        memory.argtypes = (wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD)
        memory.restype = wintypes.BOOL
        counters = Counters()
        counters.cb = ctypes.sizeof(counters)
        if not memory(handle, ctypes.byref(counters), counters.cb):
            return {"pid": pid, "supported": False, "reason": "GetProcessMemoryInfo failed"}
        io = IO()
        kernel.GetProcessIoCounters.argtypes = (wintypes.HANDLE, ctypes.POINTER(IO))
        io_ok = kernel.GetProcessIoCounters(handle, ctypes.byref(io))
        return {
            "pid": pid,
            "supported": True,
            "private_bytes": counters.PrivateUsage,
            "working_set_bytes": counters.WorkingSetSize,
            "peak_working_set_bytes": counters.PeakWorkingSetSize,
            "read_transfer_bytes": io.ReadTransferCount if io_ok else None,
            "write_transfer_bytes": io.WriteTransferCount if io_ok else None,
        }
    finally:
        kernel.CloseHandle(handle)


def machine():
    result = {
        "os": platform.platform(),
        "architecture": platform.machine(),
        "cpu": platform.processor(),
        "logical_cpus": os.cpu_count(),
        "python": platform.python_version(),
        "memory_backend": "Windows GetProcessMemoryInfo/PrivateUsage; Toolhelp process tree",
    }
    if sys.platform == "win32":
        import winreg

        with winreg.OpenKey(
            winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0"
        ) as key:
            result["cpu"] = winreg.QueryValueEx(key, "ProcessorNameString")[0].strip()

        class Status(ctypes.Structure):
            _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong)] + [
                (name, ctypes.c_ulonglong)
                for name in (
                    "ullTotalPhys",
                    "ullAvailPhys",
                    "ullTotalPageFile",
                    "ullAvailPageFile",
                    "ullTotalVirtual",
                    "ullAvailVirtual",
                    "ullAvailExtendedVirtual",
                )
            ]

        status = Status()
        status.dwLength = ctypes.sizeof(status)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            result["physical_memory_bytes"] = status.ullTotalPhys
            result["available_memory_bytes_at_start"] = status.ullAvailPhys
    return result


class Client:
    def __init__(self, port):
        self.port = port
        self.connection = http.client.HTTPConnection("127.0.0.1", port, timeout=120)

    def request(self, method, path, body=None):
        payload = None if body is None else json.dumps(body, allow_nan=False).encode()
        started = time.perf_counter()
        self.connection.request(method, path, payload, {"Content-Type": "application/json"})
        response = self.connection.getresponse()
        content = response.read()
        received = time.perf_counter()
        if not 200 <= response.status < 300:
            raise RuntimeError(f"{method} {path}: HTTP {response.status}; {content[:200]!r}")
        decoded = json.loads(content)
        finished = time.perf_counter()
        return decoded, {
            "http_ms": (received - started) * 1000,
            "client_json_parse_ms": (finished - received) * 1000,
            "response_bytes": len(content),
            "status": response.status,
        }

    def close(self):
        self.connection.close()


def stop_owned(process):
    # Open handles while ownership is known; handles stay bound if a PID exits.
    if sys.platform == "win32":
        kernel, wintypes = windows_api()
        kernel.TerminateProcess.argtypes = (wintypes.HANDLE, wintypes.UINT)
        handles = [kernel.OpenProcess(1, False, pid) for pid in process_tree(process.pid)]
        try:
            for handle in handles:
                if handle:
                    kernel.TerminateProcess(handle, 1)
        finally:
            for handle in handles:
                if handle:
                    kernel.CloseHandle(handle)
    elif process.poll() is None:
        import signal

        os.killpg(process.pid, signal.SIGTERM)
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=10)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8792)
    parser.add_argument("--samples", type=int, default=25)
    parser.add_argument("--job-repetitions", type=int, default=5)
    parser.add_argument("--stability-seconds", type=float, default=120)
    parser.add_argument("--output", default=".runtime/performance/api-runtime.json")
    parser.add_argument(
        "--background-load",
        default="No background load declared; machine idleness was not independently established.",
    )
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535 or not 3 <= args.samples <= 100:
        parser.error("Choose port 1024..65535 and 3..100 samples")
    if not 1 <= args.job_repetitions <= 10 or not 10 <= args.stability_seconds <= 600:
        parser.error("Choose 1..10 job repetitions and 10..600 stability seconds")
    output = (ROOT / args.output).resolve()
    if ROOT.drive.upper() != "D:" or output.drive.upper() != "D:":
        parser.error("Project, runtime and output must remain D:")
    if Path(os.environ.get("TEMP", "C:/")).resolve().drive.upper() != "D:":
        parser.error("Source scripts/Environment.ps1 first so all temporary files remain D:")
    # Binding without SO_REUSEADDR avoids connecting to or replacing another service.
    with socket.socket() as guard:
        guard.bind(("127.0.0.1", args.port))
    output.parent.mkdir(parents=True, exist_ok=True)
    run_id = uuid.uuid4().hex
    store = ROOT / ".runtime" / "performance" / ("store-" + run_id)
    projections = "policyglass.trace-projections.v1" in (
        ROOT / "src" / "policyglass" / "repository.py"
    ).read_text(encoding="utf-8")
    report = {
        "schema": "policyglass.performance.api.v1",
        "status": "running",
        "started_utc": datetime.now(UTC).isoformat(),
        "machine": machine(),
        "git_revision": subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
        ).strip(),
        "source_sha256": {
            str(path.relative_to(ROOT)).replace("\\", "/"): hashlib.sha256(
                path.read_bytes()
            ).hexdigest()
            for path in [Path(__file__), *sorted((ROOT / "src" / "policyglass").glob("*.py"))]
        },
        "transport": "actual loopback TCP, HTTP keep-alive, no Origin header, no mock",
        "sampling": vars(args),
        "background_load": args.background_load,
        "trace_storage_inferred_from_source": "checksummed immutable partial projections"
        if projections
        else "complete Trace read for every partial request",
        "mode": "CPU float64, one torch thread; default 64x64; canonical MuJoCo WASM",
        "algorithms": {},
        "memory_samples": [],
        "stability_cycles": [],
        "limits": [
            "Read background_load before interpreting results; concurrent load is a confound for idle-baseline comparisons.",
            "HTTP time includes service/file/JSON/socket work; JSON client parsing is separate.",
            "Job wall time includes process spawn, complete iteration, trace/state writes and polling delay.",
            "Warm cached reads do not measure physical disk throughput or cold startup.",
            "Read-transfer counters include all process I/O, not only physical file reads.",
            "Working sets summed across processes count shared pages more than once; private bytes avoid that.",
            "A short memory plateau is a stress observation, not proof of absence of leaks.",
            "No renderer/GPU/FPS claims are made by this backend measurement.",
        ],
    }
    process = None
    client = Client(args.port)
    sampler_stop = threading.Event()
    sampler = None
    elapsed_start = time.perf_counter()
    try:
        with (output.parent / f"api-{run_id}.log").open("wb") as log:
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
                    health, _ = client.request("GET", "/api/health")
                    report["health"] = health
                    break
                except (OSError, http.client.HTTPException):
                    client.close()
                    client = Client(args.port)
                    if process.poll() is not None or time.monotonic() >= deadline:
                        raise RuntimeError(
                            "Owned API failed readiness; inspect its D: log"
                        ) from None
                    time.sleep(0.1)

            def memory_sample():
                while not sampler_stop.is_set():
                    rows = [process_memory(pid) for pid in process_tree(process.pid)]
                    report["memory_samples"].append(
                        {
                            "elapsed_seconds": time.perf_counter() - elapsed_start,
                            "processes": rows,
                            "tree_private_bytes": sum(r.get("private_bytes", 0) for r in rows),
                            "tree_working_set_bytes": sum(
                                r.get("working_set_bytes", 0) for r in rows
                            ),
                        }
                    )
                    sampler_stop.wait(0.5)

            sampler = threading.Thread(target=memory_sample, daemon=True)
            sampler.start()
            for _ in range(3):
                client.request("GET", "/api/health")
            sources = []
            for algorithm in ("ppo", "sac"):
                print(
                    f"Measuring {algorithm}: default 64x64, {args.job_repetitions} real traced iterations",
                    flush=True,
                )
                experiment, _ = client.request(
                    "POST",
                    "/api/experiments",
                    {
                        "label": "Runtime measurement " + algorithm,
                        "config": {"algorithm": algorithm, "seed": 1701},
                    },
                )
                prefix = f"/api/experiments/{experiment['id']}"
                record = {"config": experiment["config"], "jobs": [], "requests": {}}
                report["algorithms"][algorithm] = record
                for repetition in range(args.job_repetitions):
                    started = time.perf_counter()
                    job, _ = client.request(
                        "POST", prefix + "/jobs", {"iterations": 1, "record": True, "mode": "train"}
                    )
                    job_deadline = time.monotonic() + 180
                    while True:
                        job, _ = client.request("GET", f"/api/jobs/{job['id']}")
                        if job["status"] in ("completed", "cancelled", "failed"):
                            break
                        if time.monotonic() > job_deadline:
                            raise TimeoutError("Owned traced job exceeded 180 seconds")
                        time.sleep(0.025)
                    record["jobs"].append(
                        {
                            "repetition": repetition,
                            "wall_ms": (time.perf_counter() - started) * 1000,
                            "job": job,
                        }
                    )
                    if job["status"] != "completed":
                        raise RuntimeError(
                            f"Measured {algorithm} job {job['status']}: {job['error']}"
                        )
                traces, _ = client.request("GET", prefix + "/traces")
                trace = traces[-1]
                trace_prefix = f"/api/traces/{trace['id']}"
                index, _ = client.request("GET", trace_prefix + "/index")
                layer = next(i for i, e in enumerate(index["events"]) if e["kind"] == "layer")
                optimizer = next(
                    i for i, e in enumerate(index["events"]) if e["kind"] == "optimizer"
                )
                paths = {
                    "health": "/api/health",
                    "experiment_detail": prefix,
                    "trace_index": trace_prefix + "/index",
                    "layer_event": trace_prefix + f"/events/{layer}",
                    "optimizer_event": trace_prefix + f"/events/{optimizer}",
                }
                record["trace_bytes_on_disk"] = trace["bytes"]
                for name, path in paths.items():
                    before = process_memory(process.pid)
                    raw = [client.request("GET", path)[1] for _ in range(args.samples)]
                    record["requests"][name] = {
                        "raw": raw,
                        "http_ms": distribution([sample["http_ms"] for sample in raw]),
                        "client_json_parse_ms": distribution(
                            [sample["client_json_parse_ms"] for sample in raw]
                        ),
                        "api_process_before": before,
                        "api_process_after": process_memory(process.pid),
                        "whole_trace_reads_inferred_from_source": args.samples
                        if not projections
                        and name in ("trace_index", "layer_event", "optimizer_event")
                        else 0,
                    }
                record["job_wall_ms"] = distribution([job["wall_ms"] for job in record["jobs"]])
                sources.append({"algorithm": algorithm, "paths": paths})
            report["stability_start_elapsed_seconds"] = time.perf_counter() - elapsed_start
            deadline = time.monotonic() + args.stability_seconds
            print(f"Starting {args.stability_seconds:g}s read-only Trace/detail stress", flush=True)
            while time.monotonic() < deadline:
                for source in sources:
                    row = {
                        "elapsed_seconds": time.perf_counter() - elapsed_start,
                        "algorithm": source["algorithm"],
                        "requests": {},
                    }
                    for name in ("trace_index", "layer_event", "experiment_detail"):
                        _, row["requests"][name] = client.request("GET", source["paths"][name])
                    report["stability_cycles"].append(row)
                time.sleep(0.1)
            stress_memory = [
                m
                for m in report["memory_samples"]
                if m["elapsed_seconds"] >= report["stability_start_elapsed_seconds"]
            ]
            private = [m["tree_private_bytes"] for m in stress_memory]
            window = max(1, min(10, len(private) // 3))
            report["stability_summary"] = {
                "cycle_count": len(report["stability_cycles"]),
                "duration_seconds": time.perf_counter()
                - elapsed_start
                - report["stability_start_elapsed_seconds"],
                "private_bytes": distribution(private),
                "first_window_median_private_bytes": statistics.median(private[:window])
                if private
                else None,
                "last_window_median_private_bytes": statistics.median(private[-window:])
                if private
                else None,
                "window_samples": window,
            }
            report["status"] = "completed"
    except Exception as exc:
        report["status"] = "failed"
        report["error"] = f"{type(exc).__name__}: {exc}"
        raise
    finally:
        sampler_stop.set()
        if sampler is not None:
            sampler.join(timeout=5)
        client.close()
        if process is not None:
            stop_owned(process)
        report["total_seconds"] = time.perf_counter() - elapsed_start
        output.write_text(
            json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8"
        )
        print(f"{report['status']}: {output}", flush=True)


if __name__ == "__main__":
    main()
