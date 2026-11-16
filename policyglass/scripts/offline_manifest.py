"""Explicit-list, relocatable Windows offline assembly and honest local verification."""

import argparse
import hashlib
import importlib.metadata
import json
import os
import platform
import re
import shutil
import socket
import struct
import subprocess
import sys
import time
import urllib.request
import uuid
import zipfile
from contextlib import ExitStack
from datetime import UTC, datetime
from pathlib import Path

DOWNLOADS = {
    "python-3.12.7-embed-amd64.zip": (
        "https://www.python.org/ftp/python/3.12.7/python-3.12.7-embed-amd64.zip",
        "0d57bb6cb078b74d23dbfe91f77d6780d45bed328911609f1f7ee2ba1606bf44",
    ),
    "node-v24.22.1-win-x64.zip": (
        "https://nodejs.org/dist/v24.22.1/node-v24.22.1-win-x64.zip",
        "d2046d28c2c3dcd211ac5145c0bf30e2047ef9dfb306693c8c6e2eccd8b95fa5",
    ),
}
NOTICE_SOURCES = {
    "mujoco/LICENSE": "https://raw.githubusercontent.com/google-deepmind/mujoco/4.0.1/LICENSE",
    "mujoco/README.md": "https://raw.githubusercontent.com/google-deepmind/mujoco/4.0.1/wasm/README.md",
    "mujoco/MujocoDependencies.cmake": "https://raw.githubusercontent.com/google-deepmind/mujoco/4.0.1/cmake/MujocoDependencies.cmake",
    "mujoco/lodepng.cmake": "https://raw.githubusercontent.com/google-deepmind/mujoco/4.0.1/cmake/third_party_deps/lodepng.cmake",
    "mujoco/libccd-BSD-LICENSE": "https://raw.githubusercontent.com/danfis/libccd/7931e764a19ef6b21b443376c699bbc9c6d4fba8/BSD-LICENSE",
    "mujoco/lodepng-LICENSE-header.h": "https://raw.githubusercontent.com/lvandeve/lodepng/22561883dd63fd1850f18e1f6adac321e4f609b0/lodepng.h",
    "mujoco/qhull-COPYING.txt": "https://raw.githubusercontent.com/qhull/qhull/d1c2fc0caa5f644f3a0f220290d4a868c68ed4f6/COPYING.txt",
    "mujoco/tinyxml2-LICENSE.txt": "https://raw.githubusercontent.com/leethomason/tinyxml2/e6caeae85799003f4ca74ff26ee16a789bc2af48/LICENSE.txt",
    "mujoco/tinyobjloader-LICENSE": "https://raw.githubusercontent.com/tinyobjloader/tinyobjloader/2945a967c5303b2c8c14174117c45f3302591150/LICENSE",
    "mujoco/miniz-LICENSE": "https://raw.githubusercontent.com/richgel999/miniz/77d0dce8627735138c51770d1799a1ef48f2117d/LICENSE",
    "mujoco/MarchingCubeCpp-README-license.md": "https://raw.githubusercontent.com/aparis69/MarchingCubeCpp/f03a1b3ec29b1d7d865691ca8aea4f1eb2c2873d/README.md",
    "mujoco/emscripten-LICENSE": "https://raw.githubusercontent.com/emscripten-core/emscripten/4.0.10/LICENSE",
    "fonts/OFL-official-template.txt": "https://openfontlicense.org/documents/OFL.txt",
}
NPM_NOTICE_FALLBACKS = {
    "@react-three/fiber": "https://raw.githubusercontent.com/pmndrs/react-three-fiber/d74622ea8ed717f7212d7e19d65ff3e325508389/LICENSE",
    "@mediapipe/tasks-vision": "https://raw.githubusercontent.com/google-ai-edge/mediapipe/master/LICENSE",
    "stats-gl": "https://raw.githubusercontent.com/spdx/license-list-data/v3.26.0/text/MIT.txt",
    "draco3d": "https://raw.githubusercontent.com/google/draco/554628821c3448319d7d4ae48db170b8c63e1aaf/LICENSE",
    "maath": "https://raw.githubusercontent.com/pmndrs/maath/main/LICENSE",
}
NPM_UNVERIFIED_NOTICE_VERSIONS = {
    "@mediapipe/tasks-vision",
    "stats-gl",
    "maath",
}


