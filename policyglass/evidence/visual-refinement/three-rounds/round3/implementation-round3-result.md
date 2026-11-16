# 第三轮（最终轮）实施：建议 5、6

状态：READY_FOR_COORDINATOR_REVIEW；最终源码已冻结。范围仅为 review-round3.md 的编号5、6；三轮共六条已经落实，不新增第四轮。本状态不等于完整Stage 3计划READY。

基线HEAD：9015bba01f0101272f2e9b650635872190ca5a6e。普通速度，gpt-6.1-sol/xhigh，未启用1.5×/Fast。未commit/push、打包、迁移、修改用户安装或启动8787。完整计划的外部反馈、真实DeepSeek账户、跨机器及长期原生内存验证仍保持原有边界。

## 建议 5 → 原事件内的优化器坐标与更新摘要

**确认。** 审查的PPO optimizer已有真实before/梯度/Adam矩/delta/after；缺失的是面板内坐标入口，原提示让人绕到网络而离开当前事件。实施前完整读取报告、对应Inspector代码，并从隔离SAC事件API核实alpha的log_alpha是无索引float64标量，具有同一套保存字段；不把已有真实值误报为没有实现。

**实际修改。**

- `frontend/src/Inspector.tsx` 增加OptimizerDetails，但没有另一套参数/梯度状态：所选参数来自当前event.parameters，坐标复用useLab.selection。矩阵显示行/列、向量显示单索引、标量明确“无索引”。真实before.shape决定边界；切参数/事件或输入越界时规范共享坐标并提示。
- 在原optimizer内浏览不会调用chooseEvent，不切回layer。实际网络模型的参数后缀同时维持共享model/layer语义；矩阵列在转为向量/标量时规范为0。样本、事件与Trace保持原选择。
- 核心摘要突出同一保存事件的before → 记录delta → after，并区分raw_gradient（裁剪前批梯度）与gradient（裁剪后送入Adam）。标题保留原参数值用于精确核对；完整路径、坐标、事件、Trace、origin检查点、样本行可读。
- Adam矩、修正矩及相关公式渐进展开；原始完整张量与复制入口保留。没有重新计算Adam，没有把样本更新相加，没有执行参数写入。
- `frontend/src/core.ts` 只增加合法索引规范助手；`style.css` 提供紧凑布局。首轮分支交接仍依赖全局选择来源，浏览坐标使旧交接失效的保护保持。
- 实际测试另复现一次阶段键盘进入超时：来源Trace仍在异步读取时阶段能先被选择，随后加载完成重置选择。现在忙碌期间阶段入口等待，测试也等待来源可检查后再用键盘进入；不把所有键盘行为都宣称修复或把审查未定位问题倒推为既定结论。
- 维持旧回归时捕获后台事件读取清掉损坏导入错误的真实并发问题。自动读取不再清除已显示的操作错误；明确的新run操作或关闭错误仍可清除。保留原导入校验/旧断言，不修改数值或API。

**真实验证。** `frontend/tests/inspection.spec.ts` 每文件beforeAll自建PPO/SAC隐藏8×8、seed17、各一次有界真实更新（PPO rollout/minibatch4、epochs1；SAC warmup/batch4），再从API取得真正Trace/事件。没有硬编码实验/Trace/checkpoint业务ID，也不读.runtime数据库作为fixture。

在1440×900、1280×720分别完成：

- 键盘进入参数更新，原位选择weights.1[7,7]，以及biases.1[7]；before/raw_gradient/gradient/delta/after五项完整原值与该事件API逐项相同。
- 行列Tab顺序、ArrowUp和上下边界；输入999、负数；矩阵切向量时清除无效列；未出现NaN或失效坐标。
- SAC alpha/log_alpha标量无数值索引控件，五项完整原值与真实alpha optimizer事件相符。
- 坐标浏览保持当前optimizer事件、Trace、样本；回网络仍是共享第2层、单元7/输入0语义。PPO参数全映射及两算法checkpoint/updates/env_steps保持一致；浏览数值POST=0。

截图 `round3-verification/01-optimizer-matrix-{1440x900,1280x720}.png`、`02-optimizer-alpha-*.png`，精确数值 `optimizer-*.json`。已实际打开检查核心摘要/来源与可达坐标入口。

## 建议 6 → 固定身份、邻接探针与真实最近顶点

**确认。** 当前曲面及二维表的值是真实值，已有点选；原实现按fields的序号分配颜色，点击只取命中face的首顶点。审查给出的face20第三顶点与现有实现一致，问题是吸附和辨认方式。实施对照真实网格重建独立raycast，不制作或替换任何曲面数值。

**实际修改。**

