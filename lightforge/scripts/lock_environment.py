"""Record installed dependency closure without pip freeze's editable/Git path decoding."""

from importlib.metadata import distribution
from pathlib import Path

from packaging.markers import default_environment
from packaging.requirements import Requirement

environment = default_environment()
environment["extra"] = ""
pending = [
    "numpy",
    "scipy",
    "fastapi",
    "uvicorn",
    "pydantic",
    "h5py",
    "psutil",
    "pytest",
    "httpx",
    "ruff",
    "setuptools",
    "wheel",
    "plotly",
]
seen = {}
while pending:
    package = distribution(pending.pop())
    name = package.metadata["Name"]
    if name.lower() in seen:
        continue
    seen[name.lower()] = f"{name}=={package.version}"
    for value in package.requires or []:
        requirement = Requirement(value)
        if not requirement.marker or requirement.marker.evaluate(environment):
            pending.append(requirement.name)
target = Path(__file__).resolve().parents[1] / "requirements-win-py312.lock"
target.write_text(
    "# Tested Windows CPython 3.12 dependency closure; project installed separately.\n"
    + "\n".join(seen[k] for k in sorted(seen))
    + "\n",
    encoding="utf-8",
)
print(f"Locked {len(seen)} installed packages to {target.name}")
