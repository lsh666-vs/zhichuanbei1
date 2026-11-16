# 光铸 LightForge

光子芯片逆向设计与制造鲁棒性实验室。项目将自然语言目标、三维结构、电磁场、伴随梯度、约束优化和制造误差分析放在同一套可复现实验中。完整范围见 [开发方案](docs/DEVELOPMENT_PLAN.md)。

当前是三个串行阶段中的第一阶段：物理与工程基础。后续阶段分别完成伴随优化/制造鲁棒性，以及高级三维交互产品/集成交付。四项核心能力均为最终必交内容。

**当前状态：第一阶段基础已验证，准备串行交接。** 已有38项测试通过及独立干净环境复现；这不代表完整产品和真实器件性能已经完成。实际数值与交接状态以 [第一阶段交接](handoffs/STAGE_1.md) 和对应验证回执为准。

交互是必交能力：最终应用必须能编辑、重算、探针/剖切检查、比较和继续新实验。静态输出与预计算回放不能代替这些能力。[交互验收规范](docs/INTERACTION_ACCEPTANCE.md)将逐项记录实际操作与计算变化。

## 本阶段范围

- 严格校验的物理配置、单位、几何关系、资源预算与配置哈希。
- 真实三维 Yee 交错网格矢量 Maxwell 频域求解基础。
- 有解析参考的 PEC 腔体制造解，以及局域电流激励的 SiN 直波导/残留薄层模型。
- 同源三维几何描述、原始网格场、E/H 采样、能流、空间探针与结果清单。
- 实验持久化、独立计算进程、状态事件、取消、结果与安全导出接口。
- 科学验证协议、原创视觉素材与后续阶段交接契约。

这些模块的具体完成和验证覆盖由交接文件逐项列出。三维工作台的完整交互、真实端口模态归一化、伴随优化及制造鲁棒性由后续阶段实现，不在第一阶段伪装完成。

## 环境与启动

开发位置：`D:/传智杯1/counterlab/lightforge`。目标环境为 Windows x86-64、CPython 3.12。开发时优先将代码、依赖、缓存、临时文件和运行数据放在 D 盘。

每个 PowerShell 会话先执行：

```powershell
Set-Location 'D:\传智杯1\counterlab\lightforge'
. .\scripts\env.ps1
```

该脚本将运行数据默认放到本项目的 `.runtime/data`，并将缓存和临时文件重定向到 `.runtime`。`.runtime` 与 `.venv` 不提交。

如果已有完整的 Python 3.12，可创建独立环境：

```powershell
python -m venv .venv
& '.\.venv\Scripts\python.exe' -m pip install -e '.[dev]'
```

当前机器的 `D:/Dev/Python312` 是不含 `venv` 模块的嵌入式运行时，使用项目内 virtualenv 引导创建 `.venv`。当前 `.venv/Scripts/python.exe --version` 已实际返回 `Python 3.12.7`。重建该环境的确切方式与依赖锁定由交接文件给出；不要修改系统 Python 或依靠其他项目的环境。

主计算路线为 NumPy/SciPy 的原生三维矢量 FDFD。原计划 NGSolve/Netgen 的 OpenCascade DLL 被本机应用控制拒绝，项目保留系统安全策略，NGSolve 改为可选依赖。此实现选择保留真实三维计算与全部科学验收要求。[架构说明](docs/ARCHITECTURE.md)

使用本机嵌入式 Python 时，提供引导脚本：`& .\scripts\setup.ps1 -Python 'D:\Dev\Python312\python.exe'`。它使用 D 盘本地 virtualenv 引导与 `requirements-win-py312.lock` 安装。独立干净环境已经按同一锁文件完成38项测试、CLI/Schema与依赖检查，约87秒，具体命令与缓存条件见 `evidence/006-engineering-validation.md`。完整产品的便携包由最终交付阶段制作。

