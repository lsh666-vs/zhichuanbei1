# Stage 3 — evaluation, explanation and release

Status: NOT_READY

Stage2 READY and explicit completion delivery were received before any Stage3 writes. Predecessor47 hashes,55 Python tests and6 actual browser scenarios were independently verified (019/020).

The Stage3 technical review candidate implements optional official DeepSeek explanations, all-seed research/import, security/keyboard fixes, immutable Trace projections and measured rendering/interaction performance. All20 preregistered learning runs completed; every learned state hash/reload/actual update checked042. Full training seed11 PPO/SAC checkpoint bytes reproduced exactly028. The final lifetime correction passes110 Python tests,4 frontend checks and11 genuine browser scenarios (055); post-build package receipts follow actual execution.

## Final r3 target and source lifetime correction (2026-11-17)

After the r2 build, the ten-minute observation052 showed remaining memory growth. Probe053 confirmed recursive checkpoint helpers retained temporary tensor tables until cyclic GC. A small finally cleanup now breaks the helper cells and clears temporary tensors on success and error; no forced GC, optimizer, validation or serialization changes. Six real-serializer weakref tests pass with cyclic GC disabled, including held error tracebacks. All20 real learned bundles decode/re-encode byte-identically (054), retaining their original hashes. Independent science checks still give resume parameter difference0, gradient aggregation error at most1.78e-15 and Adam error1.08e-19 (055).

The corrected delivery target is `PolicyGlass-stage3-review-20261117-r3.zip`. Its exact clean source revision, ZIP SHA256 and new-D-path verification belong to the post-build056/057 receipts. They cannot be embedded in their own already frozen ZIP. The following r2 section is preserved history, not the current delivery selection.

The same bounded diagnostic after correction shows zero live temporary Tensor objects at every sampled point, including before manual collection (054). Native process private memory still varied; this does not prove permanent memory stability. A final600-second observation without the profiler is recorded separately as058 after the source seal. All functional browser cases pass, but event selection under overlapping pytest/tracemalloc load has cold/warm p95 of159.14/137.76ms, above the100ms target; earlier047 reference62.89/65.20ms remains separately preserved. Four actual1080p canvases have short-window frame interval p95 of8.5–9.09ms in055; these are callbacks, not GPU completion timing or a universal hardware promise.

## Previously verified r2 artifact

Frozen packaged source: **5ae43c5cea44450d8aa493a59aec8765cbb8c6a7**. Core implementation93c53bf, scientific integrity61bbf00, preregistrationd4e164d. Later commits append documentation/real evidence only unless explicitly stated. No history is rewritten.

Previous ZIP: `D:/传智杯1/counterlab/policyglass/.runtime/release/PolicyGlass-stage3-review-20261117-r2.zip` (**973345179 bytes**). SHA256: **b14dac3cecd51996a5a1e21c1e2c725324ec46dd795b8eef932cef272b969ce6**. Unpacked manifest16929 files/3864803018 bytes;20 registered learned states. Exact89/89 tested inputs and174/174 sealed Git files match. Complete third-party archive includes actual15 distributed npm packages,20 font families/filesets and Python/runtime notices; no notice gap is asserted by the archive check. Source license remains author-owned, no new open-source grant.

050 is the complete receipt;051 is the raw relocation verification. ZIP SHA check, extraction to a new D: path and actual learned PPO/SAC updates took **63.19s** on this same Windows host. Build89.40s, extraction10.94s, base validation33.43s and additional study checks16.09s are separately recorded; warm filesystem caches and concurrent8792 pressure are disclosed. No different-machine or cold-download timing is claimed. Both seed11 learned states were imported into new experiments and really updated; all20 source hashes stayed unchanged, optional AI was unconfigured. All owned migration services stopped.

To run: extract the entire directory on **D:**, run `Start-PolicyGlass-Offline.ps1`, open `http://127.0.0.1:8787/`. No external Python/Node/pnpm/key/network is needed for the bundled core. `scripts/Verify-Offline.ps1 -Bundle <D:path>` rechecks manifest and actual updates. Core Python network access is limited to loopback; optional live DeepSeek belongs to the source edition. Do not load untrusted Torch checkpoint/code formats outside the bounded application.

Earlier packages are preserved as evidence. The first package's two missing workspace metadata files and one CRLF helper mismatch were corrected in r2, preserving isolation from the old parent workspace. These packaging fixes were not training failures. Receipts generated after each ZIP are outside it intentionally; use its immutable manifest and source commit for exact contents.

NOT_READY is the complete-plan acceptance state, not a claim that implementation is absent: real learners/content reviewer are explicitly deferred by the user, another physical machine has not been tested, no actual DeepSeek account/quality run is claimed, and newer native Torch candidates failed DLL initialization. The working Torch2.8 safety format and bounded API remain tested; known package advisories are retained, not described as zero vulnerabilities. PurePython setuptools84.1 update independently passed104 tests and fourteen bit-equal full-state comparisons.

Read docs/STAGE3_VALIDATION.md, SECURITY.md, PERFORMANCE.md, REFERENCE_STUDY.md, EXPLANATION.md, LEARNER_PROTOCOL.md, OFFLINE_RELEASE.md and SUBMISSION_MATERIALS.md. Genuine raw dialogues remain under ignored evidence/private, with public excerpts and omissions. Do not invent participant feedback, three human Prompt chains or human independent review. Video/PDF production remains postponed. All project writes, new installations, caches and artifacts stay on D:; existing system executables may be read without changing their files. Neither old LightForge untracked file is staged.

