"""Compact all-seed results and explicit safe import of locally bundled study states."""

import hashlib
import json
import math
import re
from pathlib import Path
from typing import Literal

from fastapi import HTTPException

from .agents import Learner
from .checkpoint import MAX_BYTES, decode
from .config import StrictModel

CONDITIONS = ("ppo_reference", "ppo_large_step", "sac_reuse1", "sac_reuse4")
SEEDS = (11, 23, 37, 53, 71)
METRICS = (
    "env_steps",
    "updates",
    "seconds",
    "initial_mean_distance_m",
    "mean_distance_m",
    "last32_distance_m",
    "return",
    "success_fraction",
)
AGGREGATES = ("mean_distance_m", "last32_distance_m", "return", "success_fraction", "seconds")
REPORT = "evidence/025-stage3-study-results.json"
SCOPE = (
    "固定目标 [0.45,0.12,0.45] m；五个训练种子分别评价五个初始状态种子。"
    "显示全部登记结果，不默认挑选最好种子。距离越小越好；成功占比是距离小于0.04m的步数比例，"
    "不等于策略普遍成功。PPO/SAC预算不同，不据此作同等算力排名；未验证新目标、真实硬件或教学效果。"
)


def finite_number(value):
    return type(value) in (int, float) and math.isfinite(value)


def load_json(path, maximum):
    if path.stat().st_size > maximum:
        raise ValueError("Public study document exceeds budget")
    blob = path.read_bytes()
    if len(blob) > maximum:
        raise ValueError("Public study document exceeds budget")

    def reject_nonfinite(_):
        raise ValueError("Nonfinite JSON")

    value = json.loads(blob, parse_constant=reject_nonfinite)
    if not isinstance(value, dict):
        raise TypeError("Public study document must be an object")
    return value, hashlib.sha256(blob).hexdigest()


class ImportStudyRequest(StrictModel):
    condition: Literal["ppo_reference", "ppo_large_step", "sac_reuse1", "sac_reuse4"]
    seed: Literal[11, 23, 37, 53, 71]


