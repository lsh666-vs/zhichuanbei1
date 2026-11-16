"""Local scientific API. No credentials or arbitrary server paths cross this boundary."""

from __future__ import annotations

import asyncio
import hashlib
import io
import json
import math
import os
import re
import zipfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, StreamingResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware

from . import __version__
from .jobs import JobManager
from .models import ExperimentSpec
from .store import TERMINAL, Store

MAX_BODY = 1024 * 1024


class BodyLimit:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        messages, size = [], 0
        while True:
            message = await receive()
            if message["type"] != "http.request":
                return
            size += len(message.get("body", b""))
            if size > MAX_BODY:
                await send(
                    {
                        "type": "http.response.start",
                        "status": 413,
                        "headers": [(b"content-type", b"application/json")],
                    }
                )
                await send(
                    {"type": "http.response.body", "body": b'{"detail":"body exceeds 1 MiB"}'}
                )
                return
            messages.append(message)
            if not message.get("more_body", False):
                break

        async def replay():
            return messages.pop(0) if messages else await receive()

        await self.app(scope, replay, send)


def create_app(
    data_dir: str | Path | None = None,
    *,
    start_jobs=True,
    timeout_seconds=180,
    memory_bytes=6 * 1024**3,
) -> FastAPI:
    root = Path(data_dir or os.environ.get("LIGHTFORGE_DATA_DIR", ".runtime/data"))
    if os.name == "nt" and root.resolve().drive.upper() != "D:":
        raise ValueError("Local runtime writes must stay on D:")
    store = Store(root)
    manager = JobManager(store, timeout_seconds, memory_bytes)

    @asynccontextmanager
    async def lifespan(app):
        if start_jobs:
            manager.start()
        yield
        if start_jobs:
            manager.stop()

    app = FastAPI(title="LightForge scientific foundation", version=__version__, lifespan=lifespan)
    app.add_middleware(BodyLimit)
    app.add_middleware(
        TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1", "[::1]", "testserver"]
    )
    app.state.store, app.state.jobs = store, manager

    @app.middleware("http")
    async def origin_guard(request, call_next):
        origin = request.headers.get("origin")
        if request.method not in ("GET", "HEAD", "OPTIONS") and origin:
            from urllib.parse import urlsplit

            parsed = urlsplit(origin)
            if parsed.scheme not in ("http", "https") or parsed.netloc != request.headers.get(
                "host"
            ):
                from fastapi.responses import JSONResponse

                return JSONResponse({"detail": "Cross-origin mutation rejected"}, status_code=403)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Cache-Control"] = "no-store"
        return response

    def get_run(ident):
        try:
            return store.run(ident)
        except KeyError:
            raise HTTPException(404, "Run not found")

    def completed(ident):
        run = get_run(ident)
        if run["state"] != "completed":
            raise HTTPException(409, "Run has no completed result")
        return run

    def artifact(ident, name):
        run = completed(ident)
        names = {a["name"]: a for a in run["manifest"]["artifacts"]}
        if name != "result.json" and name not in names:
            raise HTTPException(404, "Artifact not in immutable manifest")
        if not re.fullmatch(r"[A-Za-z0-9_.-]+", name) or name.startswith("."):
            raise HTTPException(400, "Invalid artifact name")
        directory = store.run_dir(ident)
        path = directory / name
        if path.is_symlink() or path.resolve().parent != directory.resolve() or not path.is_file():
            raise HTTPException(404, "Artifact is unavailable")
        if name in names:
            expected = names[name]
            if (
                path.stat().st_size != expected["bytes"]
                or hashlib.sha256(path.read_bytes()).hexdigest() != expected["sha256"]
            ):
                raise HTTPException(409, "Artifact integrity check failed")
        else:
            if json.loads(path.read_text(encoding="utf-8")) != run["manifest"]:
                raise HTTPException(409, "Result integrity check failed")
        return path

    @app.get("/api/health")
    def health():
        return {
            "status": "ok",
            "version": __version__,
            "stage": 1,
            "solver": "3d_vector_maxwell_staggered_yee_fdfd",
            "capabilities": ["forward", "raw_fields", "probe", "durable_jobs", "export"],
            "pending": [
                "calibrated_optical_ports",
                "adjoint",
                "optimization",
                "robustness",
                "3d_product_ui",
            ],
        }

    @app.get("/api/schema")
    def schema():
        return ExperimentSpec.model_json_schema()

    @app.post("/api/experiments", status_code=201)
    @app.post("/api/import", status_code=201)
    def create(spec: ExperimentSpec):
        return store.create_experiment(spec)

    @app.get("/api/experiments")
    def experiments():
        return store.experiments()

    @app.get("/api/experiments/{ident}")
    def experiment(ident: str):
        try:
            return store.experiment(ident)
        except KeyError:
            raise HTTPException(404, "Experiment not found")

    @app.post("/api/experiments/{ident}/runs", status_code=202)
    def run(ident: str):
        try:
            created = store.create_run(ident)
        except KeyError:
            raise HTTPException(404, "Experiment not found")
        except OverflowError as exc:
            raise HTTPException(429, str(exc))
        manager.notify()
        return created

    @app.get("/api/runs/{ident}")
    def result(ident: str):
        return get_run(ident)

    @app.post("/api/runs/{ident}/cancel")
    def cancel(ident: str):
        get_run(ident)
        store.event(ident, "cancelled", "cancelled", 0)
        manager.notify()
        return get_run(ident)

    @app.get("/api/runs/{ident}/events")
    async def events(ident: str, request: Request, after: int = Query(0, ge=0)):
        get_run(ident)
        try:
            cursor = max(after, int(request.headers.get("last-event-id", "0")))
        except ValueError:
            raise HTTPException(400, "Last-Event-ID must be an integer")
        if cursor < 0:
            raise HTTPException(400, "Last-Event-ID cannot be negative")

        async def stream():
            nonlocal cursor
            while not await request.is_disconnected():
                rows = store.events(ident, cursor)
                for row in rows:
                    cursor = row["id"]
                    yield f"id: {cursor}\nevent: state\ndata: {json.dumps(row, allow_nan=False)}\n\n"
                if get_run(ident)["state"] in TERMINAL:
                    return
                yield ": heartbeat\n\n"
                await asyncio.sleep(0.25)

        return StreamingResponse(stream(), media_type="text/event-stream")

    @app.get("/api/runs/{ident}/artifacts/{name}")
    def download(ident: str, name: str):
        return FileResponse(artifact(ident, name), filename=name)

    @app.get("/api/runs/{ident}/probe")
    def probe(ident: str, x: float, y: float, z: float):
        artifact(ident, "coefficients.npy")
        artifact(ident, "spec.json")
        from .solver import probe as evaluate

        try:
            return evaluate(store.run_dir(ident), (x, y, z))
        except ValueError as exc:
            raise HTTPException(422, str(exc))

    @app.get("/api/runs/{ident}/field")
    def field(
        ident: str,
        quantity: Literal["E", "H"] = "E",
        component: int = Query(1, ge=0, le=2),
        representation: Literal["real", "imag", "amplitude"] = "amplitude",
        max_points: int = Query(20000, ge=27, le=50000),
    ):
        path = artifact(ident, "fields.h5")
        import h5py
        import numpy as np

        with h5py.File(path, "r") as hf:
            shape = hf[f"{quantity}/real"].shape[:3]
            step = max(1, math.ceil((math.prod(shape) / max_points) ** (1 / 3)))
            while math.prod(math.ceil(n / step) for n in shape) > max_points:
                step += 1
            selection = (slice(None, None, step),) * 3 + (component,)
            real = hf[f"{quantity}/real"][selection]
            imag = hf[f"{quantity}/imag"][selection]
            values = {
                "real": lambda: real,
                "imag": lambda: imag,
                "amplitude": lambda: np.hypot(real, imag),
            }[representation]()
            return {
                "spec_hash": hf.attrs["spec_hash"],
                "axis_order": "x,y,z",
                "quantity": quantity,
                "component": "xyz"[component],
                "representation": representation,
                "unit": "V/m" if quantity == "E" else "A/m",
                "shape": list(values.shape),
                "axes_um": {a: hf[f"axes/{a}_um"][::step].tolist() for a in "xyz"},
                "values": values.ravel(order="C").tolist(),
                "sampling": "display sampling only; probes use original Yee grid",
            }

    @app.get("/api/runs/{ident}/export")
    def export(ident: str):
        run = completed(ident)
        names = [a["name"] for a in run["manifest"]["artifacts"]] + ["result.json"]
        paths = [artifact(ident, name) for name in names]
        if sum(p.stat().st_size for p in paths) > 128 * 1024**2:
            raise HTTPException(413, "Export exceeds 128 MiB")
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
            for path in paths:
                archive.write(path, arcname=path.name)
        output.seek(0)
        return StreamingResponse(
            output,
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="lightforge-{ident}.zip"'},
        )

    return app
