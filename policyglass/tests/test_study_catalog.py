"""Mock-free local study routes with a small actual learner.

The test-only six-interaction fixture is not a row in the formal 20-run study.
"""

import copy
import hashlib
import json

import pytest
import torch
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from policyglass.agents import Learner
from policyglass.checkpoint import decode, encode
from policyglass.config import ExperimentConfig
from policyglass.repository import Repository
from policyglass.studies import evaluate
from policyglass.study_catalog import CONDITIONS, SEEDS, install_study_catalog


@pytest.fixture
def study_fixture(tmp_path, small_config):
    project = tmp_path / "test-only-study"
    (project / "evidence").mkdir(parents=True)
    (project / "docs").mkdir()
    repository = Repository(tmp_path / "catalog-store")
    config = ExperimentConfig.model_validate({**small_config.model_dump(), "seed": 11})
    learner = Learner(config)
    try:
        existing = repository.create(learner, "Existing experiment stays unchanged")
        initial = evaluate(learner, [701, 702, 703, 704, 705], 8)
        learner.iteration(record=False)
        final = evaluate(learner, [701, 702, 703, 704, 705], 8)
        state = learner.state()
        blob = encode(state)
    finally:
        learner.env.close()
    conditions = []
    for name in CONDITIONS:
        row = {
            "name": name,
            "algorithm": "ppo" if name.startswith("ppo") else "sac",
            "environment_steps": 6,
        }
        row["learning_rate" if name.startswith("ppo") else "updates_per_step"] = (
            (0.05 if name == "ppo_large_step" else 0.0003)
            if name.startswith("ppo")
            else (4 if name == "sac_reuse4" else 1)
        )
        conditions.append(row)
    protocol = {
        "schema": "policyglass.study.v1",
        "test_only": True,
        "training_seeds": list(SEEDS),
        "evaluation_seeds": [701, 702, 703, 704, 705],
        "evaluation_steps": 8,
        "network": [4, 4],
        "conditions": conditions,
    }
    metrics = {
        "seed": 11,
        "env_steps": state["env_steps"],
        "updates": state["updates"],
        "seconds": 0.1,
        "initial_mean_distance_m": sum(row["mean_distance_m"] for row in initial) / 5,
        **{
            key: sum(row[key] for row in final) / 5
            for key in ("mean_distance_m", "last32_distance_m", "return", "success_fraction")
        },
    }
    run = {
        "condition": "ppo_reference",
        "seed": 11,
        "status": "completed",
        "pilot": False,
        "env_steps": state["env_steps"],
        "updates": state["updates"],
        "seconds": 0.1,
        "checkpoint_sha256": hashlib.sha256(blob).hexdigest(),
        "curve": [{"evaluation": initial}, {"evaluation": final}],
    }
    document = {
        "schema": "policyglass.study-results.v1",
        "protocol": protocol,
        "runs": [
            run,
            {
                "condition": "ppo_reference",
                "seed": 23,
                "status": "failed",
                "error": "Test-only deliberate failed record; never part of formal research",
            },
        ],
        "summary": {"ppo_reference": {"per_seed": [metrics]}},
    }
    (project / "docs/STAGE3_STUDY.json").write_text(json.dumps(protocol), encoding="utf-8")
    path = project / ".runtime/stage3-study/ppo_reference-11/final.pgz"
    path.parent.mkdir(parents=True)
    path.write_bytes(blob)
    source = project / "evidence/025-stage3-study-results.json"
    source.write_text(json.dumps(document), encoding="utf-8")
    app = FastAPI()

    @app.exception_handler(ValueError)
    async def invalid(_, exc):
        return JSONResponse({"detail": str(exc)}, status_code=400)

    catalog = install_study_catalog(app, repository, project_root=project)
    return {
        "client": TestClient(app),
        "catalog": catalog,
        "repository": repository,
        "project": project,
        "source": source,
        "path": path,
        "document": document,
        "blob": blob,
        "state": state,
        "existing": existing,
    }


def save_document(fixture):
    fixture["source"].write_text(json.dumps(fixture["document"]), encoding="utf-8")


def row_for(document, condition="ppo_reference", seed=11):
    return next(
        row for row in document["rows"] if row["condition"] == condition and row["seed"] == seed
    )


def test_mockfree_catalog_retains_all_twenty_seeds_and_failure_without_full_runs(study_fixture):
    fixture = study_fixture
    response = fixture["client"].get("/api/studies/reference")
    assert response.status_code == 200
    document = response.json()
    assert len(document["rows"]) == 20
    assert [(row["condition"], row["seed"]) for row in document["rows"]] == [
        (condition, seed) for condition in CONDITIONS for seed in SEEDS
    ]
    assert row_for(document)["available"]
    assert row_for(document)["metrics"] == {
        key: value
        for key, value in fixture["document"]["summary"]["ppo_reference"]["per_seed"][0].items()
        if key != "seed"
    }
    assert row_for(document, seed=23)["status"] == "failed"
    assert "Test-only" in row_for(document, seed=23)["error"]
    assert row_for(document, seed=37)["status"] == "not_reported"
    assert "curve" not in response.text and '"runs"' not in response.text
    assert document["protocol"]["evaluation_seeds"] == [701, 702, 703, 704, 705]
    assert len(response.content) < 18000


