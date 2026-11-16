# 第二轮实施结果：建议 3、4

状态：READY_FOR_COORDINATOR_REVIEW；第二轮产品源码已冻结。此报告仅覆盖建议3、4，不把 Stage 3 的 NOT_READY 改成完成。

基线 HEAD：c17444fb18faae64422c3d0f5284b61b0b4e3ed5。本轮需求以 review-round2.md 的编号3、4为准；该审查报告沿用了“两轮后停止”的旧描述，已按协调方最新用户指示改为共三轮。本轮不自行增加第5、6条，完成后等待第三轮正式交接。未 commit/push、打包、迁移、改冻结r4包或启动用户8787。

## 建议 3：首屏真实计算控制条

**确认的问题。** 审查在1440×900记录原启动按钮y=1432.03、runbar y=1419.03，创建模型后要下滚才找到计算入口；缺前提阶段以成功勾横幅提示。已完整读取原始坐标记录 round2-settled-observation.json，并对照当前App.tsx的footer位置及阶段处理确认。本轮不把有效的真实计算能力误报为没有实现。

**实际改动。**

- `frontend/src/App.tsx` 将唯一runbar移到实验概况之后、工作台之前，滚动时常驻。两种入口明确区分“看一次Actor前向：参数不更新/不推进物理”和“启动/继续计算：记录真实更新/会更新当前实验”。复用原predict/start/job/control函数；预算与train/fixed_batch在同一控制条渐进展开，不另建一套数值状态、不自动训练。
- 来源、连接、运行状态、真实任务进度、暂停/恢复/取消、失败及刷新均在控制条可到达。完成后，前向下一步定位已生成Actor层，更新下一步定位真实optimizer事件。没有反向的前向记录不会宣称梯度可检查。
- 缺前提阶段在原位说明，并提供相应真实前向或更新入口；不再为这一空状态追加成功横幅。新计算清除上一次成功提示，真实错误仍在控制条可见并允许重试。
- 全量回归暴露并修复了并发忙碌状态：旧run在任意一个并发请求结束时直接清空busy，会在另一来源读取尚未完成时启动过渡检查点的Q请求。现在按实际未完成操作管理忙碌状态，最后一个操作结束才清空；保留原曲面的请求身份/过期响应保护。
- `frontend/src/style.css` 处理紧凑、sticky、预算弹层、焦点滚动留白和两种桌面尺寸；阶段按钮补可访问名称。原有测试的高级模式/预算操作显式打开该面板（workbench.spec.ts），没有削弱断言。

**针对性真实验证。** 新增 `frontend/tests/usability.spec.ts`：在1440×900与1280×720分别用鼠标/键盘交叉走完前向→检查与更新→检查。UI建模使用8×8、rollout/minibatch4、PPO epochs1，只为有界闭环计数验证；另有默认64×64完整网络场景，见建议4。

- 两种入口均在scrollY=0首屏；按钮顶部实测y=310.34，均可直接触发，不需要下滚查找。
- 使用真实predict响应，仅延迟其交付来观察“前向计算中”；运行时真实更新按钮禁用，未伪造数值或完成状态。前向后updates/env_steps均保持0。
- 一次明确更新后，真实任务completed且API计数为updates=1、env_steps=4；一次点击定位实际optimizer事件。首轮已有历史Trace仍可选取。
- 真正向无批次新实验提交fixed_batch任务，收到真实失败与后端错误“Fixed-batch mode needs an existing real rollout/replay batch”；切回train后实际重试完成，updates=1。
- 已有任务生命周期回归覆盖暂停、重载、恢复与取消；八课/高级模式/安全导入等仍在全量回归。

截图/数值：`round2-verification/01-entry-{1440x900,1280x720}.png`、`02-running-*.png`、`03-ready-*.png`、`07-real-failure-retry.png`、`control-*.json`。均为本机实际浏览器截图与API计数，不是学习者反馈。

## 建议 4：可进退的专注网络检查

**确认的问题。** 原默认64×64网络实际可点选、参数有效；审查中的画布y=541.34至1001.34，与参数读数不能同屏，所有SAC网络标签重叠。已读真实坐标记录及对应代码。保留完整网络和首轮来源契约。

**实际改动。**