def d_path(value):
    path = Path(value).resolve()
    if path.drive.upper() != "D:":
        raise ValueError(f"All output must stay on D: ({path})")
    return path


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def dump(path, document):
    d_path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document, ensure_ascii=False, indent=2, allow_nan=False), "utf-8")


def copy_file(source, destination):
    d_path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)


def copy_tree(source, destination):
    source = source.resolve()
    for path in sorted(source.rglob("*")):
        if path.is_file() and "__pycache__" not in path.parts and path.suffix != ".pyc":
            if not path.resolve().is_relative_to(source):
                raise ValueError(f"Source link escapes allowlisted tree: {path}")
            copy_file(path, destination / path.relative_to(source))


def download(url, path, expected=None):
    path = d_path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    was_cached = path.exists()
    transfer_started = time.perf_counter()
    if not path.exists():
        temporary = path.with_suffix(path.suffix + ".partial-" + uuid.uuid4().hex)
        if os.name == "nt":
            fetcher = Path(__file__).with_name("Fetch-ReleaseDependency.ps1")
            shell = shutil.which("pwsh.exe") or shutil.which("powershell.exe")
            subprocess.run(
                [
                    shell,
                    "-NoProfile",
                    "-NonInteractive",
                    "-File",
                    str(fetcher),
                    "-Url",
                    url,
                    "-OutFile",
                    str(temporary),
                ],
                check=True,
            )
        else:
            request = urllib.request.Request(
                url, headers={"User-Agent": "PolicyGlass-offline-builder"}
            )
            with (
                urllib.request.urlopen(request, timeout=90) as incoming,
                temporary.open("xb") as out,
            ):
                shutil.copyfileobj(incoming, out)
        temporary.rename(path)
    actual = digest(path)
    if expected and actual != expected:
        raise ValueError(f"Pinned official archive hash mismatch: {path.name}")
    return {
        "url": url,
        "sha256": actual,
        "bytes": path.stat().st_size,
        "cache_hit": was_cached,
        "download_wall_seconds": None if was_cached else time.perf_counter() - transfer_started,
        "timing_scope": "cached first-transfer timing unavailable"
        if was_cached
        else "HTTP transfer plus downloader process and write",
    }


def npm_packages(document):
    found = {}

    def visit(item):
        for value in item.get("dependencies", {}).values():
            path = value.get("path")
            if path and path not in found:
                found[path] = value
            visit(value)

    for item in document if isinstance(document, list) else [document]:
        visit(item)
    return found


