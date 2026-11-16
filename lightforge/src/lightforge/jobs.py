"""Serialized process jobs with durable events, cancellation and bounded execution."""

from __future__ import annotations

import json
import math
import os
import queue
import subprocess
import sys
import threading
import time

import psutil

from .store import Store


class JobManager:
    def __init__(self, store: Store, timeout_seconds=180, memory_bytes=6 * 1024**3):
        self.store = store
        self.timeout_seconds = timeout_seconds
        self.memory_bytes = memory_bytes
        self.stopping = threading.Event()
        self.wake = threading.Event()
        self.thread = None
        self.process = None

    def start(self):
        self.store.recover()
        self.thread = threading.Thread(target=self._loop, daemon=True, name="lightforge-jobs")
        self.thread.start()

    def stop(self):
        self.stopping.set()
        self.wake.set()
        if self.thread:
            self.thread.join(timeout=8)

    def notify(self):
        self.wake.set()

    def _loop(self):
        while not self.stopping.is_set():
            jobs = self.store.queued()
            if not jobs:
                self.wake.wait(0.25)
                self.wake.clear()
                continue
            try:
                self._execute(jobs[0])
            except Exception as exc:  # noqa: BLE001 -- isolate a failed job from the scheduler
                # Filesystem failures must not silently kill the scheduler thread.
                self.store.event(jobs[0], "failed", "setup_failed", 0, error=str(exc)[:500])

    def _execute(self, ident):
        job = self.store.run(ident)
        if job["state"] != "queued":
            return
        directory = self.store.run_dir(ident)
        directory.mkdir(parents=True, exist_ok=True)
        spec = self.store.experiment(job["experiment_id"])["spec"]
        input_path = directory / "input.json"
        input_path.write_text(json.dumps(spec, ensure_ascii=False), encoding="utf-8")
        if not self.store.event(ident, "running", "starting", 0):
            return
        started = time.monotonic()
        proc = None
        try:
            env = dict(os.environ)
            env.update(OMP_NUM_THREADS="4", OPENBLAS_NUM_THREADS="4", PYTHONDONTWRITEBYTECODE="1")
            flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
            proc = subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "lightforge.worker",
                    "--spec",
                    str(input_path),
                    "--output",
                    str(directory),
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                env=env,
                creationflags=flags,
            )
            self.process = proc
            lines = queue.Queue(maxsize=256)

            def read_lines():
                for line in proc.stdout:
                    try:
                        lines.put_nowait(line[:4096])
                    except queue.Full:
                        pass

            reader = threading.Thread(target=read_lines, daemon=True)
            reader.start()
            with (directory / "worker.log").open("w", encoding="utf-8") as log:
                while proc.poll() is None:
                    if self.store.run(ident)["state"] == "cancelled":
                        proc.terminate()
                        break
                    if self.stopping.is_set():
                        proc.terminate()
                        self.store.event(
                            ident,
                            "failed",
                            "interrupted",
                            0,
                            error="Server stopped; input is preserved.",
                        )
                        break
                    if time.monotonic() - started > self.timeout_seconds:
                        proc.terminate()
                        raise TimeoutError(
                            f"Calculation exceeded {self.timeout_seconds} seconds; input is preserved."
                        )
                    try:
                        used = psutil.Process(proc.pid).memory_info().rss
                        if used > self.memory_bytes:
                            proc.terminate()
                            raise MemoryError(
                                "Scientific worker exceeded its resident-memory budget; input is preserved."
                            )
                    except psutil.NoSuchProcess:
                        pass
                    while not lines.empty():
                        line = lines.get_nowait()
                        log.write(line)
                        try:
                            event = json.loads(line)
                            fraction = float(event["progress"])
                            if math.isfinite(fraction):
                                self.store.event(
                                    ident,
                                    "running",
                                    str(event["stage"])[:120],
                                    max(0, min(1, fraction)),
                                )
                        except (ValueError, KeyError, TypeError):
                            pass
                    time.sleep(0.05)
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
            reader.join(timeout=1)
            if self.store.run(ident)["state"] != "running":
                return
            if proc.returncode != 0:
                raise RuntimeError(
                    f"Scientific worker exited {proc.returncode}; inspect local worker.log."
                )
            result = json.loads((directory / "result.json").read_text(encoding="utf-8"))
            if result["spec_hash"] != self.store.experiment(job["experiment_id"])["hash"]:
                raise RuntimeError("result/configuration hash mismatch")
            self.store.event(ident, "completed", "completed", 1, manifest=result)
        except Exception as exc:  # noqa: BLE001 -- persist failure at the worker-process boundary
            self.store.event(ident, "failed", "failed", 0, error=str(exc)[:500])
        finally:
            if proc and proc.poll() is None:
                proc.kill()
                proc.wait()
            self.process = None
