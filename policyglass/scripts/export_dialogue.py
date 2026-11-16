"""Read a genuine Codex JSONL; write private original and redacted public excerpts on D:."""

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
        raise SystemExit("Exports must be written on D:")
    data = args.source.read_bytes()
    private = root / "evidence" / "private"
    private.mkdir(parents=True, exist_ok=True)
    (private / "stage1-native-session.jsonl").write_bytes(data)
    marker = "行，就按这份方案开始全流程开发，先把完整开发文档写进仓库。"
    records = []
    started = False
    for line in data.decode("utf-8").splitlines():
        entry = json.loads(line)
        if entry.get("type") != "response_item":
            continue
        payload = entry.get("payload", {})
        if payload.get("type") == "message" and payload.get("role") == "user":
            body = "\n".join(item.get("text", "") for item in payload.get("content", []))
            if marker in body:
                started = True
        if not started:
            continue
        if payload.get("type") == "message":
            if (
                payload.get("role") not in ("user", "assistant")
                or payload.get("channel") == "analysis"
            ):
                continue
        elif payload.get("type") not in (
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
    if not records:
        raise SystemExit("Authorization marker was not found; refusing a misleading export")
    output = root / "evidence" / "dialogue-stage1.jsonl"
    output.write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in records) + "\n", encoding="utf-8"
    )
    manifest = {
        "schema": "policyglass.dialogue-export.v1",
        "captured_at": datetime.now(UTC).isoformat(),
        "native_source_name": args.source.name,
        "native_sha256": hashlib.sha256(data).hexdigest(),
        "public_sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        "records": len(records),
        "scope": "Available response-item messages and tool events from the real Stage1 authorization onward; current turn may still be running",
        "omissions": [
            "Earlier historical topic discussions",
            "Internal analysis/reasoning",
            "System/developer context and duplicate telemetry",
        ],
        "redactions": ["API-key and private-key patterns"],
        "authorship": "Human user messages and assistant/tool records retain their native roles. No dialogue synthesized.",
        "competition_status": "This capture alone does not establish three complete human-guided feature iteration chains.",
    }
    (root / "evidence" / "dialogue-stage1-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps({"records": len(records), "public_bytes": output.stat().st_size}))


if __name__ == "__main__":
    main()
