"""Real local trace/provenance checks; provider responses use explicit MockTransport.

These tests never contact DeepSeek or establish model answer quality.
"""

import asyncio
import json
import time
from contextlib import asynccontextmanager

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from policyglass.agents import Learner
from policyglass.explanation import (
    ENDPOINT,
    ExplainRequest,
    Explanations,
    ProviderSettings,
    SendRequest,
    install_explanations,
)
from policyglass.repository import Repository


@pytest.fixture
def local_trace(tmp_path, small_config):
    repository = Repository(tmp_path / "explanation-data")
    learner = Learner(small_config)
    try:
        experiment = repository.create(learner)
        _, trace = learner.update_ppo(learner.collect_ppo(), record=True)
        checkpoint = repository.save_checkpoint(learner, experiment["id"])
        trace_id = repository.save_trace(trace, experiment["id"], "", checkpoint, checkpoint)
        return repository, experiment["id"], trace_id, trace
    finally:
        learner.env.close()


def request_for(local_trace):
    return ExplainRequest(
        trace_id=local_trace[2], event_indices=[0], question="请解释当前事件及其边界"
    )


def answer_response(event_id, **overrides):
    answer = {
        "answer": "这是模拟供应商的边界测试文本，不能视为真实模型质量证据。",
        "citations": [event_id],
        "suggestion": None,
    }
    answer.update(overrides)
    return httpx.Response(
        200,
        json={
            "model": "mock-deepseek-flash",
            "choices": [{"finish_reason": "stop", "message": {"content": json.dumps(answer)}}],
            "usage": {"prompt_tokens": 100, "completion_tokens": 30, "total_tokens": 130},
        },
    )


def test_offline_preview_and_no_secret_no_private_notebook(local_trace):
    repository, experiment, _, trace = local_trace
    repository.save_notebook(experiment, {"notes": [{"text": "PRIVATE_NOTES_MUST_NOT_LEAVE"}]})
    manager = Explanations(repository, ProviderSettings())
    request = request_for(local_trace)
    preview = manager.preview(experiment, request)
    serialized = json.dumps(preview, ensure_ascii=False)
    assert trace["events"][0]["id"] in serialized
    assert "PRIVATE_NOTES_MUST_NOT_LEAVE" not in serialized
    assert "api_key" not in serialized
    assert preview["bytes"] <= 18000
    assert not manager.status()["configured"]
    with pytest.raises(HTTPException, match="503"):
        manager.start(
            experiment, SendRequest(request=request, preview_sha256=preview["sha256"], consent=True)
        )


def test_cross_experiment_or_invalid_event_is_rejected(local_trace):
    repository, experiment, _, _ = local_trace
    manager = Explanations(repository, ProviderSettings())
    request = request_for(local_trace)
    with pytest.raises(ValueError):
        manager.preview(experiment, request.model_copy(update={"event_indices": [-1]}))
    with pytest.raises(ValueError):
        manager.preview(experiment, request.model_copy(update={"event_indices": [0, 0]}))
    # Ownership is checked independently of valid trace shape.
    original = repository.experiment
    repository.experiment = lambda _: original(experiment)
    with pytest.raises(ValueError, match="belong"):
        manager.preview("a" * 32, request)


def test_mock_provider_request_citations_budget_and_readonly(local_trace):
    async def scenario():
        repository, experiment, _, trace = local_trace
        sent = []

        def provider(request):
            sent.append(request)
            return answer_response(
                trace["events"][0]["id"],
                suggestion={
                    "kind": "hyperparameter",
                    "path": "ppo.learning_rate",
                    "value": 0.0001,
                    "reason": "仅供用户复核；不会执行",
                },
            )

        settings = ProviderSettings(api_key="fake-test-secret", max_requests=1)
        manager = Explanations(repository, settings, httpx.MockTransport(provider))
        request = request_for(local_trace)
        preview = manager.preview(experiment, request)
        before = repository.experiment(experiment)
        with pytest.raises(ValueError, match="changed"):
            manager.start(
                experiment, SendRequest(request=request, preview_sha256="0" * 64, consent=True)
            )
        job = manager.start(
            experiment, SendRequest(request=request, preview_sha256=preview["sha256"], consent=True)
        )
        await manager.tasks[job["id"]]
        result = manager.get(job["id"])
        assert result["status"] == "completed"
        assert result["served_model"] == "mock-deepseek-flash"
        assert result["usage"]["total_tokens"] == 130
        assert str(sent[0].url) == ENDPOINT
        assert sent[0].headers["authorization"] == "Bearer fake-test-secret"
        payload = json.loads(sent[0].content)
        assert payload["response_format"] == {"type": "json_object"}
        assert payload["thinking"] == {"type": "disabled"}
        assert "tools" not in payload and payload["max_tokens"] == 1024
        assert repository.experiment(experiment) == before
        assert "fake-test-secret" not in json.dumps(result)
        with pytest.raises(HTTPException, match="429"):
            manager.start(
                experiment,
                SendRequest(request=request, preview_sha256=preview["sha256"], consent=True),
            )
        await manager.close()

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "response_kind",
    [
        "foreign_citation",
        "unsafe_suggestion",
        "invalid_config",
        "blank",
        "http_error",
        "oversize",
        "truncated",
    ],
)
def test_mock_provider_invalid_output_is_never_accepted(local_trace, response_kind):
    async def scenario():
        repository, experiment, _, trace = local_trace

        def provider(_):
            event_id = trace["events"][0]["id"]
            if response_kind == "foreign_citation":
                return answer_response(event_id, citations=["invented-event"])
            if response_kind == "unsafe_suggestion":
                return answer_response(
                    event_id,
                    suggestion={
                        "kind": "hyperparameter",
                        "path": "exec",
                        "value": 1,
                        "reason": "test",
                    },
                )
            if response_kind == "invalid_config":
                return answer_response(
                    event_id,
                    suggestion={
                        "kind": "hyperparameter",
                        "path": "ppo.learning_rate",
                        "value": 100,
                        "reason": "test",
                    },
                )
            if response_kind == "http_error":
                return httpx.Response(401, text="PRIVATE_PROVIDER_BODY fake-test-secret")
            if response_kind == "oversize":
                return httpx.Response(200, content=b" " * 65537)
            return httpx.Response(
                200,
                json={
                    "choices": [
                        {
                            "finish_reason": "length" if response_kind == "truncated" else "stop",
                            "message": {"content": "   "},
                        }
                    ]
                },
            )

        manager = Explanations(
            repository, ProviderSettings(api_key="fake-test-secret"), httpx.MockTransport(provider)
        )
        request = request_for(local_trace)
        preview = manager.preview(experiment, request)
        job = manager.start(
            experiment, SendRequest(request=request, preview_sha256=preview["sha256"], consent=True)
        )
        await manager.tasks[job["id"]]
        result = manager.get(job["id"])
        assert result["status"] == "failed" and result["result"] is None
        assert "fake-test-secret" not in json.dumps(result)
        assert "PRIVATE_PROVIDER_BODY" not in json.dumps(result)
        await manager.close()

    asyncio.run(scenario())


