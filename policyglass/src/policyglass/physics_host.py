"""Canonical MuJoCo WASM runs in a persistent Node process, with no native DLL patch."""

import atexit
import json
import os
import queue
import shutil
import subprocess
import threading
from pathlib import Path

ENGINE_VERSION = "4.0.1"


class PhysicsHost:
    def __init__(self):
        self.lock = threading.RLock()
        self.messages = queue.Queue()
        self.sequence = 0
        root = Path(__file__).resolve().parents[2]
        script = root / "physics" / "host.mjs"
        node = os.environ.get("POLICYGLASS_NODE") or shutil.which("node")
        if not node:
            raise RuntimeError("Node 22+ is required for canonical MuJoCo WASM")
        creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        self.process = subprocess.Popen(
            [node, str(script)],
            cwd=root,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            bufsize=1,
            creationflags=creationflags,
        )
        self.errors = []
        threading.Thread(target=self._read, daemon=True).start()
        threading.Thread(target=self._read_errors, daemon=True).start()
        try:
            ready = self.messages.get(timeout=30)
        except queue.Empty as exc:
            self.close()
            raise RuntimeError(f"MuJoCo WASM did not start: {self.errors[-3:]}") from exc
        if not ready.get("ready") or ready.get("version") != ENGINE_VERSION:
            self.close()
            raise RuntimeError(f"Unexpected physics engine handshake: {ready}")
        atexit.register(self.close)

    def _read(self):
        try:
            for line in self.process.stdout:
                self.messages.put(json.loads(line))
        except (ValueError, OSError) as exc:
            self.messages.put({"error": str(exc)})
        self.messages.put({"error": "Physics process exited"})

    def _read_errors(self):
        for line in self.process.stderr:
            self.errors.append(line.strip())
            if len(self.errors) > 20:
                self.errors.pop(0)

    def call(self, op, **data):
        with self.lock:
            if self.process.poll() is not None:
                raise RuntimeError(f"Physics process stopped: {self.errors[-3:]}")
            self.sequence += 1
            request = {"sequence": self.sequence, "op": op, **data}
            self.process.stdin.write(json.dumps(request, allow_nan=False) + "\n")
            self.process.stdin.flush()
            try:
                message = self.messages.get(timeout=30)
            except queue.Empty as exc:
                self.close()
                raise RuntimeError("Physics operation timed out") from exc
            if message.get("error"):
                raise RuntimeError(message["error"])
            if message.get("sequence") != self.sequence:
                raise RuntimeError("Physics protocol sequence mismatch")
            return message["result"]

    def close(self):
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.process.kill()


_host = None
_host_lock = threading.Lock()


def host():
    global _host
    with _host_lock:
        if _host is None or _host.process.poll() is not None:
            _host = PhysicsHost()
        return _host