- `frontend/src/NetworkExplorer.tsx` 与App/Scenes布局接线增加专注模式：收起次要导航/页头/外侧Inspector，把原画布与同一份W/b/x/h/z/梯度/来源和修改入口并排放入桌面视口，不复制参数或选择状态。
- “聚焦所选路径”按当前模型上一层全部来源节点、所选目标单元与偏置路径的真实概念坐标求范围，再同步相机/OrbitControls目标；即时定位，无补间。其他边/非相关层淡化但真实节点和连接保留。“返回总览”保留选择，恢复合理全景。
- 所有网络总览以两列平铺完整模型，模型身份为主；所选模型/路径才展开相关层及W/b、输出标签。另有可键盘操作的模型入口。默认Actor仍149节点/5,440连接，SAC全部五模型仍737节点/26,688连接。未用少数装饰球代替真实单元。
- 来源层输入节点高亮扩展到隐藏层，不再只高亮第0层输入。二维坐标与实际Canvas仍共用useLab.selection。拓扑位置/完整连线几何继续memoize；视角、标签和高亮不要求重建全部连线，也不发数值计算请求。
- Esc退出并将焦点返回专注入口；深层张量入口退出到现有Inspector并聚焦它（Inspector.tsx仅增加可聚焦区域语义）。修改参数入口退出到首轮已有完整父状态表单，首轮provenance/失效保护不变。
- `networkData.ts` 增加概念坐标包围范围和多模型布局助手；`SceneLabel.tsx` 允许总览模型标签密度调整，其他图/物理标签默认保持原有尺寸。

**针对性真实验证。**

- 默认64×64Actor，分别1440×900和1280×720：专注后画布、参数读数、来源和修改按钮均在视口内；实际Canvas点击第7单元成功。输入隐藏层单元63/输入63，页面W/h与真实前向Trace一致。
- 聚焦后用同一实际绘制坐标的诊断投影，核对上一层全部64个来源节点及目标在画布内；返回总览保留63/63。修改入口正确填actor/weights.1及63,63。
- 两种尺寸均验证键盘进入、聚焦、Esc退出及入口焦点返回；使用prefers-reduced-motion: reduce，相机没有动画过渡。深层Inspector路径和参数入口均能继续。
- 已有真实PPO更新产物下，专注视图同时显示实际dL/dz及修改入口；截图 `08-focused-gradient-*.png`。未有Trace的SAC仍显示真实检查点W/b及“未计算”激活。
- SAC全部五模型总览数量737/26,688，模型身份不互相覆盖；可进所选Q₂路径再回总览。试验updates/env_steps都为0且没有Trace。
- 在默认Actor前向完成后开始监测数值POST；所有相机、标签、选择、专注进退及打开参数表单期间，predict/jobs/branches/slice-jobs POST数为0，API计数仍0/0。
- 截图前等待R3F尺寸与实际Canvas一致并完成两帧，避免把布局resize尚未完成的帧当最终效果；实际浏览器图已逐张打开检查。

截图/投影：`round2-verification/04-focused-path-{1440x900,1280x720}.png`、`05-sac-complete-overview.png`、`06-sac-selected-path.png`、`08-focused-gradient-*.png`、`focus-*.json`。

## 验证与失败记录

- TypeScript `tsc -b`通过；最终Vite构建5.10s，`round2-build-final.log`。
- Vitest两文件9项通过，240ms，`round2-vitest-final.log`；新增数值包围范围测试检查全部64来源节点和目标确在范围内。
- Python 112通过，23.28s，1条现有Starlette/httpx弃用提示，`round2-python.log`。后端科学代码未修改。
- 首次新增浏览器6项中4通过/2失败（`round2-usability-first.log`）：两处均为阶段按钮带序号导致精确可访问名称定位失败；补齐按钮aria-label后第二次6/6通过，`round2-usability-second.log`。
- 第一次全量21项中20通过/1失败（`round2-browser-final.log`）：曲面场景实际捕获两个初始Q请求，暴露来源加载与事件读取并发清空busy，未将它掩盖成“只是测试脆弱”。已按建议3真实状态管理修复；最终全量复跑21/21通过，243.877s，0失败/0跳过/0 flaky，原始列表及JSON在 `round2-browser-final-rerun.log`，提取JSON在 `round2-verification/browser-results.json`。没有放宽首轮断言。
- 默认网络/曲面、首轮来源/延迟响应、键盘/离线讲解/安全、任务生命周期、八课与原有有界课程流程均通过。renderer场景的本机真实短窗口报告副本在 `round2-verification/performance-browser-runtime.json`；不把它扩展成专注模式的普遍60fps或长期稳定性结论。
- 最终11个输入及截图、JSON等产物的SHA256在 `round2-verification/manifest.json`；`git diff --check`通过。类型/构建/单元检查与最终全量浏览器复跑后，产品源码没有再修改。
- 本地编辑脚本曾将App.tsx写为CRLF，diff检查发现后已用项目formatter恢复；最终差异检查无此问题。没有删除或掩盖上述失败日志。
- 现有E2E包含原有短预算五种子课程流程；未新增研究预算、未重跑20份预登记训练、未写入它们的保存产物，不把这些回归当成教学效果证明。