class StudyCatalog:
    def __init__(self, repository, project_root=None):
        self.repository = repository
        self.root = Path(project_root or Path(__file__).resolve().parents[2]).resolve()
        if self.root.drive.upper() == "C:":
            raise ValueError("Study artifacts must be on D:")
        self._hash_cache = {}

    def _file(self, relative):
        # This helper is never called with browser-provided relative paths.
        path = (self.root / relative).resolve()
        if not path.is_relative_to(self.root) or path.drive.upper() == "C:":
            raise ValueError("Study artifact crosses the configured project boundary")
        return path

    def _checkpoint(self, condition, seed):
        if condition not in CONDITIONS or type(seed) is not int or seed not in SEEDS:
            raise ValueError("Unknown preregistered condition or seed")
        packaged = self._file("examples/study")
        folder = "examples/study" if packaged.is_dir() else ".runtime/stage3-study"
        return self._file(f"{folder}/{condition}-{seed}/final.pgz"), folder

    def _matching_hash(self, path, expected):
        stat = path.stat()
        if stat.st_size > MAX_BYTES + 1024 * 1024:
            return False
        cache_key = (str(path), stat.st_size, stat.st_mtime_ns, expected)
        if cache_key not in self._hash_cache:
            digest = hashlib.sha256()
            with path.open("rb") as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(chunk)
            self._hash_cache = {
                cache_key: digest.hexdigest() == expected,
                **{key: value for key, value in self._hash_cache.items() if key[0] != str(path)},
            }
        return self._hash_cache[cache_key]

    def _protocol(self, document):
        source = document.get("protocol")
        if not isinstance(source, dict):
            raise TypeError("Missing study protocol")
        rows = source.get("conditions")
        if (
            not isinstance(rows, list)
            or len(rows) != len(CONDITIONS)
            or any(not isinstance(row, dict) for row in rows)
            or {row.get("name") for row in rows} != set(CONDITIONS)
            or source.get("training_seeds") != list(SEEDS)
            or source.get("evaluation_seeds") != [701, 702, 703, 704, 705]
        ):
            raise ValueError("Preregistered condition/seed mismatch")
        conditions = []
        for condition in CONDITIONS:
            row = next(row for row in rows if row["name"] == condition)
            algorithm = "ppo" if condition.startswith("ppo") else "sac"
            if row.get("algorithm") != algorithm or type(row.get("environment_steps")) is not int:
                raise ValueError("Invalid condition budget or algorithm")
            if not 1 <= row["environment_steps"] <= 1000000:
                raise ValueError("Invalid condition budget")
            conditions.append(
                {
                    key: row[key]
                    for key in (
                        "name",
                        "algorithm",
                        "environment_steps",
                        "learning_rate",
                        "updates_per_step",
                    )
                    if key in row and (key in ("name", "algorithm") or finite_number(row[key]))
                }
            )
        return {
            "training_seeds": list(SEEDS),
            "evaluation_seeds": [701, 702, 703, 704, 705],
            "evaluation_steps": source.get("evaluation_steps")
            if type(source.get("evaluation_steps")) is int
            else None,
            "network": source.get("network")
            if (
                isinstance(source.get("network"), list)
                and 1 <= len(source["network"]) <= 3
                and all(type(n) is int and 2 <= n <= 128 for n in source["network"])
            )
            else [],
            "conditions": conditions,
        }

    def _read(self):
        path = self._file(REPORT)
        if not path.is_file():
            return None, None
        return load_json(path, 4 * 1024 * 1024)

    def _rows(self, document, protocol):
        runs, summary = document.get("runs"), document.get("summary")
        if not isinstance(runs, list) or len(runs) > 20 or not isinstance(summary, dict):
            raise ValueError("Invalid all-seed report")
        seen = set()
        for row in runs:
            if not isinstance(row, dict):
                raise TypeError("Invalid study row")
            key = (row.get("condition"), row.get("seed"))
            if (
                key[0] not in CONDITIONS
                or type(key[1]) is not int
                or key[1] not in SEEDS
                or key in seen
            ):
                raise ValueError("Unknown or duplicate study row")
            seen.add(key)
        rows, aggregates = [], {}
        for condition in CONDITIONS:
            group = summary.get(condition, {})
            if not isinstance(group, dict) or not isinstance(group.get("per_seed", []), list):
                raise TypeError("Invalid per-seed summary")
            per_seed = group.get("per_seed", [])
            if any(
                not isinstance(item, dict) or item.get("seed") not in SEEDS for item in per_seed
            ) or len({item["seed"] for item in per_seed}) != len(per_seed):
                raise ValueError("Unknown or duplicate per-seed summary")
            aggregates[condition] = {
                metric: {
                    key: value
                    for key, value in group[metric].items()
                    if key in ("median", "q25", "q75", "min", "max") and finite_number(value)
                }
                for metric in AGGREGATES
                if isinstance(group.get(metric), dict)
            }
            budget = next(
                row["environment_steps"]
                for row in protocol["conditions"]
                if row["name"] == condition
            )
            for seed in SEEDS:
                run = next(
                    (row for row in runs if row["condition"] == condition and row["seed"] == seed),
                    {},
                )
                metrics = next((row for row in per_seed if row["seed"] == seed), {})
                status = run.get("status", "not_reported")
                if status not in (
                    "completed",
                    "failed",
                    "running",
                    "timeout",
                    "cancelled",
                    "not_reported",
                ):
                    status = "invalid_result"
                row = {
                    "condition": condition,
                    "seed": seed,
                    "status": status,
                    "available": False,
                    "availability": "result_not_completed",
                    "budget_env_steps": budget,
                    "metrics": {
                        key: metrics[key] for key in METRICS if finite_number(metrics.get(key))
                    },
                }
                if not metrics:
                    row["metrics"] = {
                        key: run[key]
                        for key in ("env_steps", "updates", "seconds")
                        if finite_number(run.get(key))
                    }
                if status != "completed":
                    row["error"] = str(run.get("error", ""))[:240]
                elif (
                    any(not finite_number(metrics.get(key)) for key in METRICS)
                    or metrics["env_steps"] < budget
                    or metrics["env_steps"] != run.get("env_steps")
                    or metrics["updates"] != run.get("updates")
                    or not 0 <= metrics["success_fraction"] <= 1
                ):
                    row["availability"] = "invalid_summary"
                elif not isinstance(run.get("checkpoint_sha256"), str) or not re.fullmatch(
                    r"[0-9a-f]{64}", run["checkpoint_sha256"]
                ):
                    row["availability"] = "missing_recorded_hash"
                else:
                    row["checkpoint_sha256"] = run["checkpoint_sha256"]
                    try:
                        path, source = self._checkpoint(condition, seed)
                        row["checkpoint_source"] = (
                            "bundled_examples" if source == "examples/study" else "local_study"
                        )
                        if not path.is_file():
                            row["availability"] = "checkpoint_missing"
                        elif not self._matching_hash(path, run["checkpoint_sha256"]):
                            row["availability"] = "checkpoint_hash_mismatch"
                        else:
                            row.update(available=True, availability="available")
                    except (ValueError, OSError):
                        row["availability"] = "checkpoint_boundary_or_read_error"
                rows.append(row)
        return rows, aggregates

    def catalog(self):
        baseline = [
            {
                "condition": condition,
                "seed": seed,
                "status": "not_reported",
                "metrics": {},
                "available": False,
                "availability": "report_unavailable",
            }
            for condition in CONDITIONS
            for seed in SEEDS
        ]
        result = {
            "schema": "policyglass.study-catalog.v1",
            "source": REPORT,
            "scope": SCOPE,
            "rows": baseline,
            "aggregates": {},
            "protocol": None,
            "available": False,
            "error": None,
        }
        try:
            document, digest = self._read()
            if document is None:
                try:
                    registration, _ = load_json(self._file("docs/STAGE3_STUDY.json"), 65536)
                    result["protocol"] = self._protocol({"protocol": registration})
                    for row in baseline:
                        row["budget_env_steps"] = next(
                            item["environment_steps"]
                            for item in result["protocol"]["conditions"]
                            if item["name"] == row["condition"]
                        )
                except (ValueError, OSError, KeyError, TypeError):
                    pass
                result["error"] = "登记研究结果尚未发布；此处不填写推测成绩。"
                return result
            if document.get("schema") != "policyglass.study-results.v1":
                raise ValueError("Unsupported study results schema")
            protocol = self._protocol(document)
            rows, aggregates = self._rows(document, protocol)
            result.update(
                rows=rows,
                aggregates=aggregates,
                protocol=protocol,
                report_sha256=digest,
                available=True,
            )
        except (ValueError, OSError, KeyError, TypeError, RecursionError):
            result["error"] = "公开研究文件缺失、损坏或不符合登记条件；导入已禁用。"
        return result

    def import_checkpoint(self, condition, seed):
        if condition not in CONDITIONS or type(seed) is not int or seed not in SEEDS:
            raise ValueError("Unknown preregistered condition or seed")
        catalog = self.catalog()
        row = next(
            row for row in catalog["rows"] if row["condition"] == condition and row["seed"] == seed
        )
        if not catalog["available"] or not row["available"]:
            raise HTTPException(
                409, "This registered study checkpoint is unavailable; inspect its recorded status"
            )
        path, _ = self._checkpoint(condition, seed)
        try:
            if path.stat().st_size > MAX_BYTES + 1024 * 1024:
                raise ValueError("Study checkpoint exceeds budget")
            blob = path.read_bytes()
            if hashlib.sha256(blob).hexdigest() != row["checkpoint_sha256"]:
                raise ValueError("Study checkpoint changed after catalog validation")
            state, _ = decode(blob)
            condition_config = next(
                item for item in catalog["protocol"]["conditions"] if item["name"] == condition
            )
            if (
                state["config"]["seed"] != seed
                or state["config"]["algorithm"] != ("ppo" if condition.startswith("ppo") else "sac")
                or state["env_steps"] != row["metrics"]["env_steps"]
                or state["updates"] != row["metrics"]["updates"]
                or state["config"]["network"]["hidden"] != catalog["protocol"]["network"]
                or any(
                    state["config"][condition_config["algorithm"]][key] != condition_config[key]
                    for key in ("learning_rate", "updates_per_step")
                    if key in condition_config
                )
            ):
                raise ValueError("Study state provenance differs from recorded result")
            learner = Learner.from_state(state)
        except (
            ValueError,
            OSError,
            RuntimeError,
            TypeError,
            KeyError,
            IndexError,
            AttributeError,
            OverflowError,
        ) as exc:
            raise HTTPException(
                400, "Bundled study checkpoint failed safe decoding or provenance validation"
            ) from exc
        provenance = {
            "kind": "reference_study_import",
            "condition": condition,
            "seed": seed,
            "checkpoint_sha256": row["checkpoint_sha256"],
            "report_sha256": catalog["report_sha256"],
            "source": REPORT,
            "original_env_steps": learner.env_steps,
            "original_updates": learner.updates,
            "scope": "loaded trained state; no learning, no source overwrite; not a universal success claim",
        }
        try:
            experiment = self.repository.create(
                learner, label=f"登记研究 · {condition} · seed {seed}", intervention=provenance
            )
        finally:
            learner.env.close()
        return {"experiment": experiment, "source": provenance}


def install_study_catalog(app, repository, project_root=None):
    catalog = StudyCatalog(repository, project_root=project_root)
    app.state.study_catalog = catalog

    @app.get("/api/studies/reference")
    def get_reference():
        return catalog.catalog()

    @app.post("/api/studies/reference/import", status_code=201)
    def import_reference(request: ImportStudyRequest):
        return catalog.import_checkpoint(request.condition, request.seed)

    return catalog