def test_mock_provider_cancel_closes_inflight_request(local_trace):
    async def scenario():
        started, closed = asyncio.Event(), asyncio.Event()

        async def provider(_):
            started.set()
            try:
                await asyncio.Future()
            finally:
                closed.set()

        repository, experiment, _, _ = local_trace
        manager = Explanations(
            repository, ProviderSettings(api_key="fake-test-secret"), httpx.MockTransport(provider)
        )
        request = request_for(local_trace)
        preview = manager.preview(experiment, request)
        job = manager.start(
            experiment, SendRequest(request=request, preview_sha256=preview["sha256"], consent=True)
        )
        await asyncio.wait_for(started.wait(), timeout=2)
        assert manager.cancel(job["id"])["status"] == "cancelled"
        await manager.tasks[job["id"]]
        assert closed.is_set()
        assert manager.get(job["id"])["result"] is None
        await manager.close()

    asyncio.run(scenario())


def test_installed_http_routes_use_real_local_objects_and_mock_provider(local_trace):
    repository, experiment, trace_id, trace = local_trace
    manager = None

    @asynccontextmanager
    async def lifespan(_):
        yield
        await manager.close()

    app = FastAPI(lifespan=lifespan)
    manager = install_explanations(
        app,
        repository,
        ProviderSettings(api_key="fake-test-secret"),
        httpx.MockTransport(lambda _: answer_response(trace["events"][0]["id"])),
    )
    with TestClient(app) as client:
        status = client.get("/api/explanations/status")
        assert status.json()["configured"]
        assert "fake-test-secret" not in status.text
        path = f"/api/experiments/{experiment}/explanations"
        request = {"trace_id": trace_id, "event_indices": [0], "question": "解释这个实际事件"}
        preview = client.post(path + "/preview", json=request)
        assert preview.status_code == 200
        assert "fake-test-secret" not in preview.text
        assert (
            client.post(
                path,
                json={
                    "request": request,
                    "preview_sha256": preview.json()["sha256"],
                    "consent": False,
                },
            ).status_code
            == 422
        )
        assert (
            client.post(
                path + "/preview", json={**request, "base_url": "http://evil.invalid"}
            ).status_code
            == 422
        )
        response = client.post(
            path,
            json={"request": request, "preview_sha256": preview.json()["sha256"], "consent": True},
        )
        assert response.status_code == 202
        object_id = response.json()["id"]
        for _ in range(20):
            result = client.get(f"/api/explanations/{object_id}")
            if result.json()["status"] in ("completed", "failed"):
                break
            time.sleep(0.01)
        assert result.json()["status"] == "completed"
        assert "fake-test-secret" not in result.text


def test_mock_provider_hard_timeout(local_trace):
    async def scenario():
        async def provider(_):
            await asyncio.Future()

        repository, experiment, _, _ = local_trace
        manager = Explanations(
            repository,
            ProviderSettings(api_key="fake-test-secret", timeout_seconds=1),
            httpx.MockTransport(provider),
        )
        request = request_for(local_trace)
        preview = manager.preview(experiment, request)
        job = manager.start(
            experiment, SendRequest(request=request, preview_sha256=preview["sha256"], consent=True)
        )
        await asyncio.wait_for(manager.tasks[job["id"]], timeout=2)
        result = manager.get(job["id"])
        assert result["status"] == "failed"
        assert "timed out" in result["error"]
        await manager.close()

    asyncio.run(scenario())