def notices(project, bundle, npm_tree, cache, rendered=None):
    report = {"python": [], "npm": [], "upstream": [], "gaps": [], "excluded_npm": []}
    included = (
        None if rendered is None else {(p["name"], p["version"]) for p in rendered["packages"]}
    )
    target = bundle / "THIRD_PARTY"
    for name, url in NOTICE_SOURCES.items():
        source = cache / "notices" / name
        info = download(url, source)
        copy_file(source, target / name)
        report["upstream"].append({"file": name, **info})
    for path in npm_packages(npm_tree):
        source = Path(path).resolve()
        manifest = json.loads((source / "package.json").read_text("utf-8"))
        if included is not None and (manifest["name"], manifest["version"]) not in included:
            report["excluded_npm"].append(
                {
                    "name": manifest["name"],
                    "version": manifest["version"],
                    "reason": "No rendered JavaScript or included CSS in the actual chunk.modules report; package code/assets not redistributed",
                }
            )
            continue
        key = manifest["name"].replace("/", "__").replace("@", "") + "-" + manifest["version"]
        dest = target / "npm" / key
        copy_file(source / "package.json", dest / "package.json")
        copies = []
        for file in source.rglob("*"):
            relative = file.relative_to(source)
            if "node_modules" in relative.parts or len(relative.parts) > 3:
                continue
            if file.is_file() and re.search(
                r"license|notice|copying|copyright", file.name, re.IGNORECASE
            ):
                copy_file(file, dest / relative)
                copies.append(relative.as_posix())
        fallback = None
        if not copies and manifest["name"] in NPM_NOTICE_FALLBACKS:
            url = NPM_NOTICE_FALLBACKS[manifest["name"]]
            source_notice = (
                cache
                / "notices"
                / "npm"
                / (key + "-" + hashlib.sha256(url.encode()).hexdigest()[:12] + ".txt")
            )
            try:
                fallback = download(url, source_notice)
                if manifest["name"] == "@react-three/fiber":
                    fallback["version_reference"] = (
                        "Official GitHub tag v9.8.2 -> d74622ea8ed717f7212d7e19d65ff3e325508389; complete upstream copyright retained"
                    )
                copy_file(source_notice, dest / "UPSTREAM-LICENSE.txt")
                copies.append("UPSTREAM-LICENSE.txt")
                if manifest["name"] in NPM_UNVERIFIED_NOTICE_VERSIONS:
                    report["gaps"].append(
                        key
                        + ": full upstream/SPDX license text archived; exact-version attribution not independently confirmed"
                    )
            except (OSError, ValueError, subprocess.CalledProcessError) as exc:
                report["gaps"].append(
                    f"{key}: official fallback retrieval failed ({type(exc).__name__})"
                )
        if not copies:
            report["gaps"].append(f"{key}: package lacks license/notice text")
        report["npm"].append(
            {
                "name": manifest["name"],
                "version": manifest["version"],
                "license": manifest.get("license"),
                "files": copies,
                "fallback": fallback,
            }
        )
    if included is None or ("katex", "0.19.1") in included:
        font_rows = []
        fonts = project / "frontend" / "node_modules" / "katex" / "dist" / "fonts"
        template = (target / "fonts" / "OFL-official-template.txt").read_text("utf-8-sig")
        license_body = "SIL OPEN FONT LICENSE" + template.split("SIL OPEN FONT LICENSE", 1)[1]
        for font in sorted(fonts.glob("*.ttf")):
            data = font.read_bytes()
            table_count = struct.unpack_from(">H", data, 4)[0]
            table = next(
                struct.unpack_from(">II", data, 12 + i * 16 + 8)
                for i in range(table_count)
                if data[12 + i * 16 : 16 + i * 16] == b"name"
            )
            names = data[table[0] : table[0] + table[1]]
            count, offset = struct.unpack_from(">HH", names, 2)
            entries = []
            for i in range(count):
                platform_id, _, _, name_id, length, start = struct.unpack_from(
                    ">HHHHHH", names, 6 + i * 12
                )
                if name_id in (0, 13, 14):
                    value = names[offset + start : offset + start + length].decode(
                        "utf-16-be" if platform_id in (0, 3) else "latin-1"
                    )
                    entry = {"name_id": name_id, "text": value}
                    if entry not in entries:
                        entries.append(entry)
            if not any("SIL Open Font License" in e["text"] for e in entries):
                raise ValueError("KaTeX font has an unrecognized embedded license")
            (target / "fonts" / (font.stem + "-NOTICES.txt")).write_text(
                "Extracted verbatim from the distributed TTF name table; no font modification.\n\n"
                + "\n\n".join(e["text"] for e in entries)
                + "\n\n"
                + license_body,
                "utf-8",
            )
            font_rows.append(
                {
                    "font": font.name,
                    "sha256": digest(font),
                    "embedded_name_table": entries,
                    "formats": [
                        {"filename": p.name, "sha256": digest(p)}
                        for p in sorted(fonts.glob(font.stem + ".*"))
                    ],
                }
            )
        dump(target / "fonts" / "font-notices.json", font_rows)
        report["font_notices"] = {
            "families": len(font_rows),
            "source": "Actual distributed KaTeX TTF name tables plus official SIL OFL1.1 body",
        }
    return report