def test_mockfree_import_clones_real_trained_state_with_source_and_no_learning(study_fixture):
    fixture = study_fixture
    original_blob = fixture["path"].read_bytes()
    response = fixture["client"].post(
        "/api/studies/reference/import", json={"condition": "ppo_reference", "seed": 11}
    )
    assert response.status_code == 201
    document = response.json()
    source = document["source"]
    assert (
        source["original_env_steps"] == 6
        and source["original_updates"] == fixture["state"]["updates"]
    )
    assert source["checkpoint_sha256"] == hashlib.sha256(original_blob).hexdigest()
    assert source["report_sha256"] == hashlib.sha256(fixture["source"].read_bytes()).hexdigest()
    new_state, _ = decode(
        fixture["repository"].checkpoint_bytes(document["experiment"]["checkpoint"])
    )
    assert new_state["env_steps"] == fixture["state"]["env_steps"]
    assert new_state["updates"] == fixture["state"]["updates"]
    for model, values in fixture["state"]["models"].items():
        for name, value in values.items():
            assert torch.equal(new_state["models"][model][name], value)
    assert fixture["repository"].experiment(fixture["existing"]["id"]) == fixture["existing"]
    assert fixture["path"].read_bytes() == original_blob
    assert len(fixture["repository"].list_experiments()) == 2


@pytest.mark.parametrize(
    "mutation,reason",
    [
        ("missing", "checkpoint_missing"),
        ("bad_hash", "checkpoint_hash_mismatch"),
        ("failed", "result_not_completed"),
        ("missing_summary", "invalid_summary"),
    ],
)
def test_missing_failed_or_bad_hash_cannot_import(study_fixture, mutation, reason):
    fixture = study_fixture
    if mutation == "missing":
        fixture["path"].unlink()
    elif mutation == "bad_hash":
        fixture["path"].write_bytes(fixture["blob"] + b"corruption")
    elif mutation == "failed":
        fixture["document"]["runs"][0]["status"] = "failed"
        save_document(fixture)
    else:
        fixture["document"]["summary"]["ppo_reference"]["per_seed"] = []
        save_document(fixture)
    assert row_for(fixture["catalog"].catalog())["availability"] == reason
    assert (
        fixture["client"]
        .post("/api/studies/reference/import", json={"condition": "ppo_reference", "seed": 11})
        .status_code
        == 409
    )
    assert len(fixture["repository"].list_experiments()) == 1


def test_packaged_directory_takes_precedence_without_silent_developer_fallback(study_fixture):
    fixture = study_fixture
    package = fixture["project"] / "examples/study"
    package.mkdir(parents=True)
    assert row_for(fixture["catalog"].catalog())["availability"] == "checkpoint_missing"
    target = package / "ppo_reference-11/final.pgz"
    target.parent.mkdir()
    target.write_bytes(fixture["blob"])
    row = row_for(fixture["catalog"].catalog())
    assert row["available"] and row["checkpoint_source"] == "bundled_examples"
    target.write_bytes(b"corrupt packaged checkpoint")
    assert row_for(fixture["catalog"].catalog())["availability"] == "checkpoint_hash_mismatch"
    assert fixture["path"].is_file()  # Healthy developer copy does not hide package corruption.


@pytest.mark.parametrize("mutation", ["invalid_bundle", "wrong_seed", "wrong_counts"])
def test_matching_hash_still_requires_safe_decoding_and_state_provenance(study_fixture, mutation):
    fixture = study_fixture
    if mutation == "invalid_bundle":
        blob = b"hash-matching but not a safe checkpoint"
    elif mutation == "wrong_seed":
        state = copy.deepcopy(fixture["state"])
        state["config"]["seed"] = 23
        blob = encode(state)
    else:
        blob = fixture["blob"]
        fixture["document"]["runs"][0]["env_steps"] += 1
        fixture["document"]["summary"]["ppo_reference"]["per_seed"][0]["env_steps"] += 1
    fixture["path"].write_bytes(blob)
    fixture["document"]["runs"][0]["checkpoint_sha256"] = hashlib.sha256(blob).hexdigest()
    save_document(fixture)
    assert row_for(fixture["catalog"].catalog())["available"]
    response = fixture["client"].post(
        "/api/studies/reference/import", json={"condition": "ppo_reference", "seed": 11}
    )
    assert response.status_code == 400
    assert len(fixture["repository"].list_experiments()) == 1


def test_browser_paths_extra_fields_and_unknown_seed_are_rejected(study_fixture):
    client = study_fixture["client"]
    for payload in (
        {"condition": "../../outside", "seed": 11},
        {"condition": "ppo_reference", "seed": 999},
        {"condition": "ppo_reference", "seed": 11, "path": "D:/arbitrary/file.pgz"},
    ):
        assert client.post("/api/studies/reference/import", json=payload).status_code == 422
    with pytest.raises(ValueError, match="boundary"):
        study_fixture["catalog"]._file("../outside.pgz")
    with pytest.raises(ValueError, match="Unknown"):
        study_fixture["catalog"]._checkpoint("../outside", 11)


def test_missing_report_retains_registration_and_never_fills_in_results(study_fixture):
    fixture = study_fixture
    fixture["source"].unlink()
    document = fixture["catalog"].catalog()
    assert not document["available"] and document["protocol"] is not None
    assert len(document["rows"]) == 20
    assert all(
        row["metrics"] == {} and row["budget_env_steps"] == 6 and not row["available"]
        for row in document["rows"]
    )


def test_duplicate_or_foreign_report_rows_disable_catalog(study_fixture):
    fixture = study_fixture
    fixture["document"]["runs"].append(copy.deepcopy(fixture["document"]["runs"][0]))
    save_document(fixture)
    document = fixture["catalog"].catalog()
    assert not document["available"] and document["error"]
    assert not any(row["available"] for row in document["rows"])
