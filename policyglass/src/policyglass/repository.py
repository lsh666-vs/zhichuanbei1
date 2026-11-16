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

from filelock import FileLock

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
                CREATE TABLE IF NOT EXISTS trace_projections(
                  trace TEXT PRIMARY KEY, source_sha256 TEXT NOT NULL,
                  manifest_sha256 TEXT NOT NULL, manifest_bytes INTEGER NOT NULL);
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
        self._atomic_write(self._trace_path(object_id), blob)
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
        self._ensure_trace_parts(object_id, document=trace)
        return object_id

    def _contained(self, path):
        resolved = path.resolve()
        if resolved.drive.upper() == "C:" or not resolved.is_relative_to(self.root):
            raise ValueError("Trace artifact path outside configured root")
        return resolved

    def _trace_path(self, trace, part=None):
        identifier(trace)
        base = self.root / "traces"
        if part is None:
            return self._contained(base / f"{trace}.json")
        if not re.fullmatch(r"(?:index|frames|manifest|event-[0-9]+)\.json", part):
            raise ValueError("Invalid trace projection name")
        return self._contained(base / f"{trace}.parts" / part)

    def _trace_row(self, trace):
        identifier(trace)
        with self.connect() as db:
            row = db.execute("SELECT * FROM traces WHERE id=?", (trace,)).fetchone()
        if row is None:
            raise KeyError("Trace not found")
        return row

    @staticmethod
    def _source_fingerprint(path):
        try:
            stat = path.stat()
        except OSError as exc:
            raise ValueError("Stored trace source unavailable") from exc
        return {"bytes": stat.st_size, "mtime_ns": stat.st_mtime_ns, "ctime_ns": stat.st_ctime_ns}

    @staticmethod
    def _verified_bytes(path, record, maximum):
        size = record["bytes"]
        try:
            if type(size) is not int or not 0 <= size <= maximum or path.stat().st_size != size:
                raise ValueError("Stored trace projection size mismatch")
            blob = path.read_bytes()
        except OSError as exc:
            raise ValueError("Stored trace projection unavailable") from exc
        if len(blob) != size or hashlib.sha256(blob).hexdigest() != record["sha256"]:
            raise ValueError("Stored trace projection integrity mismatch")
        return blob

    @staticmethod
    def _verified_json(path, record, maximum):
        return json.loads(Repository._verified_bytes(path, record, maximum))

    def _ensure_trace_parts(self, trace, document=None):
        identifier(trace)
        with self.connect() as db:
            if db.execute("SELECT 1 FROM trace_projections WHERE trace=?", (trace,)).fetchone():
                return
        lock = self._contained(self.root / "traces" / f"{trace}.projection.lock")
        with FileLock(str(lock), timeout=30):
            with self.connect() as db:
                if db.execute("SELECT 1 FROM trace_projections WHERE trace=?", (trace,)).fetchone():
                    return
            source = self._trace_row(trace)
            # Legacy objects are verified in full exactly once before derivation.
            # The save path supplies its actual just-serialized document instead.
            document = self.trace(trace) if document is None else document
            if not isinstance(document.get("events"), list) or len(document["events"]) > 10000:
                raise ValueError("Trace event count exceeds projection budget")
            source_path = self._trace_path(trace)
            fingerprint = self._source_fingerprint(source_path)
            if fingerprint["bytes"] != source["bytes"]:
                raise ValueError("Stored trace size mismatch")
            folder = self._contained(self.root / "traces" / f"{trace}.parts")
            folder.mkdir(exist_ok=True)
            files = {}

            def write_part(name, value):
                blob = json_bytes(value)
                self._atomic_write(self._trace_path(trace, name), blob)
                files[name] = {"sha256": hashlib.sha256(blob).hexdigest(), "bytes": len(blob)}

            write_part("index.json", self._describe_trace(document))
            write_part(
                "frames.json",
                {
                    "mode": "saved_actual_physics",
                    "frames": document["frames"],
                    "sample_ids": document["batch"]["sample_id"],
                },
            )
            for index, event in enumerate(document["events"]):
                write_part(f"event-{index}.json", event)
            if self._source_fingerprint(source_path) != fingerprint:
                raise ValueError("Stored trace changed during projection creation")
            manifest = json_bytes(
                {
                    "schema": "policyglass.trace-projections.v1",
                    "trace": trace,
                    "source_sha256": source["sha256"],
                    "source_fingerprint": fingerprint,
                    "event_count": len(document["events"]),
                    "files": files,
                }
            )
            if len(manifest) > 2 * 1024 * 1024:
                raise ValueError("Trace projection manifest exceeds budget")
            self._atomic_write(self._trace_path(trace, "manifest.json"), manifest)
            # Publish only after all complete atomic files exist; no partial row
            # is observable. Concurrent legacy readers share the same file lock.
            with self.connect() as db:
                db.execute(
                    "INSERT INTO trace_projections VALUES(?,?,?,?)",
                    (trace, source["sha256"], hashlib.sha256(manifest).hexdigest(), len(manifest)),
                )

    def _trace_part_bytes(self, trace, name=None, event_index=None):
        source = self._trace_row(trace)
        self._ensure_trace_parts(trace)
        with self.connect() as db:
            record = db.execute(
                "SELECT * FROM trace_projections WHERE trace=?", (trace,)
            ).fetchone()
        if record["source_sha256"] != source["sha256"]:
            raise ValueError("Trace projection source binding mismatch")
        manifest = self._verified_json(
            self._trace_path(trace, "manifest.json"),
            {"sha256": record["manifest_sha256"], "bytes": record["manifest_bytes"]},
            2 * 1024 * 1024,
        )
        if (
            manifest.get("schema") != "policyglass.trace-projections.v1"
            or manifest.get("trace") != trace
            or manifest.get("source_sha256") != source["sha256"]
        ):
            raise ValueError("Trace projection source binding mismatch")
        count = manifest.get("event_count")
        if type(count) is not int or not 0 <= count <= 10000:
            raise ValueError("Invalid trace projection event count")
        expected = {"index.json", "frames.json"} | {f"event-{i}.json" for i in range(count)}
        if set(manifest["files"]) != expected:
            raise ValueError("Unexpected trace projection entries")
        # Projections are bound to the immutable original SHA in SQLite. A cheap
        # stat guard additionally rejects ordinary source changes without reading
        # 12MB on every partial request. Full reads always rehash the original.
        if self._source_fingerprint(self._trace_path(trace)) != manifest["source_fingerprint"]:
            raise ValueError("Stored trace changed after projection creation")
        if event_index is not None:
            if type(event_index) is not int or not 0 <= event_index < count:
                raise ValueError("Event index outside trace")
            name = f"event-{event_index}.json"
        return self._verified_bytes(
            self._trace_path(trace, name), manifest["files"][name], 64 * 1024 * 1024
        )

    def _trace_part(self, trace, name=None, event_index=None):
        return json.loads(self._trace_part_bytes(trace, name, event_index))

    def trace(self, trace):
        row = self._trace_row(trace)
        path = self._trace_path(trace)
        if path.stat().st_size != row["bytes"]:
            raise ValueError("Stored trace size mismatch")
        blob = path.read_bytes()
        if hashlib.sha256(blob).hexdigest() != row["sha256"]:
            raise ValueError("Stored trace integrity mismatch")
        return json.loads(blob)

    def trace_index(self, trace):
        return self._trace_part(trace, "index.json")

    def trace_index_bytes(self, trace):
        return self._trace_part_bytes(trace, "index.json")

    def trace_event(self, trace, event_index):
        if type(event_index) is not int or event_index < 0:
            raise ValueError("Event index outside trace")
        return self._trace_part(trace, event_index=event_index)

    def trace_event_bytes(self, trace, event_index):
        if type(event_index) is not int or event_index < 0:
            raise ValueError("Event index outside trace")
        return self._trace_part_bytes(trace, event_index=event_index)

    def trace_frames(self, trace):
        return self._trace_part(trace, "frames.json")

    def trace_frames_bytes(self, trace):
        return self._trace_part_bytes(trace, "frames.json")

    @staticmethod
    def _describe_trace(document):
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
