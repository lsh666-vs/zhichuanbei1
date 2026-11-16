"""Bounded, cancellable read-only visualization work on immutable snapshots."""

import threading
import uuid
from concurrent.futures import ThreadPoolExecutor

from .experiments import loss_slice, q_slice
from .repository import identifier


class SliceJobs:
    def __init__(self, repository):
        self.repository = repository
        self.executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="policyglass-slice")
        self.lock = threading.RLock()
        self.jobs = {}

    def start(self, experiment, kind, options):
        source = self.repository.experiment(experiment)
        checkpoint = options.pop("checkpoint", None) or source["checkpoint"]
        if checkpoint not in {r["id"] for r in self.repository.checkpoints(experiment)}:
            raise ValueError("Checkpoint does not belong to experiment")
        with self.lock:
            if sum(j["status"] in ("queued", "running") for j in self.jobs.values()) >= 2:
                raise ValueError("Two slice computations already active")
            for key in list(self.jobs):
                if len(self.jobs) < 12:
                    break
                if self.jobs[key]["status"] not in ("queued", "running"):
                    del self.jobs[key]
            object_id = uuid.uuid4().hex
            self.jobs[object_id] = {
                "id": object_id,
                "experiment": experiment,
                "checkpoint": checkpoint,
                "kind": kind,
                "status": "queued",
                "cancel": threading.Event(),
                "result": None,
                "error": None,
            }
            self.executor.submit(self._run, object_id, options)
            return self.get(object_id)

    def _run(self, object_id, options):
        learner = None
        job = self.jobs[object_id]
        try:
            with self.lock:
                job["status"] = "running"
            learner = self.repository.learner(job["checkpoint"])
            if job["cancel"].is_set():
                raise InterruptedError("Slice cancelled")
            if job["kind"] == "q":
                result = q_slice(learner, **options)
            else:
                result = loss_slice(learner, **options, cancelled=job["cancel"].is_set)
            with self.lock:
                if job["cancel"].is_set():
                    job["status"] = "cancelled"
                else:
                    job.update(status="completed", result=result)
        except InterruptedError:
            with self.lock:
                job["status"] = "cancelled"
        except (ValueError, RuntimeError, KeyError, FloatingPointError, OSError, TypeError, IndexError) as exc:
            with self.lock:
                job.update(status="failed", error=str(exc)[:500])
        finally:
            if learner is not None:
                learner.env.close()

    def get(self, object_id):
        identifier(object_id)
        with self.lock:
            if object_id not in self.jobs:
                raise KeyError("Slice job missing or expired; recompute from checkpoint")
            return {k: v for k, v in self.jobs[object_id].items() if k != "cancel"}

    def cancel(self, object_id):
        with self.lock:
            self.get(object_id)
            self.jobs[object_id]["cancel"].set()
            return self.get(object_id)

    def close(self):
        with self.lock:
            for job in self.jobs.values():
                job["cancel"].set()
        self.executor.shutdown(wait=True, cancel_futures=True)
