import pytest
from fastapi.testclient import TestClient

from policyglass.api import create_app


@pytest.mark.parametrize("algorithm", ["ppo", "sac"])
def test_network_parameters_are_bound_to_owned_checkpoint(tmp_path, small_config, algorithm):
    small_config.algorithm = algorithm
    with TestClient(create_app(tmp_path / algorithm)) as client:
        original = client.post(
            "/api/experiments",
            json={"label": "Network parameter source", "config": small_config.model_dump()},
        ).json()
        endpoint = f"/api/experiments/{original['id']}/parameters"
        initial = client.get(endpoint).json()
        child = client.post(
            f"/api/experiments/{original['id']}/branches",
            json={
                "checkpoint": original["checkpoint"],
                "intervention": {
                    "kind": "parameter",
                    "path": "actor/biases.0",
                    "index": [0],
                    "value": 0.375,
                },
            },
        )
        assert child.status_code == 201, child.text
        child = child.json()
        child_endpoint = f"/api/experiments/{child['id']}/parameters"
        child_parameters = client.get(
            child_endpoint, params={"checkpoint": child["checkpoint"]}
        ).json()
        assert child_parameters["actor"]["biases.0"][0] == 0.375
        assert client.get(endpoint, params={"checkpoint": original["checkpoint"]}).json() == initial
        # A source selector must not become an arbitrary cross-experiment loader.
        rejected = client.get(endpoint, params={"checkpoint": child["checkpoint"]})
        assert rejected.status_code == 400
        assert "belong" in rejected.json()["detail"]
        assert client.get(f"/api/experiments/{original['id']}").json()["updates"] == 0
