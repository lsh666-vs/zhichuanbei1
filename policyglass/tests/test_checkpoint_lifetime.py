"""Temporary checkpoint tensors must not depend on cyclic garbage collection."""

import gc
import hashlib
import io
import json
import weakref
import zipfile

import pytest
import torch

from policyglass import checkpoint


@pytest.fixture
def without_cyclic_gc():
    was_enabled = gc.isenabled()
    gc.disable()
    try:
        yield
    finally:
        if was_enabled:
            gc.enable()


def observe_loaded_tensors(monkeypatch):
    original = checkpoint.load_tensors
    references = []

    def observed(payload):
        tensors = original(payload)
        references.extend(weakref.ref(tensor) for tensor in tensors.values())
        return tensors

    monkeypatch.setattr(checkpoint, "load_tensors", observed)
    return references


def test_encode_releases_temporary_clones_on_return(monkeypatch, without_cyclic_gc):
    original = checkpoint.save_tensors
    references = []

    def observed(tensors):
        references.extend(weakref.ref(tensor) for tensor in tensors.values())
        return original(tensors)

    monkeypatch.setattr(checkpoint, "save_tensors", observed)
    source = torch.arange(12, dtype=torch.float64).reshape(3, 4)
    blob = checkpoint.encode({"nested": [source, {"again": source}], "step": 7})
    assert len(references) == 2
    assert all(reference() is None for reference in references)
    state, _ = checkpoint.decode(blob)
    assert torch.equal(state["nested"][0], source)
    assert torch.equal(state["nested"][1]["again"], source)
    assert state["step"] == 7


def test_encode_releases_clones_when_serialization_fails(monkeypatch, without_cyclic_gc):
    original = checkpoint.save_tensors
    references = []

    def observed(tensors):
        references.extend(weakref.ref(tensor) for tensor in tensors.values())
        original(tensors)  # Use the real serializer before the injected failure.
        raise ValueError("injected serializer failure")

    monkeypatch.setattr(checkpoint, "save_tensors", observed)
    with pytest.raises(ValueError, match="injected serializer failure") as error:
        checkpoint.encode({"nested": [torch.ones(8, dtype=torch.float64)]})
    # Keep the exception/traceback alive: its temporary dictionary must be empty.
    assert error.value is not None
    assert references and all(reference() is None for reference in references)


def test_encode_releases_earlier_clones_when_packing_fails(monkeypatch, without_cyclic_gc):
    original = torch.Tensor.clone
    references = []

    def observed(tensor, *args, **kwargs):
        result = original(tensor, *args, **kwargs)
        references.append(weakref.ref(result))
        return result

    monkeypatch.setattr(torch.Tensor, "clone", observed)
    with pytest.raises(ValueError, match="Non-finite checkpoint tensor"):
        checkpoint.encode({"nested": [torch.ones(8), torch.tensor(float("nan"))]})
    assert len(references) == 1
    assert references[0]() is None


def test_decode_releases_loaded_tensors_while_returned_state_is_live(
    monkeypatch, without_cyclic_gc
):
    source = torch.arange(12, dtype=torch.float64).reshape(3, 4)
    blob = checkpoint.encode({"nested": [source, {"again": source}], "step": 7})
    references = observe_loaded_tensors(monkeypatch)
    for _ in range(3):
        state, manifest = checkpoint.decode(blob)
        assert torch.equal(state["nested"][0], source)
        assert torch.equal(state["nested"][1]["again"], source)
        assert state["step"] == 7
        assert manifest["schema"] == "policyglass.bundle.v1"
        assert all(reference() is None for reference in references)
        # Returned tensors remain independent clones, including repeated inputs.
        state["nested"][0].add_(1)
        assert torch.equal(state["nested"][1]["again"], source)
    assert len(references) == 6


def test_decode_releases_loaded_tensors_when_validation_fails(monkeypatch, without_cyclic_gc):
    blob = checkpoint.encode({"nested": [torch.ones(8, dtype=torch.float64)]})
    with zipfile.ZipFile(io.BytesIO(blob)) as archive:
        files = {name: archive.read(name) for name in archive.namelist()}
    files["tensors.safetensors"] = checkpoint.save_tensors({"t0": torch.tensor(float("nan"))})
    manifest = json.loads(files["manifest.json"])
    manifest["files"]["tensors.safetensors"] = hashlib.sha256(
        files["tensors.safetensors"]
    ).hexdigest()
    files["manifest.json"] = checkpoint.json_bytes(manifest)
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as archive:
        for name, value in files.items():
            archive.writestr(name, value)
    references = observe_loaded_tensors(monkeypatch)
    with pytest.raises(ValueError, match="Non-finite tensor payload") as error:
        checkpoint.decode(output.getvalue())
    assert error.value is not None
    assert len(references) == 1
    assert references[0]() is None


def test_decode_releases_loaded_tensors_when_unpacking_fails(monkeypatch, without_cyclic_gc):
    blob = checkpoint.encode({"nested": [torch.ones(8), torch.ones(8)]})
    references = observe_loaded_tensors(monkeypatch)
    original = torch.Tensor.clone
    calls = 0

    def fails_on_second_clone(tensor, *args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            # The injected Python failure must not retain the tensor in its own
            # traceback argument; we are measuring the checkpoint helper table.
            del tensor
            raise RuntimeError("injected clone failure")
        return original(tensor, *args, **kwargs)

    monkeypatch.setattr(torch.Tensor, "clone", fails_on_second_clone)
    with pytest.raises(RuntimeError, match="injected clone failure") as error:
        checkpoint.decode(blob)
    assert error.value is not None
    assert len(references) == 2
    assert all(reference() is None for reference in references)
