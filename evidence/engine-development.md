# Deterministic engine implementation and verification

Date: 2026-11-15. Engine version: `1.0.0`.

This record describes actual implementation and commands executed in the D: workspace. It is a development record, not a reconstructed user conversation or a claim of universal correctness.

## Implemented behavior

The synchronous public API is exported from `src/engine/index.ts`: evaluation, validation, examples/presets, seeded search, shrinking, and regression. Expensive API work belongs in a backend worker. All public execution results are JSON-safe; Infinity is only an internal shortest-path/deficit sentinel.

| Domain | Candidate behavior | Exact reference | Independent value check |
| --- | --- | --- | --- |
| Interval | Sort by exact arithmetic score and greedily accept compatible half-open intervals; or exact DP | End-time/predecessor dynamic programming | Time-indexed dynamic programming; counterexamples additionally checked by exhaustive subset enumeration |
| 0-1 knapsack | Sort by score and accept each fitting indivisible item once; or exact DP | Capacity-indexed dynamic programming using previous-item rows | Meet-in-the-middle subset enumeration with binary search |
| Nonnegative graph | Locally choose the best outgoing edge to an unvisited node, without backtracking; or global Dijkstra | Dijkstra shortest path | Synchronous Bellman–Ford rounds |

Every evaluation independently recomputes the candidate/reference solution's feasibility and value. A local route that stops before a reachable target is a counterexample, with a finite numerical difference sentinel of zero because a path-length gap is inapplicable. A genuinely unreachable target is reported explicitly as a verified single-instance result; it does not prove a strategy correct in general. Source equal to target is a valid zero-length complete route.

Scores use a bounded arithmetic parser, never eval or generated source execution. Decimal constants and division use normalized BigInt fractions. Primary direction is configurable; numerical `value` ties prefer larger value, other numerical ties prefer smaller value, then all ties use ascending code-unit ID order. Exact algorithms use their deterministic DP/Dijkstra tie behavior, rather than a score that is irrelevant to those algorithms.

## Search, reduction, and replay semantics

- Search uses uint32 Mulberry32 and generates actual inputs. It returns the first independently verified counterexample, an explicitly sampled `not_found`, or `incomplete` on cancellation/failed verification. No exhaustive-coverage result is manufactured. Invalid score evaluation is an error, not evidence of no counterexample.
- Generated intervals have starts in `[0,M-1]`, duration in `[1,M]`, and value in `[0,M]`; their end can reach `2M-1`. Knapsack weights/capacity are in `[1,M]`, values in `[0,M]`. Graph weights are in `[0,M]`, with directed and undirected cases; 75% of graph generation branches install a source-to-target backbone before adding random arcs. This is a finite generator distribution, not uniform coverage of all legal inputs.
- Shrinking re-evaluates the supplied input/strategy instead of trusting client-supplied values. Each accepted edit retains the original failure category: a suboptimal complete solution remains suboptimal; a graph dead-end with reachable target remains that same failure. Validity and independent reference checks run again on every accepted input.
- Reduction operations remove individual items/edges/nonterminal nodes, and lower nonnegative semantic numbers to the legal minimum, half, or one less. Each accepted change restarts the operation pass. Undefined score denominators are rejected candidates; unrelated internal errors propagate. Coordinates/labels are not optimized. A completed pass earns only `local`, meaning no offered operation preserves the failure; it does not claim a globally smallest counterexample. `reduced` means interrupted or budget-limited.
- `ShrinkStep` entries are accepted changes only. Their structural size is item count, or graph node count plus edge count; numerical changes can therefore have equal before/after sizes. `checks` also includes rejected attempts. Each step contains the actual freshly evaluated input and result.
- Regression evaluates the original input, up to 20 same-domain saved history inputs, then seeded holdout inputs. Original/history duplicates are eliminated by exact canonical object comparison (object key order ignored; array order retained). History does not consume the random generator. The holdout stream is salted independently from search and is reproducible. Lower optimality deficit means improved, larger means regressed; a local graph dead-end is internally worse than any complete route. Invalid verification is an error. Regression is evidence on these rows only.

## Explicit bounds

| Limit | Implemented value |
| --- | --- |
| Interval items | 1–16; time endpoints 0–10000, nonempty intervals |
| Knapsack items | 1–18; positive weight 1–10000; capacity 0–10000 |
| Item values | 0–100000 |
| Graph | 2–12 nodes; 0–80 edges; nonnegative weight 0–10000; no self-loops/parallel endpoint pairs |
| Search | 1–2000 samples; generated size 2–domain limit; M 2–100 |
| Seeds | Safe integers from -2147483648 to 4294967295, interpreted as uint32 generator state |
| Shrink | At most 4000 attempted candidates; cancellation between candidates |
| Regression | 0–100 generated holdouts, plus original and at most 20 supplied history inputs |
| Score | 160 characters; 80 AST nodes; depth 16; up to 6 decimal places; 9 integer digits per literal; bounded rational intermediate values |

The search and reduction loops check cancellation between bounded evaluations. They do not interrupt the middle of one synchronous evaluation; backend worker termination is responsible for that boundary if required. Searches return small scalar samples rather than retaining every evaluated trace. Regression deliberately keeps actual traces for its bounded rows.

## Executed verification

All commands started by dot-sourcing `scripts/env.ps1`, which directs runtime caches/temp files to D:.

1. `pnpm exec vitest run tests/engine.test.ts`: **47/47 passed** after the stored-history extension and boundary audit. These cover classic counterexamples and corrections, half-open intervals including endpoint10000, zero-capacity and one-use knapsack, maximum value sums and simple-path totals, zero-weight cycles, reverse undirected edges, unreachable/dead-end distinctions, source equals target, exact rational expressions, invalid syntax/score domains, deterministic ties under input permutation, input constraints, real intermediate trace states, 240 seeded independently verified cases, search replay/cancellation, shrink chains and false imported evidence, and regression including saved history.
2. `python -B tests/oracle.py`: **960/960 passed**, seed 20261115, 320 cases per domain. This separate Python program uses independently implemented reference and candidate checks, including exhaustive subsets/simple paths and Python rational arithmetic. The engine agent executed it once; the root agent also reported its own successful run. These are finite checks, not a mathematical proof of all possible inputs.
3. `pnpm check`: the engine and server had no TypeScript errors after integration at the time of this check; the whole-project command still reported the then-missing `src/app/App.tsx`. This is not recorded as a whole-project pass. Root owns subsequent complete-build verification.

An ad-hoc local benchmark ran actual maximal generated search settings with the exact strategy (so all 2000 samples were processed), seed 20261115 and M=100. Reported engine times on this host were interval size16 **84 ms**, knapsack size18 **125 ms**, graph size12 **448 ms**. Separate cancellation-at-20-samples runs returned after 20, taking approximately **1/1/4 ms** respectively. A legal knapsack with 18 items and capacity10000 evaluated 100 times averaged **1.62 ms**. These are observed local timings, not cross-machine performance promises or a comprehensive worst-case complexity measurement.

No Git commits or pushes were made by the engine sub-agent; the root agent owns integration history. No C: file was modified or deleted by these engine commands.
