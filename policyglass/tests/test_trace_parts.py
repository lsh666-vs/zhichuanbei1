"""Exact immutable Trace projections, bounded reads and legacy concurrency."""

import hashlib
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from policyglass.agents import Learner
from policyglass.api import create_app
from policyglass.repository import Repository


def create_trace(root, config, monkeypatch=None, legacy=False):
    learner = Learner(config)
    try:
        document = next(trace for _, trace in learner.iteration(record=True) if trace)
        repo = Repository(root)
        experiment = repo.create(learner)
        origin = repo.save_checkpoint(learner, experiment["id"], state=learner.trace_origin_state)
        output = repo.save_checkpoint(learner, experiment["id"], state=learner.trace_result_state)
        if legacy:
            with monkeypatch.context() as patch:
                patch.setattr(repo, "_ensure_trace_parts", lambda *args, **kwargs: None)
                trace_id = repo.save_trace(document, experiment["id"], "f" * 32, origin, output)
        else:
            trace_id = repo.save_trace(document, experiment["id"], "f" * 32, origin, output)
        return repo, trace_id, repo.trace(trace_id)
    finally:
        learner.env.close()


def independent_descriptor(value):
    if isinstance(value, dict):
        return {key: independent_descriptor(item) for key, item in value.items()}
    if not isinstance(value, list):
        return value
    dimensions, first = [], value
    while isinstance(first, list):
        dimensions.append(len(first))
        first = first[0] if first else None
    if isinstance(first, (str, dict)):
        return [independent_descriptor(item) for item in value]
    return {"shape": dimensions, "dtype": "bool" if isinstance(first, bool) else "number"}


@pytest.mark.parametrize("algorithm", ["ppo", "sac"])
def test_every_projected_value_matches_real_trace_without_full_reads(
    tmp_path, small_config, monkeypatch, algorithm
):
    small_config.algorithm = algorithm
    repo, trace_id, document = create_trace(tmp_path / algorithm, small_config)
    source = repo._trace_path(trace_id)
    original = source.read_bytes()
    expected_index = {
        **{k: v for k, v in document.items() if k not in ("frames", "events", "batch")},
        "batch": independent_descriptor(document["batch"]),
        "events": [independent_descriptor(event) for event in document["events"]],
    }
    read_bytes = Path.read_bytes

    def no_full_read(path):
        if path == source:
            pytest.fail("Partial request reread the complete Trace")
        return read_bytes(path)

    with monkeypatch.context() as patch:
        patch.setattr(Path, "read_bytes", no_full_read)
        assert repo.trace_index(trace_id) == expected_index
        for index, event in enumerate(document["events"]):
            assert repo.trace_event(trace_id, index) == event
        assert repo.trace_frames(trace_id) == {
            "mode": "saved_actual_physics",
            "frames": document["frames"],
            "sample_ids": document["batch"]["sample_id"],
        }
        with TestClient(create_app(repo.root)) as client:
            assert client.get(f"/api/traces/{trace_id}/index").json() == expected_index
            for index, event in enumerate(document["events"]):
                response = client.get(f"/api/traces/{trace_id}/events/{index}")
                assert response.status_code == 200
                assert response.json() == event
            assert client.get(f"/api/traces/{trace_id}/frames").json() == repo.trace_frames(
                trace_id
            )
            assert client.get(f"/api/traces/{trace_id}/events/-1").status_code == 400
            assert (
                client.get(f"/api/traces/{trace_id}/events/{len(document['events'])}").status_code
                == 400
            )
    assert source.read_bytes() == original
    assert repo.trace(trace_id) == document


@pytest.mark.parametrize("part", ["manifest.json", "index.json", "frames.json", "event-0.json"])
def test_projection_tampering_is_rejected_without_silent_regeneration(tmp_path, small_config, part):
    repo, trace_id, _ = create_trace(tmp_path / part, small_config)
    path = repo._trace_path(trace_id, part)
    original = path.read_bytes()
    path.write_bytes(bytes([original[0] ^ 1]) + original[1:])
    method = (
        repo.trace_index
        if part in ("manifest.json", "index.json")
        else (
            repo.trace_frames
            if part == "frames.json"
            else lambda identifier: repo.trace_event(identifier, 0)
        )
    )
    with pytest.raises(ValueError, match="projection integrity"):
        method(trace_id)
    suffix = (
        "index"
        if part in ("manifest.json", "index.json")
        else "frames"
        if part == "frames.json"
        else "events/0"
    )
    with TestClient(create_app(repo.root)) as client:
        assert client.get(f"/api/traces/{trace_id}/{suffix}").status_code == 400
    assert path.read_bytes() != original
    assert repo.trace(trace_id)["mode"] == "actual_computation"


def test_projection_binding_and_source_changes_are_rejected(tmp_path, small_config):
    repo, trace_id, _ = create_trace(tmp_path / "binding", small_config)
    with repo.connect() as db:
        original = db.execute(
            "SELECT source_sha256 FROM trace_projections WHERE trace=?", (trace_id,)
        ).fetchone()[0]
        db.execute(
            "UPDATE trace_projections SET source_sha256=? WHERE trace=?", ("0" * 64, trace_id)
        )
    with pytest.raises(ValueError, match="source binding"):
        repo.trace_index(trace_id)
    with TestClient(create_app(repo.root)) as client:
        assert client.get(f"/api/traces/{trace_id}/index").status_code == 400
    with repo.connect() as db:
        db.execute(
            "UPDATE trace_projections SET source_sha256=? WHERE trace=?", (original, trace_id)
        )
    path = repo._trace_path(trace_id)
    before = path.stat()
    original_bytes = path.read_bytes()
    path.write_bytes(bytes([original_bytes[0] ^ 1]) + original_bytes[1:])
    os.utime(path, ns=(before.st_atime_ns, before.st_mtime_ns + 1_000_000_000))
    with pytest.raises(ValueError, match="changed after projection"):
        repo.trace_index(trace_id)
    with pytest.raises(ValueError, match="trace integrity"):
        repo.trace(trace_id)
    with TestClient(create_app(repo.root)) as client:
        assert client.get(f"/api/traces/{trace_id}/events/0").status_code == 400