- `frontend/src/surfaceData.ts` 固定Q1青绿、Q2蓝紫、min琥珀、loss紫红身份；曲面、文字图例和标记共用身份，不随单显/同显排序换色。
- `frontend/src/Scenes.tsx` 在画布旁放紧凑探针，显示共享pick的i/j、真实x/y与动作Nm或参数偏移方向，以及原数组Q1/Q2/min/loss值。没有复制独立数值状态。i/j命名与范围明确，聚焦卡片后←→调i、↑↓调j；原二维表继续保留。
- Canvas以实际命中点转换到当前网格坐标，在命中三角形的三个真实顶点中选择距离最近者。明确显示“吸附到实际网格点”；数值仍取服务器原数组，未把三角面插值高度当重算。标记增加白色外圈提升可辨性，身份色稳定。
- App把同一完成请求、fields和pick接线给探针；表格与邻接索引使用同一边界规范。导出继续保留immutable request，并增加当前实际selected_point（索引、x/y和原数组值）。草稿/来源失效或取消时与旧曲面同步隐藏探针/导出。
- 相机/标记的只读诊断仅在diagnostics=1启用，用于核对实际camera矩阵、命中face/vertex和实际marker Mesh位置/颜色；临时排错用额外raycast已移除，不给普通模式增加科学计算或日志。

**真实验证。** 在两种桌面尺寸、Q与真实loss共四场景中：

- 画布与探针同时位于视口；Q2独显和同显的实际标记颜色都为#687dcb，图例与显示状态同步，未发新数值请求。
- 用服务器数组独立重建Float32网格，读取实际OrbitControls camera矩阵，通过独立Three raycast选择可见三角形，分别点击其三个角；命中face、最近顶点、探针、二维表和实际marker位置逐项相符。
- Q覆盖审查face20的第三顶点[0,11]，并检查边界网格。旋转实际相机、等待镜头稳定后重新独立投影/命中，再实际Canvas点选，不用固定屏幕热区。loss同样覆盖三角形三个角、边界与旋转后点击。
- 浏览器会量化鼠标像素坐标，因此独立raycast按实际整数点击像素校验；没有放宽最近顶点/事件/原值断言。非常平坦的小三角形仍可用i/j和方向键逐点检查。
- 方向键与边界输入、标记/探针/二维值、导出selected_point与完成request一致。浏览和显示切换数值POST=0；网格计算仍只有明确进入/重算请求。
- 改动作轴或loss范围后探针立即隐藏；恢复完全相同请求可继续查看该有效结果。另延迟真实completed响应，计算中点击取消再释放响应，探针和导出保持隐藏，未复活旧值。参数映射/检查点/updates/env_steps保持原样。

截图 `03-q2-stable-*.png`、`04-q-probe-rotated-*.png`、`04-loss-probe-rotated-*.png`；精确命中/顶点/marker/导出记录 `q-*.json`、`loss-*.json`。均在round3-verification中，最终截图已实际打开查看。

## 独立空store验证

为验证测试确实不依赖以前的.runtime数据，启动了新的D盘round3-fresh-store，先核实实验数0。使用现有安全白名单内的真实Origin http://localhost:5173，通过临时IPv6 loopback Vite（[::1]:5173/PID6796）代理独立8794 API/PID20124；原127.0.0.1:5173/PID11352与8793/PID1936一直保留，不重启。未放宽Origin/Host策略，未改DNS/hosts或任何C盘配置。

本轮6个新增浏览器场景在空store 6/6通过，74.592s，0失败/跳过/flaky。beforeAll只产生自有PPO/SAC两个实验及各一次真实更新，结束实验数2。日志 `round3-fresh-browser.log`，配置 `round3-fresh.config.ts`，完整截图/数值/fixture/浏览器JSON/receipt副本在 `round3-verification/fresh-store/`。

完成后核对命令行身份，仅停止临时PID20124/6796；8794与::1:5173已无监听。数据与日志保留。普通预览继续使用原IPv4服务，最终复审链接以最终主回归fixture为准，不指向已经关闭的fresh服务。

## 验证及所有失败