def assemble(args):
    started = time.perf_counter()
    project = d_path(args.project)
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", args.name):
        raise ValueError("Invalid package name")
    bundle = project / ".runtime" / "release" / args.name
    if bundle.exists():
        raise ValueError("A release is immutable. Choose a new name; existing files are preserved.")
    bundle.mkdir(parents=True)
    rendered_path = d_path(args.rendered_modules)
    rendered = json.loads(rendered_path.read_text("utf-8"))
    built_frontend = project / "frontend" / "dist"
    if (project / rendered["outDir"]).resolve() != built_frontend.resolve():
        raise ValueError("Attribution report is not from the production frontend being distributed")
    attributed_files = {item["filename"] for item in rendered["outputs"]}
    actual_files = {
        p.relative_to(built_frontend).as_posix() for p in built_frontend.rglob("*") if p.is_file()
    }
    if attributed_files != actual_files:
        raise ValueError("Rendered module report does not cover every distributed frontend output")
    for item in rendered["outputs"]:
        if digest(built_frontend / item["filename"]) != item["sha256"]:
            raise ValueError("Attributed frontend output hash changed after build")
    cache = project / ".runtime" / "release-downloads"
    provenance = {}
    for name, (url, expected) in DOWNLOADS.items():
        provenance[name] = download(url, cache / name, expected)
    python_root = bundle / "runtime" / "python"
    python_root.mkdir(parents=True)
    with zipfile.ZipFile(cache / "python-3.12.7-embed-amd64.zip") as archive:
        for item in archive.infolist():
            path = python_root / item.filename
            if not path.resolve().is_relative_to(python_root) or item.is_dir():
                raise ValueError("Unexpected embedded Python archive layout")
            path.write_bytes(archive.read(item))
    node_root = bundle / "runtime" / "node"
    node_root.mkdir(parents=True)
    with zipfile.ZipFile(cache / "node-v24.22.1-win-x64.zip") as archive:
        for name in ("node.exe", "LICENSE", "README.md"):
            (node_root / name).write_bytes(archive.read("node-v24.22.1-win-x64/" + name))
    (python_root / "python312._pth").write_text(
        "python312.zip\n.\nLib/site-packages\n../../src\nimport site\n", "utf-8"
    )
    site = python_root / "Lib" / "site-packages"
    site.mkdir(parents=True)
    lock = (project / "requirements-win-py312.lock").read_text("utf-8")
    expected_dists = re.findall(r"^([A-Za-z0-9_.-]+)==([^\s]+)", lock, re.MULTILINE)
    python_report = []
    for name, version in expected_dists:
        dist = importlib.metadata.distribution(name)
        if dist.version != version:
            raise ValueError(f"Installed dependency differs from lock: {name}")
        source_site = Path(dist.locate_file("")).resolve()
        if source_site != (project / ".venv" / "Lib" / "site-packages").resolve():
            raise ValueError(f"Dependency was not from isolated project environment: {name}")
        license_files = []
        count = 0
        for file in dist.files or []:
            source = Path(dist.locate_file(file)).resolve()
            if not source.is_relative_to(source_site):
                continue  # entrypoint executables/launcher scripts are intentionally omitted
            relative = source.relative_to(source_site)
            if (
                not source.is_file()
                or "__pycache__" in relative.parts
                or source.suffix in (".pyc", ".pth")
            ):
                continue
            copy_file(source, site / relative)
            count += 1
            if re.search(r"license|notice|copying|copyright", source.name, re.IGNORECASE):
                copy_file(source, bundle / "THIRD_PARTY" / "python" / name / relative)
                license_files.append(relative.as_posix())
        if not count:
            raise ValueError(f"No installed files recorded for {name}")
        python_report.append(
            {
                "name": name,
                "version": version,
                "copied_files": count,
                "license_files": license_files,
            }
        )
        print(f"Copied locked Python dependency {name}=={version}: {count} files", flush=True)
    copy_file(project / "scripts" / "offline_network_guard.py", site / "sitecustomize.py")
    copy_tree(project / "src" / "policyglass", bundle / "src" / "policyglass")
    copy_tree(project / "frontend" / "dist", bundle / "frontend" / "dist")
    if not (bundle / "frontend" / "dist" / "index.html").is_file():
        raise ValueError("Build the frontend before assembling the offline package")
    copy_tree(
        project / "physics" / "node_modules" / "@mujoco" / "mujoco",
        bundle / "physics" / "node_modules" / "@mujoco" / "mujoco",
    )
    for name in ("host.mjs", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"):
        copy_file(project / "physics" / name, bundle / "physics" / name)
    for name in (
        "package.json",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
        "index.html",
        "tsconfig.json",
        "vite.config.ts",
        "playwright.config.ts",
        "vitest.config.ts",
    ):
        copy_file(project / "frontend" / name, bundle / "frontend" / name)
    copy_tree(project / "frontend" / "src", bundle / "frontend" / "src")
    copy_tree(project / "frontend" / "tests", bundle / "frontend" / "tests")
    for name in (
        "README.md",
        "AGENTS.md",
        "pyproject.toml",
        "requirements-win-py312.lock",
        "requirements-study-py312.lock",
        ".gitattributes",
        ".gitignore",
        "Start-PolicyGlass.ps1",
        ".env.example",
    ):
        copy_file(project / name, bundle / name)
    # Public docs, tests and scripts are deliberate allowlists; no evidence/private,
    # repository metadata, notebooks, .env, stores, caches or arbitrary project tree.
    copy_tree(project / "docs", bundle / "docs")
    copy_tree(project / "handoffs", bundle / "handoffs")
    copy_tree(project / "tests", bundle / "tests")
    for entry in (project / "evidence").iterdir():
        if entry.name == "private":
            continue
        if entry.is_file() and entry.suffix.lower() in (".md", ".json", ".jsonl", ".xml"):
            copy_file(entry, bundle / "evidence" / entry.name)
        elif entry.is_dir() and entry.name in ("stage2-ui", "stage3-ui", "stage3-figures"):
            copy_tree(entry, bundle / "evidence" / entry.name)
    study_examples = []
    if args.include_study:
        protocol = json.loads((project / "docs" / "STAGE3_STUDY.json").read_text("utf-8"))
        from policyglass.checkpoint import decode

        for condition in protocol["conditions"]:
            for seed in protocol["training_seeds"]:
                name = f"{condition['name']}-{seed}"
                source = project / ".runtime" / "stage3-study" / name
                outcome = json.loads((source / "result.json").read_text("utf-8"))
                state, _ = decode((source / "final.pgz").read_bytes())
                if (
                    state["config"]["seed"] != seed
                    or state["config"]["algorithm"] != condition["algorithm"]
                ):
                    raise ValueError(f"Study checkpoint provenance mismatch: {name}")
                if (
                    outcome["condition"] != condition["name"]
                    or outcome["seed"] != seed
                    or outcome["config"] != state["config"]
                    or outcome["env_steps"] != state["env_steps"]
                    or outcome["updates"] != state["updates"]
                    or outcome["checkpoint_sha256"] != digest(source / "final.pgz")
                    or outcome["protocol_sha256"] != digest(project / "docs" / "STAGE3_STUDY.json")
                ):
                    raise ValueError(f"Study result/checkpoint/protocol integrity mismatch: {name}")
                dest = bundle / "examples" / "study" / name
                copy_file(source / "final.pgz", dest / "final.pgz")
                copy_file(source / "result.json", dest / "result.json")
                study_examples.append(
                    {
                        "condition": condition["name"],
                        "seed": seed,
                        "checkpoint": (dest / "final.pgz").relative_to(bundle).as_posix(),
                        "sha256": digest(dest / "final.pgz"),
                        "env_steps": state["env_steps"],
                        "updates": state["updates"],
                        "actual_outcome": outcome,
                        "scope": "All registered seeds retained; not a universal successful-policy claim",
                    }
                )
        dump(bundle / "examples" / "index.json", study_examples)
    for source in (project / "scripts").iterdir():
        if source.is_file() and source.suffix.lower() in (".ps1", ".py", ".mjs"):
            copy_file(source, bundle / "scripts" / source.name)
    (bundle / "Start-PolicyGlass-Offline.ps1").write_text(
        "& (Join-Path $PSScriptRoot 'scripts\\Start-Offline.ps1')\n", "utf-8"
    )
    npm_tree = json.loads(Path(args.npm_tree).read_text("utf-8-sig"))
    copy_file(rendered_path, bundle / "frontend" / "rendered-modules.json")
    license_report = notices(project, bundle, npm_tree, cache, rendered)
    license_report["python"] = python_report
    for item in python_report:
        if not item["license_files"]:
            license_report["gaps"].append(item["name"] + ": no bundled Python license text found")
    copy_file(python_root / "LICENSE.txt", bundle / "THIRD_PARTY" / "CPython-LICENSE.txt")
    copy_file(node_root / "LICENSE", bundle / "THIRD_PARTY" / "Node-LICENSE.txt")
    root_license = project.parent / "LICENSE"
    if root_license.is_file():
        copy_file(root_license, bundle / "REPOSITORY-LICENSE.txt")
    (bundle / "SOURCE-LICENSE-SCOPE.txt").write_text(
        "PolicyGlass original source is supplied for this competition's local evaluation.\n"
        "This package does not create a new open-source grant. Repository/source licensing\n"
        "requires the author's confirmation if no applicable explicit license accompanies it.\n"
        "Third-party software retains its own licenses, archived under THIRD_PARTY/.\n"
        "Do not redistribute if third-party-notices.json lists unresolved notice gaps.\n",
        "utf-8",
    )
    dump(bundle / "third-party-notices.json", license_report)
    revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=project, text=True).strip()
    dirty = subprocess.check_output(
        ["git", "status", "--porcelain", "--", "."], cwd=project, text=True
    ).splitlines()
    inventory = {}
    for path in sorted(bundle.rglob("*")):
        if path.is_file():
            inventory[path.relative_to(bundle).as_posix()] = {
                "sha256": digest(path),
                "bytes": path.stat().st_size,
            }
    manifest = {
        "schema": "policyglass.offline.v1",
        "created_utc": datetime.now(UTC).isoformat(),
        "source_revision": revision,
        "uncommitted_project_paths": dirty,
        "scope": "Windows x64 self-contained local evaluation; not cross-machine certified",
        "status": "LOCAL_REVIEW_PACKAGE"
        if not license_report["gaps"]
        else "NOTICE_GAPS_REVIEW_ONLY",
        "python": "CPython 3.12.7 embedded AMD64",
        "node": "24.22.1",
        "mujoco": "4.0.1 WASM",
        "provenance": provenance,
        "assembly_seconds": time.perf_counter() - started,
        "files": inventory,
        "total_bytes": sum(x["bytes"] for x in inventory.values()),
        "secret_policy": "explicit source allowlist; no credentials/private evidence/stores included",
        "verification": "not yet run; scripts/Verify-Offline.ps1 writes runtime-only report",
        "registered_study_examples": len(study_examples),
    }
    dump(bundle / "manifest.json", manifest)
    print(
        json.dumps(
            {
                "bundle": str(bundle),
                "files": len(inventory),
                "bytes": manifest["total_bytes"],
                "seconds": manifest["assembly_seconds"],
                "notice_gaps": license_report["gaps"],
            },
            ensure_ascii=False,
        )
    )


