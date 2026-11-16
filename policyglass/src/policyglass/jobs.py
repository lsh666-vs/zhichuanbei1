"""Spawned numerical workers; pause/cancel only at committed iteration boundaries."""

import json
import multiprocessing
import threading
import time
from functools import wraps

from filelock import FileLock, Timeout

from .repository import Repository


def worker(root, job_id):
    repository = Repository(root)
    learner = None
    try:
        job = repository.job(job_id)
        learner = repository.learner(job["source_checkpoint"])
        summaries = []
        for iteration in range(job["iterations"]):
            while True:
                control = repository.job(job_id)["control"]
                if control == "cancel":
                    with repository.connect() as db:
                        db.execute("UPDATE jobs SET status='cancelled' WHERE id=?", (job_id,))
                    return
                with repository.connect() as db:
                    db.execute(
                        "UPDATE jobs SET status=? WHERE id=?",
                        ("paused" if control == "pause" else "running", job_id),
                    )
                if control == "run":
                    break
                time.sleep(0.05)
            record = bool(job["record"]) and iteration == 0
            if job["mode"] == "fixed_batch":
                if learner.last_batch is None:
                    raise ValueError("Fixed-batch mode needs an existing real rollout/replay batch")
                origin_state = learner.state() if record else None
                result = [
                    getattr(learner, f"update_{learner.config.algorithm}")(
                        learner.last_batch, record=record
                    )
                ]
            else:
                result = learner.iteration(record=record)
                origin_state = learner.trace_origin_state if record else None
            output = repository.save_checkpoint(learner, job["experiment"], "iteration")
            trace_id = None
            if record:
                origin = repository.save_checkpoint(
                    learner, job["experiment"], "trace_origin", state=origin_state
                )
                trace_output = (
                    output
                    if job["mode"] == "fixed_batch"
                    else repository.save_checkpoint(
                        learner, job["experiment"], "trace_output", state=learner.trace_result_state
                    )
                )
                trace = next(trace for _, trace in result if trace is not None)
                trace_id = repository.save_trace(
                    trace, job["experiment"], job_id, origin, trace_output
                )
            summaries.extend(summary for summary, _ in result)
            with repository.connect() as db:
                db.execute(
                    "UPDATE experiments SET checkpoint=? WHERE id=?", (output, job["experiment"])
                )
                db.execute(
                    "UPDATE jobs SET completed=?,checkpoint=?,trace=COALESCE(?,trace),summary=? WHERE id=?",
                    (
                        iteration + 1,
                        output,
                        trace_id,
                        json.dumps(summaries, allow_nan=False),
                        job_id,
                    ),
                )
        with repository.connect() as db:
            control = db.execute("SELECT control FROM jobs WHERE id=?", (job_id,)).fetchone()[0]
            db.execute(
                "UPDATE jobs SET status=? WHERE id=?",
                ("cancelled" if control == "cancel" else "completed", job_id),
            )
    except Exception as exc:  # noqa: BLE001 -- process boundary persists failure instead of reporting success
        with repository.connect() as db:
            db.execute(
                "UPDATE jobs SET status='failed',error=? WHERE id=?",
                (f"{type(exc).__name__}: {str(exc)[:500]}", job_id),
            )
    finally:
        if learner is not None:
            learner.env.close()
        # Do not leave a Node child alive after a worker exits.
        from . import physics_host

        if physics_host._host is not None:
            physics_host._host.close()


def synchronized(method):
    @wraps(method)
    def wrapped(self, *args, **kwargs):
        with self.lock:
            return method(self, *args, **kwargs)

    return wrapped


class JobManager:
    def __init__(self, repository):
        self.repository = repository
        self.processes = {}
        self.lock = threading.RLock()
        # Factory and ASGI lifespan may run on different threads.
        self.store_lock = FileLock(repository.root / "server.lock", thread_local=False)
        try:
            self.store_lock.acquire(timeout=0)
        except Timeout as exc:
            raise ValueError("Another server already owns this experiment store") from exc
        with repository.connect() as db:
            db.execute(
                "UPDATE jobs SET status='failed',error='Server restarted; resume from last committed checkpoint' WHERE status IN ('queued','running','paused')"
            )

    @synchronized
    def start(self, experiment, iterations=1, record=True, mode="train"):
        self.reap()
        job = self.repository.create_job(experiment, iterations, record, mode)
        process = multiprocessing.get_context("spawn").Process(
            target=worker, args=(str(self.repository.root), job["id"]), daemon=False
        )
        try:
            process.start()
        except Exception as exc:
            with self.repository.connect() as db:
                db.execute(
                    "UPDATE jobs SET status='failed',error=? WHERE id=?",
                    (str(exc)[:500], job["id"]),
                )
            raise
        self.processes[job["id"]] = process
        return job

    @synchronized
    def reap(self):
        for job_id, process in list(self.processes.items()):
            if not process.is_alive():
                process.join(timeout=0)
                if self.repository.job(job_id)["status"] in ("queued", "running", "paused"):
                    with self.repository.connect() as db:
                        db.execute(
                            "UPDATE jobs SET status='failed',error='Worker exited before a complete commit' WHERE id=?",
                            (job_id,),
                        )
                process.close()
                del self.processes[job_id]

    @synchronized
    def close(self):
        for job_id in self.processes:
            try:
                self.repository.control(job_id, "cancel")
            except ValueError:
                pass
        for process in self.processes.values():
            process.join(timeout=10)
            if process.is_alive():
                process.terminate()
                process.join(timeout=3)
            process.close()
        self.processes.clear()
        self.store_lock.release()
