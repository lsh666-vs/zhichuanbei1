"""Independent exhaustive/graph reference checks. No imports from the product engine.

Run python -B tests/oracle.py from project root. All test artifacts remain under
.runtime on D:. This validates finite fixtures, not universal mathematical proof.
"""
import itertools
import json
import os
from pathlib import Path
import random
import subprocess
import time
from fractions import Fraction

ROOT = Path(__file__).resolve().parents[1]
RNG = random.Random(20261115)


def strategy(domain, score, direction="desc", algorithm="greedy"):
    return dict(id="independent-check", name="Independent check", domain=domain,
                algorithm=algorithm, score=score, direction=direction, tieBreak="id")


def subsets(items):
    for flags in itertools.product((False, True), repeat=len(items)):
        yield [item for item, include in zip(items, flags) if include]


def interval_opt(instance):
    best = 0
    for subset in subsets(instance["items"]):
        ordered = sorted(subset, key=lambda item: (item["start"], item["end"]))
        if all(a["end"] <= b["start"] for a, b in zip(ordered, ordered[1:])):
            value = len(subset) if instance["objective"] == "count" else sum(x["value"] for x in subset)
            best = max(best, value)
    return best


def knapsack_opt(instance):
    return max(sum(x["value"] for x in subset) for subset in subsets(instance["items"])
               if sum(x["weight"] for x in subset) <= instance["capacity"])


def graph_opt(instance):
    # Enumerate simple paths, independent from product shortest-path code.
    adjacency = {n["id"]: [] for n in instance["nodes"]}
    for edge in instance["edges"]:
        adjacency[edge["from"]].append((edge["to"], edge["weight"]))
        if not instance["directed"]:
            adjacency[edge["to"]].append((edge["from"], edge["weight"]))
    best = None

    def visit(node, seen, distance):
        nonlocal best
        if node == instance["target"]:
            best = distance if best is None else min(best, distance)
            return
        if best is not None and distance > best:
            return
        for target, weight in adjacency[node]:
            if target not in seen:
                visit(target, seen | {target}, distance + weight)
    visit(instance["source"], {instance["source"]}, 0)
    return best


def expected_greedy(instance, policy):
    def score(item):
        metric = policy["score"]
        if metric == "value / weight":
            return Fraction(item["value"], item["weight"])
        if metric == "duration":
            return item["end"] - item["start"]
        return item[metric]
    sign = 1 if policy["direction"] == "asc" else -1
    selected = []
    for item in sorted(instance["items"], key=lambda x: (sign * score(x), x["id"])):
        if instance["domain"] == "interval":
            fits = all(item["end"] <= old["start"] or old["end"] <= item["start"] for old in selected)
        else:
            fits = sum(x["weight"] for x in selected) + item["weight"] <= instance["capacity"]
        if fits:
            selected.append(item)
    return (len(selected) if instance.get("objective") == "count" else sum(x["value"] for x in selected))


def fixtures():
    cases = []
    for index in range(320):
        items = []
        for i in range(RNG.randint(1, 9)):
            start = RNG.randint(0, 10)
            items.append(dict(id=f"i{i}", label=f"T{i}", start=start, end=start + RNG.randint(1, 6), value=RNG.randint(0, 20)))
        instance = dict(domain="interval", items=items, objective="count" if index % 2 else "value")
        score, direction = RNG.choice([("value", "desc"), ("duration", "asc"), ("start", "asc"), ("end", "asc")])
        cases.append(dict(instance=instance, strategy=strategy("interval", score, direction)))
    for index in range(320):
        items = [dict(id=f"i{i}", label=f"I{i}", weight=RNG.randint(1, 12), value=RNG.randint(0, 25)) for i in range(RNG.randint(1, 10))]
        instance = dict(domain="knapsack", items=items, capacity=RNG.randint(0, 24))
        score, direction = RNG.choice([("value", "desc"), ("weight", "asc"), ("value / weight", "desc")])
        cases.append(dict(instance=instance, strategy=strategy("knapsack", score, direction)))
    for index in range(320):
        n = RNG.randint(2, 7)
        directed = bool(index % 2)
        nodes = [dict(id=f"n{i}", label=f"N{i}", x=i * 10, y=(i % 2) * 10) for i in range(n)]
        edges = []
        for a in range(n):
            for b in range(n):
                if a == b or (not directed and a > b):
                    continue
                if RNG.random() < 0.28:
                    edges.append(dict(id=f"e{a}_{b}", **{"from": f"n{a}", "to": f"n{b}"}, weight=RNG.randint(0, 15)))
        instance = dict(domain="graph", nodes=nodes, edges=edges, source="n0", target=f"n{n-1}", directed=directed)
        cases.append(dict(instance=instance, strategy=strategy("graph", "weight", "asc", "dijkstra")))
    return cases


def main():
    started = time.perf_counter()
    cases = fixtures()
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
    run = subprocess.run(["node", "--import", "tsx", "scripts/oracle-runner.ts"], input=json.dumps(cases),
                         text=True, encoding="utf-8", capture_output=True, cwd=ROOT, env=env, timeout=120)
    if run.returncode:
        raise RuntimeError(run.stderr)
    results = json.loads(run.stdout)
    if len(results) != len(cases):
        raise AssertionError("Batch size changed")
    errors = []
    counters = {"interval": 0, "knapsack": 0, "graph": 0}
    for index, (case, result) in enumerate(zip(cases, results)):
        instance = case["instance"]
        domain = instance["domain"]
        if not result["ok"]:
            errors.append(dict(index=index, domain=domain, error=result["error"]))
            continue
        evaluation = result["evaluation"]
        expected = {"interval": interval_opt, "knapsack": knapsack_opt, "graph": graph_opt}[domain](instance)
        reference = evaluation["reference"]
        if expected is None:
            if reference["complete"]:
                errors.append(dict(index=index, domain=domain, error="Reference invented reachable path"))
        elif reference["value"] != expected or not reference["complete"]:
            errors.append(dict(index=index, domain=domain, error=f"Reference {reference['value']} != independent {expected}"))
        if domain != "graph":
            candidate = expected_greedy(instance, case["strategy"])
            if evaluation["candidate"]["value"] != candidate:
                errors.append(dict(index=index, domain=domain, error=f"Candidate != independent greedy {candidate}"))
            should_fail = candidate < expected
            if (evaluation["verdict"] == "counterexample") != should_fail:
                errors.append(dict(index=index, domain=domain, error="Incorrect counterexample verdict"))
        elif evaluation["verdict"] == "counterexample":
            errors.append(dict(index=index, domain=domain, error="Correct shortest-path strategy falsely refuted"))
        counters[domain] += 1
    output = dict(kind="independent-python-reference", seed=20261115, cases=len(cases), perDomain=counters,
                  passed=len(errors) == 0, errors=errors, elapsedSeconds=round(time.perf_counter()-started, 3),
                  scope="Finite seeded cases; not a universal correctness proof")
    runtime = ROOT / ".runtime"
    runtime.mkdir(exist_ok=True)
    (runtime / "oracle-results.json").write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    if errors:
        (runtime / "oracle-failed-cases.json").write_text(json.dumps([cases[e["index"]] for e in errors], ensure_ascii=False), encoding="utf-8")
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