def request(base, path, data=None):
    payload = None if data is None else json.dumps(data, allow_nan=False).encode()
    req = urllib.request.Request(
        base + path, data=payload, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=90) as response:
        return json.loads(response.read())


def verify(args):
    started = time.perf_counter()
    bundle = d_path(args.root)
    runtime = bundle / ".runtime"
    runtime.mkdir(exist_ok=True)
    result = {
        "schema": "policyglass.offline-verification.v1",
        "status": "RUNNING",
        "platform": platform.platform(),
        "python": sys.version,
        "executable": sys.executable,
        "prefix": sys.prefix,
        "sys_path": sys.path,
        "bundle": str(bundle),
        "same_machine_only": True,
        "source_runtime_required": False,
        "checks": {},
    }
    server = None
    try:
        import sitecustomize

        if not getattr(sitecustomize, "POLICYGLASS_OFFLINE_GUARD", False):
            raise ValueError("Use the bundled embedded Python with offline guard")
        if not Path(sys.executable).resolve().is_relative_to(bundle):
            raise ValueError("Verification interpreter is outside the independent bundle")
        for path in sys.path:
            if path and not Path(path).resolve().is_relative_to(bundle):
                raise ValueError("Interpreter search path escapes bundle")
        try:
            socket.getaddrinfo("api.deepseek.com", 443)
            raise ValueError("External network guard did not block DNS")
        except OSError:
            result["checks"]["external_python_network_blocked"] = True
        manifest = json.loads((bundle / "manifest.json").read_text("utf-8"))
        mismatches = []
        for name, item in manifest["files"].items():
            path = bundle / name
            if (
                not path.resolve().is_relative_to(bundle)
                or not path.is_file()
                or digest(path) != item["sha256"]
            ):
                mismatches.append(name)
        extras = [
            p.relative_to(bundle).as_posix()
            for p in bundle.rglob("*")
            if p.is_file()
            and p.relative_to(bundle).parts[0] != ".runtime"
            and p.relative_to(bundle).as_posix() not in manifest["files"]
            and p.name != "manifest.json"
        ]
        if mismatches or extras:
            raise ValueError(f"Bundle integrity mismatch: {mismatches}; unexpected files: {extras}")
        result["checks"]["manifest_file_count"] = len(manifest["files"])
        import torch

        import policyglass

        result["checks"]["torch"] = {"version": torch.__version__, "file": torch.__file__}
        result["checks"]["policyglass_source"] = policyglass.__file__
        result["checks"]["node"] = subprocess.check_output(
            [str(bundle / "runtime" / "node" / "node.exe"), "--version"], text=True
        ).strip()
        base = f"http://127.0.0.1:{args.port}"
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", args.port))
        log_context = ExitStack()
        logs = [
            log_context.enter_context(open(runtime / name, "w", encoding="utf-8"))  # noqa: SIM115 -- explicitly closed ExitStack
            for name in ("verify-api.stdout.log", "verify-api.stderr.log")
        ]
        try:
            server = subprocess.Popen(
                [
                    sys.executable,
                    "-B",
                    "-m",
                    "policyglass.cli",
                    "serve",
                    "--port",
                    str(args.port),
                    "--data",
                    str(runtime / ("verify-store-" + uuid.uuid4().hex)),
                ],
                cwd=bundle,
                env=os.environ.copy(),
                stdout=logs[0],
                stderr=logs[1],
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
            deadline = time.monotonic() + 60
            while True:
                if server.poll() is not None:
                    raise RuntimeError("Owned offline API exited; see verify-api.stderr.log")
                try:
                    health = request(base, "/api/health")
                    break
                except (OSError, ValueError):
                    if time.monotonic() > deadline:
                        raise TimeoutError("Owned offline API readiness exceeded 60s")
                    time.sleep(0.2)
            result["checks"]["health"] = health
            with urllib.request.urlopen(base + "/", timeout=10) as page:
                html = page.read().decode()
            local_assets = re.findall(r'(?:src|href)="(/assets/[^\"]+)"', html)
            if not local_assets:
                raise ValueError("Offline production entry has no local built assets")
            for asset in local_assets:
                with urllib.request.urlopen(base + asset, timeout=10) as response:
                    if response.status != 200 or not response.read():
                        raise ValueError("Missing production asset")
            result["checks"]["production_local_assets"] = local_assets
            experiments = []
            for algorithm in ("ppo", "sac"):
                created = request(
                    base,
                    "/api/experiments",
                    {
                        "label": "offline-" + algorithm,
                        "config": {
                            "algorithm": algorithm,
                            "seed": 17,
                            "network": {"hidden": [8, 8]},
                            "ppo": {"rollout_steps": 8, "minibatch_size": 8, "epochs": 1},
                            "sac": {"batch_size": 8, "warmup_steps": 8},
                        },
                    },
                )
                job = request(
                    base,
                    f"/api/experiments/{created['id']}/jobs",
                    {"iterations": 1, "record": True, "mode": "train"},
                )
                deadline = time.monotonic() + 90
                while job["status"] not in ("completed", "failed", "cancelled"):
                    if time.monotonic() > deadline:
                        raise TimeoutError("Offline numerical job exceeded 90s")
                    time.sleep(0.1)
                    job = request(base, "/api/jobs/" + job["id"])
                if job["status"] != "completed" or not job["trace"]:
                    raise ValueError("Offline numerical job did not complete with actual Trace")
                trace = request(base, "/api/traces/" + job["trace"])
                if not any(e["kind"] == "optimizer" for e in trace["events"]):
                    raise ValueError("No actual optimizer event in offline Trace")
                experiments.append(
                    {
                        "algorithm": algorithm,
                        "job_id": job["id"],
                        "trace_id": job["trace"],
                        "events": len(trace["events"]),
                        "checkpoint": job["checkpoint"],
                        "summary": job["summary"],
                    }
                )
            result["checks"]["actual_learning_jobs"] = experiments
            result["status"] = "PASSED"
        finally:
            if server and server.poll() is None:
                server.terminate()
                server.wait(timeout=15)
            log_context.close()
    except Exception as exc:
        result["status"] = "FAILED"
        result["error"] = f"{type(exc).__name__}: {exc}"
        raise
    finally:
        result["elapsed_seconds"] = time.perf_counter() - started
        result["under_ten_minutes_from_existing_local_bundle"] = (
            result["status"] == "PASSED" and result["elapsed_seconds"] < 600
        )
        result["limitations"] = [
            "Same host, new D: package; not a cross-machine result",
            "No learner or successful-policy claim",
            "Network guard limits bundled Python, not the operating system or Node",
            "Build/download/initial archive extraction are timed separately",
        ]
        dump(runtime / "verification.json", result)
        print(
            json.dumps(
                {
                    "status": result["status"],
                    "seconds": result["elapsed_seconds"],
                    "report": str(runtime / "verification.json"),
                },
                ensure_ascii=False,
            )
        )


def make_zip(args):
    root = d_path(args.root)
    output = root.with_suffix(".zip")
    if output.exists():
        raise ValueError("Archive already exists; choose a new release name")
    start = time.perf_counter()
    with zipfile.ZipFile(output, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=1) as archive:
        for path in sorted(root.rglob("*")):
            if path.is_file() and path.relative_to(root).parts[0] != ".runtime":
                archive.write(path, root.name + "/" + path.relative_to(root).as_posix())
    dump(
        output.with_suffix(".zip.sha256.json"),
        {
            "sha256": digest(output),
            "bytes": output.stat().st_size,
            "archive_seconds": time.perf_counter() - start,
            "file": output.name,
        },
    )
    print(str(output))


def main():
    parser = argparse.ArgumentParser(__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    build = commands.add_parser("build")
    build.add_argument("--project", required=True)
    build.add_argument("--name", required=True)
    build.add_argument("--npm-tree", required=True)
    build.add_argument("--rendered-modules", required=True)
    build.add_argument("--include-study", action="store_true")
    verify_parser = commands.add_parser("verify")
    verify_parser.add_argument("--root", required=True)
    verify_parser.add_argument("--port", type=int, default=8791)
    zip_parser = commands.add_parser("zip")
    zip_parser.add_argument("--root", required=True)
    args = parser.parse_args()
    {"build": assemble, "verify": verify, "zip": make_zip}[args.command](args)


if __name__ == "__main__":
    main()
