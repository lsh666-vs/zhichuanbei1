"""Loopback API for exact numerical experiments. Final React UI belongs to Stage2."""

import asyncio
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

import numpy as np
import torch
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import Field
from starlette.middleware.trustedhost import TrustedHostMiddleware

from . import __version__
from .agents import Learner
from .checkpoint import MAX_BYTES, decode
from .config import ExperimentConfig, Intervention, StrictModel
from .environment import SpatialArm
from .experiments import actor_path_probe, branch, loss_slice, q_slice
from .jobs import JobManager
from .numerics import sample_policy, tensor, trace_policy_operation
from .physics_host import ENGINE_VERSION
from .repository import Repository
from .slice_jobs import SliceJobs, align_actor_critic
from .trace import Trace, plain

ALLOWED_ORIGINS = [
    "http://127.0.0.1:8787",
    "http://localhost:8787",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
]


class BodyLimitMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        maximum = MAX_BYTES + 1024 * 1024 if scope["path"] == "/api/import" else 2 * 1024 * 1024
        body, count = [], 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            count += len(chunk)
            if count > maximum:
                response = JSONResponse(
                    {"detail": "Request exceeds resource budget"}, status_code=413
                )
                return await response(scope, receive, send)
            body.append(chunk)
            if not message.get("more_body", False):
                break
        consumed = False

        async def replay():
            nonlocal consumed
            if consumed:
                return await receive()
            consumed = True
            return {"type": "http.request", "body": b"".join(body), "more_body": False}

        return await self.app(scope, replay, send)


class CreateRequest(StrictModel):
    label: str = Field("New experiment", min_length=1, max_length=120)
    config: ExperimentConfig = Field(default_factory=ExperimentConfig)


class JobRequest(StrictModel):
    iterations: int = Field(1, ge=1, le=100)
    record: bool = True
    mode: Literal["train", "fixed_batch"] = "train"


class BranchRequest(StrictModel):
    label: str = Field("Controlled branch", min_length=1, max_length=120)
    checkpoint: str | None = None
    intervention: Intervention


class QSliceRequest(StrictModel):
    axes: list[int] = Field(default_factory=lambda: [0, 1], min_length=2, max_length=2)
    fixed_action: list[float] = Field(default_factory=lambda: [0, 0, 0], min_length=3, max_length=3)
    observation: list[float] | None = Field(None, min_length=15, max_length=15)
    resolution: int = Field(21, ge=2, le=65)
    checkpoint: str | None = None


class LossSliceRequest(StrictModel):
    path_x: str = "actor/biases.2"
    index_x: list[int] = Field(default_factory=lambda: [0], min_length=1, max_length=2)
    path_y: str = "actor/biases.2"
    index_y: list[int] = Field(default_factory=lambda: [1], min_length=1, max_length=2)
    extent: float = Field(0.1, gt=0, le=1)
    resolution: int = Field(15, ge=2, le=31)
    checkpoint: str | None = None
    trace_id: str | None = None


class SliceJobRequest(StrictModel):
    kind: Literal["q", "loss"]
    q: QSliceRequest | None = None
    loss: LossSliceRequest | None = None


class PhysicsRequest(StrictModel):
    label: str = Field("Physical intervention", min_length=1, max_length=120)
    action: list[float] = Field(default_factory=lambda: [0, 0, 0], min_length=3, max_length=3)
    target: list[float] | None = Field(None, min_length=3, max_length=3)
    force_newtons: list[float] | None = Field(None, min_length=3, max_length=3)
    force_steps: int = Field(1, ge=1, le=128)
    steps: int = Field(1, ge=0, le=128)
    reset_environment: bool = False
    damping: float | None = Field(None, ge=0, le=5)
    mass_scale: float | None = Field(None, ge=0.25, le=3)


class PredictionRequest(StrictModel):
    observation: list[float] | None = Field(None, min_length=15, max_length=15)
    noise: list[float] = Field(default_factory=lambda: [0, 0, 0], min_length=3, max_length=3)
    checkpoint: str | None = None


