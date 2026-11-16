"""Local immutable artifacts and transactional experiment/job metadata."""

import hashlib
import json
import os
import re
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

from .agents import Learner
from .checkpoint import decode, encode, json_bytes
from .validation import validate_temperature


def identifier(value):
    if not re.fullmatch(r"[0-9a-f]{32}", value):
        raise ValueError("Invalid object identifier")
    return value


class Repository:
    def __init__(self, root):
        self.root = Path(root).resolve()
        if self.root.drive.upper() == "C:":
            raise ValueError("PolicyGlass may not write to C:")
        self.root.mkdir(parents=True, exist_ok=True)
        for folder in ("checkpoints", "traces"):
            (self.root / folder).mkdir(exist_ok=True)
        self.database = self.root / "policyglass.sqlite"
        with self.connect() as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS experiments(
                  id TEXT PRIMARY KEY, created REAL NOT NULL, label TEXT NOT NULL,
                  parent TEXT, parent_checkpoint TEXT, intervention TEXT,
                  checkpoint TEXT NOT NULL, config TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS checkpoints(
                  id TEXT PRIMARY KEY, experiment TEXT NOT NULL, created REAL NOT NULL,
                  sha256 TEXT NOT NULL, bytes INTEGER NOT NULL, env_steps INTEGER NOT NULL,
                  updates INTEGER NOT NULL, reason TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS jobs(
                  id TEXT PRIMARY KEY, experiment TEXT NOT NULL, created REAL NOT NULL,
                  status TEXT NOT NULL, control TEXT NOT NULL, iterations INTEGER NOT NULL,
                  completed INTEGER NOT NULL, mode TEXT NOT NULL, record INTEGER NOT NULL,
                  source_checkpoint TEXT NOT NULL, checkpoint TEXT NOT NULL,
                  trace TEXT, summary TEXT NOT NULL, error TEXT);
                CREATE TABLE IF NOT EXISTS traces(
                  id TEXT PRIMARY KEY, experiment TEXT NOT NULL, job TEXT NOT NULL,
                  created REAL NOT NULL, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL,
                  origin_checkpoint TEXT NOT NULL, output_checkpoint TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS notebooks(
                  experiment TEXT PRIMARY KEY, document TEXT NOT NULL);
            """)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.database, timeout=15)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def _atomic_write(self, path, blob):
        if len(blob) > 129 * 1024 * 1024:
            raise ValueError("Artifact exceeds budget")
        temporary = path.with_suffix(f".{uuid.uuid4().hex}.tmp")
        try:
            with temporary.open("xb") as stream:
                stream.write(blob)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)

    def save_checkpoint(self, learner, experiment, reason="update", state=None):
        identifier(experiment)
        state = learner.state() if state is None else state
        # Imported states receive full validation on load. Live states still
        # need this O(1) range guard before any file/DB commit; finite encoding
        # alone cannot reject an unreloadable (but finite) SAC temperature.
        if state["config"]["algorithm"] == "sac":
            validate_temperature(state["log_alpha"])
        blob = encode(state)
        object_id = uuid.uuid4().hex
        self._atomic_write(self.root / "checkpoints" / f"{object_id}.pgz", blob)
        with self.connect() as db:
            db.execute(
                "INSERT INTO checkpoints VALUES(?,?,?,?,?,?,?,?)",
                (
                    object_id,
                    experiment,
                    time.time(),
                    hashlib.sha256(blob).hexdigest(),
                    len(blob),
                    state["env_steps"],
                    state["updates"],
                    reason,
                ),
            )
        return object_id

    def checkpoint_bytes(self, checkpoint):
        identifier(checkpoint)
        with self.connect() as db:
            row = db.execute("SELECT * FROM checkpoints WHERE id=?", (checkpoint,)).fetchone()
        if row is None:
            raise KeyError("Checkpoint not found")
        path = self.root / "checkpoints" / f"{checkpoint}.pgz"
        if path.stat().st_size != row["bytes"]:
            raise ValueError("Stored checkpoint size mismatch")
        blob = path.read_bytes()
        if hashlib.sha256(blob).hexdigest() != row["sha256"]:
            raise ValueError("Stored checkpoint integrity mismatch")
        return blob

    def learner(self, checkpoint):
        state, _ = decode(self.checkpoint_bytes(checkpoint))
        return Learner.from_state(state)

    def create(
        self,
        learner,
        label="Untitled experiment",
        parent=None,
        parent_checkpoint=None,
        intervention=None,
    ):
        if not 1 <= len(label) <= 120:
            raise ValueError("Label must be 1..120 characters")
        object_id = uuid.uuid4().hex
        checkpoint = self.save_checkpoint(
            learner, object_id, "initial" if parent is None else "branch"
        )
        with self.connect() as db:
            db.execute(
                "INSERT INTO experiments VALUES(?,?,?,?,?,?,?,?)",
                (
                    object_id,
                    time.time(),
                    label,
                    parent,
                    parent_checkpoint,
                    json.dumps(intervention) if intervention is not None else None,
                    checkpoint,
                    json.dumps(learner.config.model_dump()),
                ),
            )
        return self.experiment(object_id)

    def experiment(self, experiment):
        identifier(experiment)
        with self.connect() as db:
            row = db.execute("SELECT * FROM experiments WHERE id=?", (experiment,)).fetchone()
        if row is None:
            raise KeyError("Experiment not found")
        result = dict(row)
        result["config"] = json.loads(result["config"])
        if result["intervention"] is not None:
            result["intervention"] = json.loads(result["intervention"])
        return result

    def list_experiments(self):
        with self.connect() as db:
            ids = db.execute(
                "SELECT id FROM experiments ORDER BY created DESC LIMIT 200"
            ).fetchall()
        return [self.experiment(row["id"]) for row in ids]

    def checkpoints(self, experiment):
        self.experiment(experiment)
        with self.connect() as db:
            return [
                dict(row)
                for row in db.execute(
                    "SELECT * FROM checkpoints WHERE experiment=? ORDER BY created", (experiment,)
                )
            ]

    def create_job(self, experiment, iterations, record, mode):
        self.experiment(experiment)
        if not 1 <= iterations <= 100 or mode not in ("train", "fixed_batch"):
            raise ValueError("Invalid job budget or mode")
        object_id = uuid.uuid4().hex
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            active = db.execute(
                "SELECT experiment FROM jobs WHERE status IN ('queued','running','paused')"
            ).fetchall()
            if len(active) >= 2 or any(row["experiment"] == experiment for row in active):
                raise ValueError("An active job already exists, or two-job capacity reached")
            checkpoint = db.execute(
                "SELECT checkpoint FROM experiments WHERE id=?", (experiment,)
            ).fetchone()[0]
            db.execute(
                "INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    object_id,
                    experiment,
                    time.time(),
                    "queued",
                    "run",
                    iterations,
                    0,
                    mode,
                    int(record),
                    checkpoint,
                    checkpoint,
                    None,
                    "[]",
                    None,
                ),
            )
        return self.job(object_id)

    def job(self, job):
        identifier(job)
        with self.connect() as db:
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job,)).fetchone()
        if row is None:
            raise KeyError("Job not found")
        result = dict(row)
        result["summary"] = json.loads(result["summary"])
        return result

    def control(self, job, control):
        current = self.job(job)
        if control not in ("run", "pause", "cancel"):
            raise ValueError("Invalid control")
        if current["status"] not in ("queued", "running", "paused"):
            raise ValueError("Task already finished; start a new task from its checkpoint")
        with self.connect() as db:
            db.execute("UPDATE jobs SET control=? WHERE id=?", (control, job))
        return self.job(job)

    def save_trace(self, trace, experiment, job, origin, output):
        object_id = uuid.uuid4().hex
        trace = {
            **trace,
            "experiment_id": experiment,
            "job_id": job or None,
            "origin_checkpoint": origin,
            "output_checkpoint": output,
        }
        blob = json_bytes(trace)
        if len(blob) > 64 * 1024 * 1024:
            raise ValueError("Trace exceeds 64 MiB budget")
        self._atomic_write(self.root / "traces" / f"{object_id}.json", blob)
        with self.connect() as db:
            db.execute(
                "INSERT INTO traces VALUES(?,?,?,?,?,?,?,?)",
                (
                    object_id,
                    experiment,
                    job,
                    time.time(),
                    hashlib.sha256(blob).hexdigest(),
                    len(blob),
                    origin,
                    output,
                ),
            )
        return object_id

    def trace(self, trace):
        identifier(trace)
        with self.connect() as db:
            row = db.execute("SELECT * FROM traces WHERE id=?", (trace,)).fetchone()
        if row is None:
            raise KeyError("Trace not found")
        path = self.root / "traces" / f"{trace}.json"
        if path.stat().st_size != row["bytes"]:
            raise ValueError("Stored trace size mismatch")
        blob = path.read_bytes()
        if hashlib.sha256(blob).hexdigest() != row["sha256"]:
            raise ValueError("Stored trace integrity mismatch")
        return json.loads(blob)

    def trace_index(self, trace):
        document = self.trace(trace)

        def descriptor(value):
            if isinstance(value, list):
                shape = []
                current = value
                while isinstance(current, list):
                    shape.append(len(current))
                    current = current[0] if current else None
                if isinstance(current, (str, dict)):
                    return [descriptor(item) for item in value]
                return {"shape": shape, "dtype": "bool" if isinstance(current, bool) else "number"}
            if isinstance(value, dict):
                return {key: descriptor(item) for key, item in value.items()}
            return value

        return {
            **{
                key: value
                for key, value in document.items()
                if key not in ("frames", "events", "batch")
            },
            "batch": descriptor(document["batch"]),
            "events": [descriptor(event) for event in document["events"]],
        }

    def list_traces(self, experiment):
        self.experiment(experiment)
        with self.connect() as db:
            return [
                dict(row)
                for row in db.execute(
                    "SELECT * FROM traces WHERE experiment=? ORDER BY created", (experiment,)
                )
            ]

    def notebook(self, experiment):
        self.experiment(experiment)
        with self.connect() as db:
            row = db.execute(
                "SELECT document FROM notebooks WHERE experiment=?", (experiment,)
            ).fetchone()
        return json.loads(row[0]) if row else {"notes": []}

    def save_notebook(self, experiment, document):
        self.experiment(experiment)
        with self.connect() as db:
            db.execute(
                "INSERT INTO notebooks VALUES(?,?) ON CONFLICT(experiment) DO UPDATE SET document=excluded.document",
                (experiment, json.dumps(document, ensure_ascii=False, allow_nan=False)),
            )
        return document
