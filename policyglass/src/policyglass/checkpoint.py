"""Bounded, checksummed, pickle-free checkpoint bundles."""

import hashlib
import io
import json
import platform
import zipfile

import numpy as np
import torch
from safetensors.torch import load as load_tensors
from safetensors.torch import save as save_tensors

from . import __version__
from .physics_host import ENGINE_VERSION

MAX_BYTES = 128 * 1024 * 1024
MAX_JSON_BYTES = 8 * 1024 * 1024


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode(
        "utf-8"
    )


def encode(state):
    tensors = {}

    def pack(value):
        if isinstance(value, torch.Tensor):
            if not torch.isfinite(value).all():
                raise ValueError("Non-finite checkpoint tensor")
            key = f"t{len(tensors)}"
            tensors[key] = value.detach().cpu().contiguous().clone()
            return {"__tensor__": key}
        if isinstance(value, dict):
            return {str(k): pack(v) for k, v in value.items()}
        if isinstance(value, (list, tuple)):
            return [pack(v) for v in value]
        if isinstance(value, np.generic):
            return value.item()
        return value

    metadata = json_bytes(pack(state))
    payload = save_tensors(tensors)
    if len(payload) + len(metadata) > MAX_BYTES or len(metadata) > MAX_JSON_BYTES:
        raise ValueError("Checkpoint exceeds resource budget")
    manifest = {
        "schema": "policyglass.bundle.v1",
        "version": __version__,
        "python": platform.python_version(),
        "torch": torch.__version__,
        "mujoco_wasm": ENGINE_VERSION,
        "numpy": np.__version__,
        "mode": "cpu_float64",
        "files": {
            name: hashlib.sha256(value).hexdigest()
            for name, value in (("metadata.json", metadata), ("tensors.safetensors", payload))
        },
    }
    output = io.BytesIO()
    # ZIP_STORED keeps allocation limits transparent and avoids decompression bombs.
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as archive:
        for name, value in (
            ("manifest.json", json_bytes(manifest)),
            ("metadata.json", metadata),
            ("tensors.safetensors", payload),
        ):
            item = zipfile.ZipInfo(name, date_time=(2026, 11, 16, 0, 0, 0))
            archive.writestr(item, value)
    return output.getvalue()


def decode(blob):
    if len(blob) > MAX_BYTES + 1024 * 1024:
        raise ValueError("Checkpoint exceeds resource budget")
    try:
        with zipfile.ZipFile(io.BytesIO(blob)) as archive:
            entries = archive.infolist()
            expected = {"manifest.json", "metadata.json", "tensors.safetensors"}
            if len(entries) != 3 or {item.filename for item in entries} != expected:
                raise ValueError("Unexpected or duplicate archive entries")
            if any(
                item.compress_type != zipfile.ZIP_STORED or item.flag_bits & 1 for item in entries
            ):
                raise ValueError("Compressed/encrypted checkpoints are not accepted")
            if sum(item.file_size for item in entries) > MAX_BYTES:
                raise ValueError("Checkpoint payload exceeds resource budget")
            if any(
                item.file_size > MAX_JSON_BYTES
                for item in entries
                if item.filename.endswith(".json")
            ):
                raise ValueError("Oversized JSON metadata")
            files = {name: archive.read(name) for name in expected}
        manifest = json.loads(files["manifest.json"])
        if manifest.get("schema") != "policyglass.bundle.v1":
            raise ValueError("Unsupported checkpoint version")
        for name in ("metadata.json", "tensors.safetensors"):
            if hashlib.sha256(files[name]).hexdigest() != manifest["files"][name]:
                raise ValueError("Checkpoint integrity mismatch")
        tensors = load_tensors(files["tensors.safetensors"])
        if any(not torch.isfinite(t).all() for t in tensors.values()):
            raise ValueError("Non-finite tensor payload")
        seen = set()

        def unpack(value, depth=0):
            if depth > 32:
                raise ValueError("Checkpoint nesting too deep")
            if isinstance(value, dict):
                if set(value) == {"__tensor__"}:
                    key = value["__tensor__"]
                    seen.add(key)
                    return tensors[key].clone()
                return {k: unpack(v, depth + 1) for k, v in value.items()}
            if isinstance(value, list):
                return [unpack(v, depth + 1) for v in value]
            if isinstance(value, float) and not np.isfinite(value):
                raise ValueError("Non-finite metadata")
            return value

        state = unpack(json.loads(files["metadata.json"]))
        if seen != set(tensors):
            raise ValueError("Unexpected tensor payload")
        return state, manifest
    except (KeyError, TypeError, RecursionError, zipfile.BadZipFile, json.JSONDecodeError) as exc:
        raise ValueError("Malformed checkpoint") from exc