- TypeScript通过，错误提示并发修正后的最终生产构建6.53s：`round3-build-final.log`（前一次构建7.01s另保留round3-build.log）。
- Vitest两文件11项通过，345ms：`round3-vitest-final.log`（前一次307ms另保留round3-vitest.log）。新增矩阵/向量/标量坐标边界及命中三角形三个顶点测试。
- Python 112通过，32.71s，1条已有Starlette/httpx弃用提醒：`round3-python.log`。后端算法/物理/分支代码未改。
- 首次全27浏览器回归26/27通过、411.706s：`round3-browser-final.log`。本轮6项及原有其他20项通过，唯一失败是旧损坏导入错误提示；已针对修正并原断言1/1复验，10.627s，`round3-import-regression.log`。
- 最终全27/27通过，393.879s，0失败/0跳过/0 flaky：`round3-browser-final-rerun.log`。原有21项断言没有放宽。提取的完整JSON为 `round3-verification/browser-results.json`；本机renderer短窗口报告副本为 `round3-verification/performance-browser-runtime.json`，不升级为长期稳定性或通用硬件帧率承诺。
- 首次 `round3-inspection-first.log`：0/6。两个参数选择定位因部分可访问名同时匹配section/select而失败；两个Q旋转检查未等待OrbitControls惯性稳定；两个loss检查使用浮点投影而实际点击量化像素，导致独立预期与真实射线不一致。改精确控件名、等待相机稳定，并核对实际顶点/浏览器射线。
- 第二次 `round3-inspection-second.log`：4/6，Q与optimizer已通过，loss仍失败。`round3-loss-diagnostic.log`、`round3-loss-diagnostic2.log`各一次失败；临时只读几何/指针诊断确认服务器与实际Mesh顶点一致，浮点点击量化后未命中预期face。
- `round3-loss-pixel-check.log`：独立校验实际整数像素后1/1通过，19.696s，包含真实loss三个角/边界/旋转。没有修改loss值或退回首顶点规则。
- `round3-inspection-final.log`是全量前的一次试验名，实际5/6；复现上文来源加载期间阶段选择被重置，已等待真实忙碌状态并重验，不能当作最终通过记录。
- 旧损坏导入失败的截图、网络trace及error-context已保存在 `round3-verification/regression-import-failure/`。trace中真实import400发生于21:32:26.561Z，随后index/frames于26.592Z、event0于26.795Z读取；自动读取的run清空了错误。源错误与后台读取并发管理已最小修正，未伪造400或延长旧断言超时来掩盖问题。
- 首次测试曾硬编码既有隔离实验ID，已按协调方要求改为文件自建fixture；空store6/6是真正独立重跑。一次补丁因formatter后的空格上下文不匹配而未应用，按实际文件重试；未隐瞒测试失败。初期失败截图/trace位于Playwright易覆盖输出目录，不作为最终交付截图，原始失败日志完整保留。
- 现有完整E2E包含原有短预算五种子课程回归；未新增研究方案或重训20份预登记产物，不把这些回归当真实学习者/专家反馈或教学有效性证据。

## 最终输入与边界

本轮9项sourceInputs：

1. docs/NETWORK_EXPLORER.md
2. frontend/src/App.tsx
3. frontend/src/Inspector.tsx
4. frontend/src/Scenes.tsx
5. frontend/src/core.ts
6. frontend/src/surfaceData.ts（新增）
7. frontend/src/style.css
8. frontend/tests/core.test.ts
9. frontend/tests/inspection.spec.ts（新增）

README.md、handoffs/STAGE_3.md、docs/THREE_ROUND_REFINEMENT.md及evidence/visual-refinement/three-rounds由协调方维护，本聊天未修改这些文件；也不修改/删除/暂存两个LightForge文件。最终9项sourceInputs、截图/JSON/失败现场及全部round3日志的SHA256在 `round3-verification/manifest.json`；9/9输入与最终复跑前封存值一致，`git diff --check`通过。最终复跑后没有再修改产品源码。

本轮针对1440×900与1280×720验收；窄移动屏使用上下布局，没有承诺同等移动体验。GPU几何用于可视显示，科学读数仍为服务器原数组；相机稳定/实际像素的命中校验不等于每个被遮挡顶点都能直接点击，二维与键盘入口完整保留。没有声称长期内存稳定、普遍帧率或全计划READY。

所有Python/Node/浏览器前先在实际项目cwd执行Environment.ps1，使用D盘.venv及r4包D盘Node、D盘浏览器/cache/tmp/profile/log/截图。没有C盘修改/删除、全局包或设置操作。普通隔离预览仍为5173/PID11352、8793/PID1936，implementation-store；操作前须重新核实。8787继续无监听，未触碰用户原store或冻结r4包。

## 当前可复审预览

现有IPv4预览继续保留，操作前重新核实PID与路径：

- PPO本轮fixture：`http://127.0.0.1:5173/?diagnostics=1&experiment=412d36a97e4946bd95d5ad1ed89aaea7`。点击“参数更新”，选weights.1，再输入7/7，可检查矩阵；切biases.1可检查向量。该fixture真实updates1/env4。
- SAC本轮fixture：`http://127.0.0.1:5173/?diagnostics=1&experiment=1a9554d33d1c44c2b6d08dc83a570aff`。事件时间线alpha optimizer可查log_alpha标量；双Q和局部损失使用真实批次自动生成曲面。该fixture真实updates1/env4。曲面和坐标浏览不增加这些计数。

最终fixture标识、所选事件/参数和真实原值均在round3-verification JSON中。当前两个服务的已有启动方式如下（仍在运行，不应重复启动）：

```powershell
Set-Location 'D:\传智杯1\counterlab\policyglass'
. .\scripts\Environment.ps1
& .\.venv\Scripts\python.exe -m policyglass.cli serve --port 8793 --data .runtime/two-chat-76425c0/implementation-store

# 另一个会话，原Vite PID11352
. .\scripts\Environment.ps1
$env:POLICYGLASS_API_URL='http://127.0.0.1:8793'
Set-Location frontend
& 'D:\传智杯1\PolicyGlass-final-offline-20261117-r4-01\PolicyGlass-stage3-review-20261117-r4\runtime\node\node.exe' node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort
```

API PID1936/exec会话18439；Vite PID11352/会话74730。浏览器、pytest及临时fresh验证均已结束，临时8794/IPv6服务已停止。原8787仍无监听，没有启动或恢复用户store。

最终全检查已通过、源码冻结，交协调方验收；未commit/push或制作离线包。第三轮是最后实施轮，停止扩展，不提第四轮。
