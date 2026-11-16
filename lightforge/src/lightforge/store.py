"""Small transactional repository. Every run belongs to an immutable input snapshot."""

from __future__ import annotations

import json
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

from .models import ExperimentSpec

TERMINAL = {"completed", "failed", "cancelled"}


class Store:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.db = self.root / "experiments.sqlite"
        with self.connect() as db:
            db.executescript("""
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS experiments(
              id TEXT PRIMARY KEY, created REAL NOT NULL, spec TEXT NOT NULL, hash TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS runs(
              id TEXT PRIMARY KEY, experiment_id TEXT NOT NULL REFERENCES experiments(id),
              state TEXT NOT NULL, created REAL NOT NULL, updated REAL NOT NULL,
              stage TEXT NOT NULL, progress REAL NOT NULL, error TEXT, manifest TEXT);
            CREATE TABLE IF NOT EXISTS events(
              id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES runs(id),
              created REAL NOT NULL, payload TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS events_by_run ON events(run_id,id);
            """)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.db, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            with db:
                yield db
        finally:
            db.close()

    def create_experiment(self, spec: ExperimentSpec):
        ident = uuid.uuid4().hex
        with self.connect() as db:
            db.execute(
                "INSERT INTO experiments VALUES(?,?,?,?)",
                (ident, time.time(), spec.canonical_json(), spec.spec_hash),
            )
        return self.experiment(ident)

    def experiment(self, ident):
        with self.connect() as db:
            row = db.execute("SELECT * FROM experiments WHERE id=?", (ident,)).fetchone()
        if row is None:
            raise KeyError(ident)
        result = dict(row)
        result["spec"] = json.loads(result["spec"])
        return result

    def experiments(self):
        with self.connect() as db:
            rows = db.execute(
                "SELECT id,created,hash,spec FROM experiments ORDER BY created DESC LIMIT 200"
            ).fetchall()
        return [{**dict(r), "spec": json.loads(r["spec"])} for r in rows]

    def create_run(self, experiment_id):
        self.experiment(experiment_id)
        ident = uuid.uuid4().hex
        now = time.time()
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            count = db.execute(
                "SELECT count(*) FROM runs WHERE state IN ('queued','running')"
            ).fetchone()[0]
            if count >= 8:
                raise OverflowError("calculation queue is full (8 jobs)")
            db.execute(
                "INSERT INTO runs(id,experiment_id,state,created,updated,stage,progress,error,manifest) VALUES(?,?,?,?,?,?,?,?,?)",
                (ident, experiment_id, "queued", now, now, "queued", 0, None, None),
            )
            db.execute(
                "INSERT INTO events(run_id,created,payload) VALUES(?,?,?)",
                (
                    ident,
                    now,
                    json.dumps(
                        {"state": "queued", "stage": "queued", "progress": 0, "error": None}
                    ),
                ),
            )
            # Explicit column names keep schema evolution independent of tuple positions.
        return self.run(ident)

    def run(self, ident):
        with self.connect() as db:
            row = db.execute("SELECT * FROM runs WHERE id=?", (ident,)).fetchone()
        if row is None:
            raise KeyError(ident)
        result = dict(row)
        result["manifest"] = json.loads(result["manifest"]) if result["manifest"] else None
        return result

    def event(self, ident, state, stage, progress, *, error=None, manifest=None):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            previous = db.execute("SELECT state FROM runs WHERE id=?", (ident,)).fetchone()
            if previous is None:
                raise KeyError(ident)
            if previous["state"] in TERMINAL:
                return False
            if state not in {"queued", "running", *TERMINAL}:
                raise ValueError("Invalid run state")
            if previous["state"] == "running" and state == "queued":
                return False
            now = time.time()
            payload = {"state": state, "stage": stage, "progress": progress, "error": error}
            db.execute(
                "UPDATE runs SET state=?,updated=?,stage=?,progress=?,error=?,manifest=? WHERE id=?",
                (
                    state,
                    now,
                    stage,
                    progress,
                    error,
                    json.dumps(manifest) if manifest else None,
                    ident,
                ),
            )
            db.execute(
                "INSERT INTO events(run_id,created,payload) VALUES(?,?,?)",
                (ident, now, json.dumps(payload, allow_nan=False)),
            )
        return True

    def events(self, ident, after=0):
        self.run(ident)
        with self.connect() as db:
            rows = db.execute(
                "SELECT id,created,payload FROM events WHERE run_id=? AND id>? ORDER BY id",
                (ident, after),
            ).fetchall()
        return [{"id": r["id"], "created": r["created"], **json.loads(r["payload"])} for r in rows]

    def queued(self):
        with self.connect() as db:
            return [
                r[0]
                for r in db.execute("SELECT id FROM runs WHERE state='queued' ORDER BY created")
            ]

    def recover(self):
        with self.connect() as db:
            ids = [r[0] for r in db.execute("SELECT id FROM runs WHERE state='running'")]
        for ident in ids:
            self.event(
                ident,
                "failed",
                "interrupted",
                0,
                error="Server stopped during calculation; create a new run from the saved input.",
            )

    def run_dir(self, ident):
        if len(ident) != 32 or any(c not in "0123456789abcdef" for c in ident):
            raise KeyError(ident)
        path = self.root / "runs" / ident
        if not path.resolve().is_relative_to(self.root):
            raise ValueError("run directory escapes data root")
        return path