def test_api_sends_exact_verified_utf8_without_dictionary_roundtrip(
    tmp_path, small_config, monkeypatch
):
    repo, trace_id, document = create_trace(tmp_path / "raw-response", small_config)
    expected = {
        "index": repo._trace_path(trace_id, "index.json").read_bytes(),
        "frames": repo._trace_path(trace_id, "frames.json").read_bytes(),
        "events/0": repo._trace_path(trace_id, "event-0.json").read_bytes(),
    }

    def no_dictionary_roundtrip(*args, **kwargs):
        pytest.fail("API used the dictionary projection interface instead of verified UTF8")

    monkeypatch.setattr(Repository, "_trace_part", no_dictionary_roundtrip)
    with TestClient(create_app(repo.root)) as client:
        for suffix, content in expected.items():
            response = client.get(f"/api/traces/{trace_id}/{suffix}")
            assert response.status_code == 200
            assert response.headers["content-type"] == "application/json"
            assert response.content == content
        assert client.get(f"/api/traces/{trace_id}/events/0").json() == document["events"][0]


def test_missing_projection_is_rejected_as_bad_artifact(tmp_path, small_config):
    repo, trace_id, _ = create_trace(tmp_path / "missing", small_config)
    path = repo._trace_path(trace_id, "event-0.json")
    assert path.is_relative_to(repo.root)
    path.unlink()
    with pytest.raises(ValueError, match="projection unavailable"):
        repo.trace_event(trace_id, 0)
    with TestClient(create_app(repo.root)) as client:
        assert client.get(f"/api/traces/{trace_id}/events/0").status_code == 400


def test_legacy_trace_migrates_once_under_concurrent_repository_readers(
    tmp_path, small_config, monkeypatch
):
    repo, trace_id, document = create_trace(
        tmp_path / "legacy", small_config, monkeypatch, legacy=True
    )
    raw_before = repo._trace_path(trace_id).read_bytes()
    readers = [Repository(repo.root) for _ in range(8)]
    original = Repository.trace
    counter = 0
    lock = threading.Lock()

    def counted_full_read(repository, identifier):
        nonlocal counter
        with lock:
            counter += 1
        time.sleep(0.025)
        return original(repository, identifier)

    monkeypatch.setattr(Repository, "trace", counted_full_read)

    def read(index):
        reader = readers[index]
        return reader.trace_event(trace_id, index % len(document["events"]))

    with ThreadPoolExecutor(max_workers=8) as executor:
        results = list(executor.map(read, range(8)))
    assert results == [document["events"][i % len(document["events"])] for i in range(8)]
    assert counter == 1
    with repo.connect() as db:
        assert (
            db.execute(
                "SELECT COUNT(*) FROM trace_projections WHERE trace=?", (trace_id,)
            ).fetchone()[0]
            == 1
        )
    assert repo._trace_path(trace_id).read_bytes() == raw_before
    assert hashlib.sha256(raw_before).hexdigest() == repo._trace_row(trace_id)["sha256"]


def test_corrupt_legacy_trace_does_not_publish_projections(tmp_path, small_config, monkeypatch):
    repo, trace_id, _ = create_trace(
        tmp_path / "corrupt-legacy", small_config, monkeypatch, legacy=True
    )
    path = repo._trace_path(trace_id)
    raw = path.read_bytes()
    path.write_bytes(bytes([raw[0] ^ 1]) + raw[1:])
    with pytest.raises(ValueError, match="trace integrity"):
        repo.trace_frames(trace_id)
    with repo.connect() as db:
        assert db.execute("SELECT COUNT(*) FROM trace_projections").fetchone()[0] == 0


def test_indices_identifiers_and_projection_boundaries_are_checked(
    tmp_path, small_config, monkeypatch
):
    repo, trace_id, document = create_trace(tmp_path / "bounds", small_config)
    for index in (-1, len(document["events"]), True, 1.5, "../escape"):
        with pytest.raises(ValueError, match="Event index"):
            repo.trace_event(trace_id, index)
    for invalid in ("../escape", "C:/escape", "a" * 31, "A" * 32):
        with pytest.raises(ValueError, match="identifier"):
            repo.trace_index(invalid)
    with pytest.raises(ValueError, match="projection name"):
        repo._trace_path(trace_id, "../escape.json")
    actual_resolve = Path.resolve
    selected = repo.root / "traces" / f"{trace_id}.parts" / "event-0.json"
    outside = tmp_path / "outside.json"

    def redirected(path, *args, **kwargs):
        return outside if path == selected else actual_resolve(path, *args, **kwargs)

    monkeypatch.setattr(Path, "resolve", redirected)
    with pytest.raises(ValueError, match="outside configured root"):
        repo.trace_event(trace_id, 0)
