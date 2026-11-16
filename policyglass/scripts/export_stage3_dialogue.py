"""Copy the native session read-only and publish a scoped, genuine excerpt on D:."""

import argparse
import hashlib
import json
import re
from datetime import UTC, datetime
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    if root.drive.upper() != "D:":
        raise SystemExit("Evidence destination must be D:")
    raw = args.source.read_bytes()
    private = root / "evidence/private"
    private.mkdir(parents=True, exist_ok=True)
    (private / "stage3-native-session.jsonl").write_bytes(raw)
    records = []
    counts = {}
    for line in raw.decode("utf8").splitlines():
        entry = json.loads(line)
        if entry.get("type") != "response_item":
            continue
        payload = entry.get("payload", {})
        kind = payload.get("type", "")
        if kind == "message":
            if (
                payload.get("role") not in ("user", "assistant")
                or payload.get("channel") == "analysis"
            ):
                continue
        elif kind not in (
            "function_call",
            "function_call_output",
            "custom_tool_call",
            "custom_tool_call_output",
        ):
            continue
        text = json.dumps(entry, ensure_ascii=False)
        text = re.sub(r"sk-[A-Za-z0-9_-]{20,}", "[REDACTED_API_KEY]", text)
        text = re.sub(
            r"-----BEGIN [^-]*PRIVATE KEY-----.*?-----END [^-]*PRIVATE KEY-----",
            "[REDACTED_PRIVATE_KEY]",
            text,
            flags=re.DOTALL,
        )
        records.append(json.loads(text))
        key = payload.get("role", kind)
        counts[key] = counts.get(key, 0) + 1
    destination = root / "evidence/dialogue-stage3.jsonl"
    destination.write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in records) + "\n",
        encoding="utf8",
        newline="\n",
    )
    manifest = {
        "schema": "policyglass.dialogue-export.v1",
        "captured_at": datetime.now(UTC).isoformat(),
        "native_source_name": args.source.name,
        "native_sha256": hashlib.sha256(raw).hexdigest(),
        "public_sha256": hashlib.sha256(destination.read_bytes()).hexdigest(),
        "record_counts": counts,
        "scope": "Stage3 native session snapshot through capture time; later messages/final handoff are not yet present.",
        "omissions": [
            "system/developer context and internal reasoning are excluded from public excerpt",
            "event metadata outside response_item omitted",
            "private original stays ignored; API/private-key patterns redacted in excerpt",
        ],
        "authorship": "Coordinator/delegation messages are machine-generated handoffs, never independent human feedback. No learner feedback or three human Prompt chains are fabricated.",
        "private_copy": "evidence/private/stage3-native-session.jsonl",
    }
    (root / "evidence/dialogue-stage3-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf8"
    )
    print(
        json.dumps(
            {
                "records": len(records),
                "native_bytes": len(raw),
                "public_bytes": destination.stat().st_size,
            }
        )
    )


if __name__ == "__main__":
    main()
