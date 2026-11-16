# 第一轮实施结果：建议 1、2

状态：READY_FOR_COORDINATOR_REVIEW（仅指第一轮这两项可验收，不改变 Stage 3 的 NOT_READY 边界）。

基线 HEAD：76425c009d9d4d1a1b3e838158f2292c9e841b03。2026-11-17 上海时间完成。本轮唯一需求来源为同目录 review-top2.md，未自行增加第三条需求。未 commit/push，未改冻结 r4 ZIP / 安装目录，未请求用户 8787 的业务接口；等待协调方验收及第二轮正式建议。

## 建议 1 → 完整父状态绑定

**实际复现。** 修改前用独立 implementation-store、真实 SAC seed17 / hidden8,8 / warmup4 / batch4 / 一次真实更新复现：实验 0a83a05b318e45e4825c4441a2dd53c0，Trace 66c8c1266733486c87fb2ec332ab30ac。origin c03794e1560345b7bfdd24087beb9cd1 的 Actor biases.2[0]=0，output 61479d23565847829fcc9213710dc9f8 为 -0.00029999999527883354。切到 output 时图/预填仍为0，直接创建分支确实以 output 为父状态却把该偏置写回0。脚本 implementation-baseline.mjs 与 implementation-baseline-network.png 保留原始复现。

**实际改动。**

- `frontend/src/networkData.ts`：增加带实验、完整父检查点、路径/索引/父状态数值及历史 Trace/event/phase/origin/output/sample/历史值的参数交接对象；缺少真实有限父值时不交接。
- `frontend/src/NetworkExplorer.tsx`：历史事件仍用同事件 W/b/x/h 回放。快捷修改明确说明来源切换，读取所选完整检查点的真实参数，并将整张图切到检查点模式，清除历史激活/梯度；提供返回历史事件入口。SAC post-critic 单独说明中间阶段没有可直接分支的完整检查点，不合成/拼接状态。
- `frontend/src/App.tsx`：表单紧邻显示完整父检查点、父原值、拟写入绝对值和历史入口来源。重新从该检查点 API 读取父值核对。检查点/Trace/样本/事件/坐标变化后旧快捷交接失效，按钮及提交函数均阻止静默使用。手动更改路径/索引是显式转入手动坐标编辑，仍显示并要求真实父原值。
- `frontend/src/Scenes.tsx` 传递 Trace 元信息；必要样式与文档同步。

**真实验收。** `frontend/tests/provenance.spec.ts` 第一场景（最终15.3s）覆盖 origin/output：不编辑预填值后真的创建两个子分支，子参数映射与相应父检查点逐项相同；父检查点字段准确。普通 W 预填、切换来源失效并禁止提交、重新选取恢复均通过。真实 q1_actor_path/layer0 的 W[0,0]=-0.33518645850210754，而完整 origin 为 -0.33548645777942665；入口显示后者，清除历史激活，再真实创建子分支并确认全部参数等于完整 origin。Actor 前向记录入口使用其 output 完整检查点原值。原实验 origin/output 参数均保持逐项一致，updates 仍为1。

新增单元检查独立验证父值与历史值不同时仍绑定父值，以及缺失/越界参数不能交接。数值明细在 `verification/network-results.json`；测试源码包含 post-critic 子分支全映射断言。

**截图，已实际打开检查。**

- `verification/01-complete-parent-edit.png`：output 父偏置 -0.00029999999527883354、拟写入相同值、图中激活为未计算。
- `verification/02-post-critic-complete-state.png`：历史 post-critic 值与完整父原值分别标识，图/分支使用完整父状态。

**边界。** 中间阶段事件保持只读，快捷修改统一转到所选完整检查点；不提供从中间阶段直接分支。右侧深度 Inspector 仍是独立标识来源的历史事件检查器；检查点模式的图与下方受控分支明确标识各自来源，没有将 Inspector 的历史激活混到图中。

## 建议 2 → 不可变曲面请求身份