class NotebookNote(StrictModel):
    text: str = Field(max_length=10000)
    prediction: str = Field("", max_length=4000)
    explanation: str = Field("", max_length=10000)
    course: int = Field(0, ge=0, le=8)
    experiment_id: str = Field(max_length=64)
    checkpoint: str = Field(max_length=64)
    trace_id: str = Field("", max_length=64)
    event_id: str = Field("", max_length=120)
    sample_id: int = Field(0, ge=0, le=100000000)
    created: str = Field(max_length=64)


class NotebookRequest(StrictModel):
    notes: list[NotebookNote] = Field(default_factory=list, max_length=500)


class EvaluationRequest(StrictModel):
    seeds: list[int] = Field(default_factory=lambda: [701, 702, 703], min_length=1, max_length=5)
    steps: int = Field(64, ge=1, le=256)
    checkpoint: str | None = None


def create_app(root=None):
    root = (
        root
        or os.environ.get("POLICYGLASS_DATA")
        or Path(__file__).resolve().parents[2] / ".runtime" / "data"
    )
    repository = Repository(root)
    manager = JobManager(repository)
    slices = SliceJobs(repository)

    @asynccontextmanager
    async def lifespan(_):
        yield
        manager.close()
        slices.close()

    app = FastAPI(title="PolicyGlass exact-computation API", version=__version__, lifespan=lifespan)
    app.state.repository, app.state.jobs = repository, manager
    app.add_middleware(BodyLimitMiddleware)
    app.add_middleware(
        TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "testserver", "[::1]"]
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )

    @app.middleware("http")
    async def validate_origin(request, call_next):
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            origin = request.headers.get("origin")
            if origin and origin not in ALLOWED_ORIGINS:
                return JSONResponse({"detail": "Untrusted origin"}, status_code=403)
        return await call_next(request)

    @app.exception_handler(ValueError)
    async def value_error(_, exc):
        return JSONResponse({"detail": str(exc)}, status_code=400)

    @app.exception_handler(KeyError)
    async def missing(_, exc):
        return JSONResponse({"detail": str(exc)}, status_code=404)

    @app.exception_handler(FloatingPointError)
    async def numerical_error(_, exc):
        return JSONResponse({"detail": str(exc)}, status_code=400)

    def load_experiment(experiment_id, checkpoint=None):
        experiment = repository.experiment(experiment_id)
        checkpoint = checkpoint or experiment["checkpoint"]
        if checkpoint not in {item["id"] for item in repository.checkpoints(experiment_id)}:
            raise ValueError("Checkpoint does not belong to this experiment")
        return experiment, repository.learner(checkpoint)

    @app.get("/api/health")
    def health():
        manager.reap()
        return {
            "status": "ok",
            "version": __version__,
            "mode": "cpu_float64",
            "physics": f"canonical_mujoco_wasm_{ENGINE_VERSION}",
            "stage": "2_integrated_teaching_workbench",
            "frontend_complete": (
                Path(__file__).resolve().parents[2] / "frontend/dist/index.html"
            ).is_file(),
            "release_complete": False,
        }

    @app.get("/api/schema")
    def schema():
        return ExperimentConfig.model_json_schema()

    @app.get("/api/experiments")
    def experiments():
        return repository.list_experiments()

    @app.post("/api/experiments", status_code=201)
    def create(request: CreateRequest):
        learner = Learner(request.config)
        try:
            return repository.create(learner, request.label)
        finally:
            learner.env.close()

    @app.get("/api/experiments/{experiment_id}")
    def experiment(experiment_id: str):
        result, learner = load_experiment(experiment_id)
        try:
            return {
                **result,
                "architecture": learner.architecture(),
                "geometry": learner.env.geometry(),
                "physics": learner.env.frame(),
                "observation": plain(learner.obs),
                "env_steps": learner.env_steps,
                "updates": learner.updates,
                "has_batch": learner.last_batch is not None,
                "observation_normalization": plain(
                    {
                        "kind": "fixed_physical_units_v1",
                        "mean": learner.observation_mean,
                        "scale": learner.observation_scale,
                    }
                ),
            }
        finally:
            learner.env.close()

    @app.get("/api/experiments/{experiment_id}/checkpoints")
    def checkpoints(experiment_id: str):
        return repository.checkpoints(experiment_id)

    @app.get("/api/experiments/{experiment_id}/parameters")
    def parameters(experiment_id: str):
        _, learner = load_experiment(experiment_id)
        try:
            return {
                name: plain(dict(model.named_parameters()))
                for name, model in learner.models.items()
            }
        finally:
            learner.env.close()

    @app.get("/api/experiments/{experiment_id}/notebook")
    def notebook(experiment_id: str):
        return repository.notebook(experiment_id)

    @app.post("/api/experiments/{experiment_id}/notebook")
    def save_notebook(experiment_id: str, request: NotebookRequest):
        return repository.save_notebook(experiment_id, request.model_dump())

    @app.post("/api/experiments/{experiment_id}/evaluate")
    def evaluate(experiment_id: str, request: EvaluationRequest):
        experiment, learner = load_experiment(experiment_id, request.checkpoint)
        started = time.perf_counter()
        rows = []
        try:
            for seed in request.seeds:
                if not 0 <= seed < 2**31:
                    raise ValueError("Evaluation seed outside budget")
                obs, _ = learner.env.reset(seed=seed)
                total, distances, frames = 0.0, [], []
                for _ in range(request.steps):
                    with torch.no_grad():
                        mu, _ = learner.models["actor"].distribution(
                            learner.encode_observation(tensor(obs).reshape(1, 15))
                        )
                        action = (torch.tanh(mu) * learner.scale)[0].numpy()
                    obs, reward, terminated, truncated, info = learner.env.step(action)
                    total += reward
                    distances.append(
                        float(
                            np.linalg.norm(np.array(info["physics"]["tip_m"]) - learner.env.target)
                        )
                    )
                    frames.append(info["physics"])
                    if terminated or truncated:
                        break
                rows.append(
                    {
                        "seed": seed,
                        "return": total,
                        "steps": len(distances),
                        "mean_distance_m": float(np.mean(distances)),
                        "final_distance_m": distances[-1],
                        "success_fraction": float(np.mean(np.array(distances) < 0.04)),
                        "frames": frames,
                    }
                )
            return {
                "source": "actual_frozen_policy_evaluation_no_learning",
                "checkpoint": request.checkpoint or experiment["checkpoint"],
                "action_rule": "tanh(mean)*physical_scale (deterministic)",
                "results": rows,
                "seconds": time.perf_counter() - started,
                "scope": "short budget; no trained-policy success claim",
            }
        finally:
            learner.env.close()

    @app.post("/api/experiments/{experiment_id}/actor-path-probe")
    def actor_paths(experiment_id: str, request: PredictionRequest):
        experiment, learner = load_experiment(experiment_id, request.checkpoint)
        try:
            return {
                **actor_path_probe(learner),
                "checkpoint": request.checkpoint or experiment["checkpoint"],
            }
        finally:
            learner.env.close()

    @app.post("/api/experiments/{experiment_id}/predict")
    def predict(experiment_id: str, request: PredictionRequest):
        experiment, learner = load_experiment(experiment_id, request.checkpoint)
        try:
            observation = (
                learner.obs if request.observation is None else tensor(request.observation)
            )
            noise = tensor(request.noise).reshape(1, 3)
            if float(observation.abs().max()) > 10000 or float(noise.abs().max()) > 10:
                raise ValueError("Interactive input outside numerical budget")
            trace = Trace(learner.config.algorithm, learner.updates)
            mu, logstd = learner.models["actor"].distribution(
                learner.encode_observation(observation.reshape(1, 15), trace), trace
            )
            action, logp, latent = sample_policy(mu, logstd, noise, learner.scale)
            trace_policy_operation(
                trace, "interactive_forward", mu, logstd, latent, logp, learner.scale, action, noise
            )
            trace.flush_layers(backward=False)
            result = trace.finish(
                phase="forward_only_no_parameter_update",
                observation=observation,
                noise=noise,
                action=action,
                logp=logp,
                architecture=learner.architecture(),
                scope="edited observations may be off the physical state manifold",
                batch={"sample_id": [0], "obs": [plain(observation)]},
                frames=[],
                sample_scope="interactive_input_row_not_environment_transition",
            )
            checkpoint = request.checkpoint or experiment["checkpoint"]
            trace_id = repository.save_trace(result, experiment_id, "", checkpoint, checkpoint)
            return {
                **result,
                "trace_id": trace_id,
                "origin_checkpoint": checkpoint,
                "output_checkpoint": checkpoint,
            }
        finally:
            learner.env.close()

    @app.post("/api/experiments/{experiment_id}/jobs", status_code=202)
    def start_job(experiment_id: str, request: JobRequest):
        return manager.start(experiment_id, request.iterations, request.record, request.mode)

    @app.get("/api/jobs/{job_id}")
    def job(job_id: str):
        manager.reap()
        return repository.job(job_id)

    @app.post("/api/jobs/{job_id}/control/{control}")
    def control(job_id: str, control: Literal["run", "pause", "cancel"]):
        return repository.control(job_id, control)

    @app.websocket("/api/jobs/{job_id}/events")
    async def job_events(websocket: WebSocket, job_id: str):
        origin = websocket.headers.get("origin")
        if origin and origin not in ALLOWED_ORIGINS:
            await websocket.close(code=1008)
            return
        try:
            repository.job(job_id)
        except (KeyError, ValueError):
            await websocket.close(code=1008)
            return
        await websocket.accept()
        previous = None
        try:
            while True:
                manager.reap()
                current = repository.job(job_id)
                if current != previous:
                    await websocket.send_json(current)
                    previous = current
                if current["status"] in ("completed", "cancelled", "failed"):
                    await websocket.close(code=1000)
                    break
                await asyncio.sleep(0.1)
        except WebSocketDisconnect:
            pass

    @app.get("/api/traces/{trace_id}")
    def trace(trace_id: str):
        return repository.trace(trace_id)

    @app.get("/api/experiments/{experiment_id}/traces")
    def traces(experiment_id: str):
        return repository.list_traces(experiment_id)

    @app.get("/api/traces/{trace_id}/index")
    def trace_index(trace_id: str):
        return repository.trace_index(trace_id)

    @app.get("/api/traces/{trace_id}/events/{event_index}")
    def trace_event(trace_id: str, event_index: int):
        document = repository.trace(trace_id)
        if not 0 <= event_index < len(document["events"]):
            raise ValueError("Event index outside trace")
        return document["events"][event_index]

    @app.get("/api/traces/{trace_id}/frames")
    def trace_frames(trace_id: str):
        document = repository.trace(trace_id)
        return {
            "mode": "saved_actual_physics",
            "frames": document["frames"],
            "sample_ids": document["batch"]["sample_id"],
        }

    @app.get("/api/traces/{trace_id}/rollout")
    def trace_rollout(trace_id: str):
        document = repository.trace(trace_id)
        learner = repository.learner(document["origin_checkpoint"])
        try:
            if learner.config.algorithm != "ppo":
                raise ValueError("Temporal GAE rollout view requires PPO")
            return {
                "schema": "policyglass.rollout.v1",
                "rollout": plain(learner.rollout),
                "frames": learner.rollout_frames,
                "selected_indices": plain(learner.last_batch_indices),
                "source": "actual_full_temporal_rollout_before_minibatch_selection",
            }
        finally:
            learner.env.close()

    @app.post("/api/experiments/{experiment_id}/branches", status_code=201)
    def create_branch(experiment_id: str, request: BranchRequest):
        experiment, learner = load_experiment(experiment_id, request.checkpoint)
        try:
            child = branch(learner, request.intervention)
            try:
                return repository.create(
                    child,
                    request.label,
                    parent=experiment_id,
                    parent_checkpoint=request.checkpoint or experiment["checkpoint"],
                    intervention=request.intervention.model_dump(),
                )
            finally:
                child.env.close()
        finally:
            learner.env.close()

    @app.post("/api/experiments/{experiment_id}/q-slice")
    def q_surface(experiment_id: str, request: QSliceRequest):
        _, learner = load_experiment(experiment_id, request.checkpoint)
        try:
            return q_slice(
                learner, request.axes, request.fixed_action, request.observation, request.resolution
            )
        finally:
            learner.env.close()

    @app.post("/api/experiments/{experiment_id}/slice-jobs", status_code=202)
    def start_slice(experiment_id: str, request: SliceJobRequest):
        options = request.q if request.kind == "q" else request.loss
        if options is None:
            raise ValueError("Matching bounded slice options required")
        return slices.start(experiment_id, request.kind, options.model_dump())

    @app.get("/api/slice-jobs/{object_id}")
    def get_slice(object_id: str):
        return slices.get(object_id)

    @app.post("/api/slice-jobs/{object_id}/cancel")
    def cancel_slice(object_id: str):
        return slices.cancel(object_id)

    @app.post("/api/experiments/{experiment_id}/loss-slice")
    def loss_surface(experiment_id: str, request: LossSliceRequest):
        experiment, learner = load_experiment(experiment_id, request.checkpoint)
        try:
            provenance = align_actor_critic(
                repository,
                learner,
                experiment_id,
                request.checkpoint or experiment["checkpoint"],
                request.trace_id,
            )
            result = loss_slice(
                learner,
                request.path_x,
                request.index_x,
                request.path_y,
                request.index_y,
                request.extent,
                request.resolution,
            )
            return {**result, **provenance}
        finally:
            learner.env.close()

    @app.post("/api/experiments/{experiment_id}/physics-branches", status_code=201)
    def physical_branch(experiment_id: str, request: PhysicsRequest):
        experiment, learner = load_experiment(experiment_id)
        try:
            if request.damping is not None or request.mass_scale is not None:
                if not request.reset_environment:
                    raise ValueError(
                        "Mass/damping changes require an explicitly recorded environment reset"
                    )
                config = learner.config.model_dump()
                for key in ("damping", "mass_scale"):
                    value = getattr(request, key)
                    if value is not None:
                        config["environment"][key] = value
                learner.config = ExperimentConfig.model_validate(config)
                learner.env.close()
                learner.env = SpatialArm(learner.config.environment)
                learner.obs = tensor(learner.env.reset(seed=learner.config.seed)[0])
                learner.replay_size = learner.replay_pointer = 0
                for value in (*learner.replay.values(), *learner.replay_physics.values()):
                    value.zero_()
            if request.target is not None:
                learner.env.set_target(request.target)
            if request.force_newtons is not None:
                learner.env.apply_force(request.force_newtons, request.force_steps)
            frames = []
            for _ in range(request.steps):
                _, _, _, _, frame = learner.transition(request.action)
                frames.append(frame)
            learner.obs = tensor(learner.env.observation())
            learner.last_batch = None  # physics edits invalidate a cached teaching batch
            learner.rollout = None
            learner.rollout_frames = []
            learner.last_batch_indices = None
            child = repository.create(
                learner,
                request.label,
                parent=experiment_id,
                parent_checkpoint=experiment["checkpoint"],
                intervention={"physics": request.model_dump()},
            )
            return {"experiment": child, "frames": frames, "physics": learner.env.frame()}
        finally:
            learner.env.close()

    @app.get("/api/checkpoints/{checkpoint_id}/download")
    def download(checkpoint_id: str):
        return Response(
            repository.checkpoint_bytes(checkpoint_id),
            media_type="application/octet-stream",
            headers={"Content-Disposition": f'attachment; filename="{checkpoint_id}.pgz"'},
        )

    @app.post("/api/import", status_code=201)
    async def import_checkpoint(request: Request):
        try:
            state, manifest = decode(await request.body())
            learner = await asyncio.to_thread(Learner.from_state, state)
        except (
            ValueError,
            RuntimeError,
            TypeError,
            IndexError,
            OverflowError,
            KeyError,
            AttributeError,
        ) as exc:
            raise HTTPException(
                status_code=400, detail=f"Invalid checkpoint: {type(exc).__name__}"
            ) from exc
        try:
            imported = await asyncio.to_thread(repository.create, learner, "Imported experiment")
            return {"experiment": imported, "source_manifest": manifest}
        finally:
            learner.env.close()

    frontend = Path(__file__).resolve().parents[2] / "frontend" / "dist"
    if (frontend / "index.html").is_file():
        app.mount("/", StaticFiles(directory=frontend, html=True), name="workbench")
    return app
