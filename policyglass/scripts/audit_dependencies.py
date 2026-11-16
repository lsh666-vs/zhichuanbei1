"""Point-in-time public OSV queries for the exact lock; no private experiment data."""

import argparse
import hashlib
import json
import re
from datetime import UTC, datetime
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]


def compact_advisory(document):
    return {
        **{
            key: document[key]
            for key in ("id", "aliases", "summary", "published", "modified", "references")
            if key in document
        },
        "affected": [
            {key: row[key] for key in ("package", "ranges") if key in row}
            for row in document.get("affected", [])
        ],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--lock", default="requirements-win-py312.lock")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    output = Path(args.output).resolve()
    if output.drive.upper() != "D:":
        raise ValueError("Audit output must stay on D:")
    lock = Path(args.lock).resolve()
    packages = []
    for line in lock.read_text(encoding="utf-8").splitlines():
        match = re.fullmatch(r"([A-Za-z0-9_.-]+)==(.+)", line)
        if match:
            packages.append(
                {"name": match[1], "version": match[2].split("+")[0], "installed_version": match[2]}
            )
    queries = [
        {"package": {"name": row["name"], "ecosystem": "PyPI"}, "version": row["version"]}
        for row in packages
    ]
    with httpx.Client(timeout=60) as client:
        response = client.post("https://api.osv.dev/v1/querybatch", json={"queries": queries})
        response.raise_for_status()
        raw = response.json()
        findings = []
        for package, result in zip(packages, raw["results"], strict=True):
            for item in result.get("vulns", []):
                response = client.get("https://api.osv.dev/v1/vulns/" + item["id"])
                response.raise_for_status()
                findings.append({"package": package, "advisory": compact_advisory(response.json())})
    document = {
        "schema": "policyglass.dependency-audit.v1",
        "checked_at": datetime.now(UTC).isoformat(),
        "service": "https://api.osv.dev/v1/querybatch",
        "lock_sha256": hashlib.sha256(lock.read_bytes()).hexdigest(),
        "packages": packages,
        "raw_results": raw["results"],
        "findings": findings,
        "omissions": [
            "Long advisory prose, exploit examples and enumerated version lists omitted. IDs, aliases, affected ranges and original source links retained."
        ],
        "limitations": [
            "Point-in-time OSV query, not a penetration test or absence-of-vulnerabilities guarantee.",
            "Local +cpu suffix queried as upstream base version; installed version retained. Alias records must not be counted as distinct vulnerabilities.",
        ],
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(document, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {"packages": len(packages), "advisory_records": len(findings), "output": str(output)}
        )
    )


if __name__ == "__main__":
    main()