**实际复现。** 修改前同一隔离实验中，更改动作 x 轴为2后，网格中心仍为 -0.80363，未发新请求也无失效提示；截图 implementation-baseline-q.png。审查记录的 i4,j10 复现也在修复后用真实计算重新核对。

**实际改动。**

- `frontend/src/App.tsx`：请求身份包括实验、视图、检查点、Trace、样本、实际 observation、动作轴、固定动作、损失路径及索引、extent、resolution。每次计算保存 JSON 深拷贝快照；草稿与结果不一致时立即显示“设置已变更，待重算”，隐藏旧曲面、数值表和导出。恢复完全相同条件可以继续检查原结果。Q 显示字段仅为展示状态，不进入数值请求身份。
- 编辑会中止过期任务；任务创建响应回来后以及最终完成响应落地前均核对请求身份/取消状态，最终再核对控制器身份；旧任务 finally 不清理新任务ID。延迟的真实旧响应不能恢复成当前结果。
- 结果摘要使用已完成请求/服务器结果，显示实际轴、Nm或参数偏移方向、范围、网格大小、结果检查点、固定状态/动作、loss batch与SAC critic阶段。导出携带相同 request 快照；不把当前草稿覆盖到旧结果导出。
- `frontend/src/Scenes.tsx`：Canvas 轴名来自实际结果动作维或参数路径/索引。长路径与数值范围分别放在图和图上方摘要，避免第一次截图中长标签互相遮挡。补齐相关表单可访问名称。

**真实验收。** 新场景最终12.1s：

- 首次进入 SAC Q 自动计算一张15×15真实网格。i4,j10 在 axes[0,1] 为 -0.52465；改 axes[2,1] 后旧值立即消失并显示待重算，重算为 -1.116756754099756。导出 q1 全网格与同条件同步 API 逐项一致，页面显示精度也匹配。
- 固定未绘动作 a[0]=0.5 后同样失效，重算的冻结条件与图上摘要对应。
- 只切 Q 显示为 minimum 不增加 slice-jobs 请求。
- 使用 Playwright route.fetch 获取真实服务器 completed 响应后，仅延迟其交付；在该响应尚未交付时改轴，随后释放原响应。旧值没有重现；接着计算新条件，导出确为 axes[0,1] / resolution13。没有伪造请求结果/任务状态/数值。
- loss 的 x/y 路径、x/y 索引、extent、resolution 分别单独改动并恢复，逐项确认失效与恢复。最后真实计算 actor/weights.2[0,0] 与 actor/biases.1[2]，±0.06、7×7；导出 loss 全网格与同条件同步 API 逐项一致，并显示实际 post-critic 来源。
- 原有网络/曲面场景还复核 PPO 无双Q、缺批次真实更新入口、默认 SAC Q/loss 自动计算。

请求、结果、精确数值、延迟验收结果及所有数值数组在 `verification/surface-results.json`。

**截图，已实际打开检查。**

- `verification/03-q-draft-pending.png`：新轴草稿与可见待重算提示、旧值隐藏。
- `verification/04-q-computed-identity.png`：实际 a[2]/a[1] Nm、固定 a[0]=0.5 和同一网格。
- `verification/05-loss-computed-identity.png`：完整参数方向、±0.06、7×7、Trace 与真实 critic 更新后阶段；Canvas 轴名清晰。

**边界。** 保留手动重算以免每次输入都启动计算；只在首次进入/来源就绪时沿用原有自动计算。切片仍是固定条件二维真实网格，不增加训练预算、不拟合或装饰科学结果。延迟场景覆盖“计算中编辑→迟到旧响应→新请求”；UI 原有计算期间按钮禁用机制保留。

## 最终验证和文件