`.env.example` 是本地配置模板。第一阶段脚本读取进程环境变量；不要假定服务已经自动加载 `.env` 文件。自定义数据目录可以在加载脚本后显式设置：

```powershell
$env:LIGHTFORGE_DATA_DIR = 'D:\LightForge-data'
```

第一阶段数值基础不需要 API 密钥。DeepSeek 是后续阶段的可选意图理解与教学解释服务，真实密钥不得进入仓库、导出包或日志。

## 命令行与接口

以下是本阶段约定的 CLI；实际可执行情况及输出以交接回执为准：

```powershell
& '.\.venv\Scripts\python.exe' -m lightforge.cli --help
& '.\.venv\Scripts\python.exe' -m lightforge.cli schema
& '.\.venv\Scripts\python.exe' -m lightforge.cli solve examples/cavity.json --output .runtime/cavity
& '.\.venv\Scripts\python.exe' -m lightforge.cli validate examples/cavity.json
& '.\.venv\Scripts\python.exe' -m lightforge.cli benchmarks --output .runtime/validation
& '.\.venv\Scripts\python.exe' -m lightforge.cli serve --port 4321
```

服务默认监听本机，接口契约见 [CONTRACTS.md](docs/CONTRACTS.md)。完整 React 三维产品尚由第三阶段交付，第一阶段启动 API 不等于完整网页已经完成。

生成真实可交互三维科学诊断（需先执行上面的 benchmarks）：

```powershell
& '.\.venv\Scripts\python.exe' scripts/render_diagnostics.py --run .runtime/validation/cavity-12 --verification .runtime/validation/verification.json --output .runtime/diagnostics
```

打开输出的 `field-diagnostics.html`，可旋转等值面、切换电场实部/幅值和拖动实际z采样切片。此科学诊断读取真实场数据，不等于完整交互产品。当前机器的已生成文件在 `.runtime/diagnostics`。

## 结果与科学边界

每次结果保留完整配置、配置哈希、引擎、归一化、单位、网格和适用范围。原始交错网格场与显示采样分开存储。探针从原始网格插值，仍存在离散误差与材料界面插值限制，不能称为精确连续场。

典型数值文件包含 `spec.json`、`scene.json`、`result.json`、原始边电场 `coefficients.npy`、原始节点轴 `grid.npz` 和显示采样 `fields.h5`。HDF5 的复数 E/H 分别保存实部/虚部，并记录坐标轴与单位。

PEC 腔体是具有已知源项的解析验证问题。局域电流模型没有完成端口功率归一化，不能从任意源强度报告分波器效率或 S 参数。开放边界、表面通量和材料栅格误差必须通过实际收敛与独立验证。[科学验证说明](docs/SCIENTIFIC_VALIDATION.md)

完整作品还必须完成经验证的三维伴随梯度、多波长约束优化、独立几何规则检查、真实三维制造扰动、鲁棒设计及独立数值复核。旗舰目标性能写在开发方案中，尚不能当作已达到的指标。

## 真实记录与接力

新项目保留旧仓库历史，以细粒度提交记录方案、模块和实际修复。每次提交对应真实工作，不将全部功能放入一次初始提交，也不虚构用户反馈、Prompt 链或测试成绩。

第二、第三窗口依次等待前一阶段 READY 交接，读取代码、测试与限制后接手。当前顺序见 `handoffs/SEQUENCE.json`。原始可见聊天导出与证据索引共同保留；索引不替代完整 Prompt 历史。

视频与 PDF 按用户要求暂缓制作，开发过程中持续积累截图、科学图、演示脚本和真实协作记录。最终仍需满足比赛的 5–8 分钟视频、至少 2 分钟 AI 协作展示、最多 30 页 PDF 等提交要求。

更多文档：[复现说明](docs/REPRODUCIBILITY.md)、[视觉与三维交互规范](docs/VISUAL_SPEC.md)、[架构](docs/ARCHITECTURE.md)。