## 文件与边界

本轮产品/测试/文档共11个输入：

1. frontend/src/App.tsx
2. frontend/src/Inspector.tsx
3. frontend/src/NetworkExplorer.tsx
4. frontend/src/SceneLabel.tsx
5. frontend/src/Scenes.tsx
6. frontend/src/networkData.ts
7. frontend/src/style.css
8. frontend/tests/networkData.test.ts
9. frontend/tests/workbench.spec.ts
10. frontend/tests/usability.spec.ts（新增）
11. docs/NETWORK_EXPLORER.md

不修改算法、MuJoCo、序列化/分支API、默认研究预算或预登记学习产物。首轮参数来源和曲面请求身份均已通过最终回归。专注模式目前针对这两种桌面尺寸验收；手机退为上下排列，不宣称移动端同等体验。总览显示完整结构，聚焦用范围和视觉层级辅助检查，不代表神经元的物理坐标。没有声称60fps、长期原生内存稳定、教学效果或全计划READY。

## 隔离预览与后续

继续复用D盘 `.runtime/two-chat-76425c0/implementation-store`。5173 Vite PID11352、8793 API PID1936；操作前应重新核实。受控exec会话74730/18439，启动方式与首轮交接相同：

最终独立测试实验可直接复审：

- `http://127.0.0.1:5173/?experiment=e3fc5bcb08554f17b6026e52fed8d3db`：1440×900控制条真实前向/更新闭环，最终updates1/env4。
- `http://127.0.0.1:5173/?diagnostics=1&experiment=dcfb7930c1c746ee8adc4a1c8c06b54e`：默认64×64Actor及真实前向记录，最终updates0/env0。
- `http://127.0.0.1:5173/?diagnostics=1&experiment=860cfb36facc4e1eb40ee9aa6e03518e`：1280×720默认64×64专注验证，最终updates0/env0。

两个默认Actor的W[63,63]真实值均为 -0.03773431878228535，页面按现有格式显示 -0.03773；相机/选择/入口操作期间数值POST=0。SAC完整模型截图及无Trace边界由新测试的第五场景独立覆盖。浏览器与pytest验证进程已完成；两个隔离服务留给协调方复审，不要重复启动。

```powershell
Set-Location 'D:\传智杯1\counterlab\policyglass'
. .\scripts\Environment.ps1
& .\.venv\Scripts\python.exe -m policyglass.cli serve --port 8793 --data .runtime/two-chat-76425c0/implementation-store

# 另一会话；现有服务仍在运行时不要重复启动
. .\scripts\Environment.ps1
$env:POLICYGLASS_API_URL='http://127.0.0.1:8793'
Set-Location frontend
& 'D:\传智杯1\PolicyGlass-final-offline-20261117-r4-01\PolicyGlass-stage3-review-20261117-r4\runtime\node\node.exe' node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort
```

所有Python/Node/浏览器运行前先读取Environment.ps1，继续使用D盘.venv/Node/Chromium、profile、cache、tmp、截图和日志。没有执行C盘修改/删除或全局设置命令，没有启用1.5×/Fast。8787保持关闭，不碰旧用户安装/数据。两个LightForge无关未跟踪文件及协调方自己的evidence目录不改动、不暂存。

本轮源码已冻结，等待协调方验收、提交及第三轮编号5、6正式交接；不自行扩展。