- `python -m pytest -q`：112 passed，22.13s；1条现有 Starlette/httpx 弃用提醒，原始输出 `python-tests.log`。
- D盘Node运行 `tsc -b` / `vite build`：通过，Vite5.51s；`vitest run`：2文件、8项通过，231ms。类型/构建/单元检查后产品源码没有继续变更。
- 全部真实浏览器回归：15/15通过，201.600s，0失败/0跳过/0 flaky。包括旧13场景及本轮2场景；原始列表+JSON为 `browser-final.log`，提取后的JSON为 `verification/browser-results.json`。生产页检查走8793新源码构建，不走用户8787。
- 现有renderer/performance场景也通过，报告副本 `verification/performance-browser-runtime.json`；它是本机短窗口记录，不升级长期稳定性/硬件承诺。
- `git diff --check` 通过。8个本轮输入文件与最终截图/报告SHA256见 `verification/manifest.json`。
- 首次针对性浏览器2/2也通过，日志 `provenance-test-first.log`。运行中补齐可访问名称后长等待动作得以完成，最终套件从头重跑。文档第一次补丁因“填到/填入”上下文不匹配而未应用，已读取精确原文后修正；无数据或测试失败被隐瞒。

8个产品/测试/文档文件：frontend/src/App.tsx、NetworkExplorer.tsx、Scenes.tsx、networkData.ts、style.css；frontend/tests/networkData.test.ts、provenance.spec.ts（新增未跟踪，需协调方按范围纳入）；docs/NETWORK_EXPLORER.md。无后端算法/物理/格式修改。两个 LightForge 原有未跟踪文件保持原样，未暂存。

## 运行环境与后续交接

所有Python/Node/浏览器启动前均在实际项目目录读取 scripts/Environment.ps1；使用项目D盘.venv与r4包D盘Node，临时目录/profile/cache/截图/输出均按D盘环境设置。没有执行针对C盘文件的修改/删除命令。隔离数据在 `.runtime/two-chat-76425c0/implementation-store`，不使用用户store，不重写20份预登记学习产物。

第一轮隔离预览暂留供协调方验收及第二轮复审：5173 Vite PID11352，8793 API PID1936（操作前重新核实）；对应本聊天exec会话74730、18439。浏览器/pytest验证进程已完成。API输出在受控exec会话，不代表已重启用户安装。

当前启动方式（两个独立受控exec会话，cwd均先设为 `D:\传智杯1\counterlab\policyglass`；已经在运行，复审直接访问，不要重复启动）：

```powershell
# API，PID1936；只读观察用 http://127.0.0.1:8793/api/health
. .\scripts\Environment.ps1
& .\.venv\Scripts\python.exe -m policyglass.cli serve --port 8793 --data .runtime/two-chat-76425c0/implementation-store

# 另一个会话，Vite PID11352；观察页面 http://127.0.0.1:5173/
. .\scripts\Environment.ps1
$env:POLICYGLASS_API_URL='http://127.0.0.1:8793'
Set-Location frontend
& 'D:\传智杯1\PolicyGlass-final-offline-20261117-r4-01\PolicyGlass-stage3-review-20261117-r4\runtime\node\node.exe' node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort
```

可直接观察最终第一轮独立测试实验：`http://127.0.0.1:5173/?experiment=ad4ec466c28d42c39e9e3a984c393656`（参数场景）和 `http://127.0.0.1:5173/?experiment=3a89d12ee0654b04afef062ad328bdc7`（曲面场景，ID取自verification/surface-results.json）。所有数据均属于可供复审的implementation-store，未与用户store混用。

实际环境变化：开始只读核实8787由PID5000监听；第一轮结束前03:43左右的只读复核发现8787未监听且PID5000不存在。本聊天未停止/重启它，也未修改其安装或业务数据；原因未确认，应由协调方在发布/恢复前重新核实，不能按旧PID操作。本轮不擅自重启。

不制作离线包、不改冻结r4 ZIP、不迁移安装；本报告之外的发布/用户实例操作交协调方。已停止扩展第一轮需求，等待编号3、4正式交接，不自行开第三轮。全计划外部反馈、真实DeepSeek账户、跨机与长期内存边界仍保持原有未验证状态。
