"""Record actual dependency versions without credentials or local paths."""

import importlib.metadata
from pathlib import Path

root = Path(__file__).resolve().parents[1]
packages = sorted(
    (d.metadata["Name"], d.version)
    for d in importlib.metadata.distributions()
    if d.metadata["Name"].lower() not in ("policyglass", "pip")
)
lines = [
    "# Actual tested Windows CPython3.12 closure; install project separately.",
    "--index-url https://pypi.org/simple",
    "--extra-index-url https://download.pytorch.org/whl/cpu",
]
lines.extend(f"{name}=={version}" for name, version in packages)
(root / "requirements-win-py312.lock").write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"Recorded {len(packages)} dependency versions")
