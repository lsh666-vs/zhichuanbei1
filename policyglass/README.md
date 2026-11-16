# 策镜 PolicyGlass

PPO / SAC 神经网络底层机制的真实计算与交互实验室。

**离线包使用者**：把整个包解压到D盘，双击包根目录 `Start-PolicyGlass-Offline.cmd`，打开 `http://127.0.0.1:8787/`。保留启动窗口，Ctrl+C停止服务。`.ps1`直接双击可能被记事本打开；新的`.cmd`入口显式调用PowerShell，只对该进程设置执行策略。包内已带运行时，不用安装Python/Node或创建虚拟环境。下方 `.venv`、pnpm及Setup命令用于源码开发；完整离线核验见 [离线说明](docs/OFFLINE_RELEASE.md)。

用户已批准完整方案：[开发方案](docs/DEVELOPMENT_PLAN.md)、[科学契约](docs/SCIENTIFIC_CONTRACT.md)、[竞品与来源](docs/COMPETITOR_AUDIT.md)。

已实现本地 React/Three.js 工作台、四处计算来源明确的3D、深度张量/梯度/Adam检查、八课、受控分支、笔记和安全保存导入导出。第三阶段增加官方DeepSeek可选讲解、预登记多种子训练与机制实验、全部种子研究库、独立核验、键盘操作及离线评审包。准确结果和完成边界见 [第三阶段核验](docs/STAGE3_VALIDATION.md) 与 [最终交接](handoffs/STAGE_3.md)。真实学习者/专家反馈按用户要求暂留空，跨机器复现不能由同机迁移检查替代；视频/PDF继续暂缓。

项目位于已有比赛仓库的 policyglass/，保留旧项目的真实历史。所有开发写入、运行环境和缓存放D盘，不修改/删除C盘文件。

## 本机启动

本源码工作区的开发环境已经安装在 `.venv/`。PowerShell中：

```powershell
Set-Location 'D:\传智杯1\counterlab\policyglass'
. .\scripts\Environment.ps1
& .\.venv\Scripts\python.exe -m policyglass.cli serve --port 8787
```

首次先运行 `scripts/Build-Frontend.ps1`（锁依赖在D盘安装并构建）。打开 `http://127.0.0.1:8787/` 使用完整工作台；`/api/health`检查服务，`/docs`为本地OpenAPI文档页，`/openapi.json`可下载完整规范。也可运行 `Start-PolicyGlass.ps1`。页面、文档、公式字体均使用本地资源。

前端开发：先启动上面的API，在另一PowerShell执行 `. .\scripts\Environment.ps1`，然后 `Set-Location frontend`、`pnpm dev`。访问 `http://127.0.0.1:5173/`。更换Python配置/协议后需重启API，不能让旧进程与新worker加载不同版本。

## 干净环境安装

要求：Windows x64、Python3.12、Node22+（实测24.22.1）、pnpm（实测11.25.0）。Python和Node可以是已有安装，只读取可执行文件；项目自身不修改它们。安装位置须在D盘，不能使用C盘工作目录。

```powershell
Set-Location 'D:\传智杯1\counterlab\policyglass'
& .\scripts\Setup.ps1 -PythonExecutable 'D:\Dev\Python312\python.exe'
```

依赖锁为 `requirements-win-py312.lock`、`physics/pnpm-lock.yaml` 与 `frontend/pnpm-lock.yaml`。前端也有独立workspace，避免误装到旧项目；执行 `scripts/Build-Frontend.ps1 -Install` 安装和构建。PyTorch是CPU包，不需要CUDA、GPU或服务器。首次CPU包约619MB，网络下载不承诺十分钟。[离线包工具和独立运行说明](docs/OFFLINE_RELEASE.md)会分别记录构建、下载、解压及首次更新实测时间，不混为同一个指标。

Setup下载官方PyPA zipapp到D盘并检查已记录SHA256。若上游文件变化则停止，不悄悄接受新二进制。所有Python缓存、pnpm缓存、临时文件、数据和日志由Environment.ps1定向D盘。无需全局安装或改系统DLL。物理计算使用官方MuJoCo4.0.1 WASM，原因及边界见 [物理运行说明](docs/PHYSICS_RUNTIME.md)。

## 真实验证与自产示例

```powershell
. .\scripts\Environment.ps1
& .\.venv\Scripts\python.exe -m pytest -q
& .\.venv\Scripts\python.exe -m policyglass.cli verify --output .runtime/science-report.json
& .\.venv\Scripts\python.exe -m policyglass.cli demo --output .runtime/demo
& .\scripts\Test-Workbench.ps1 -InstallBrowser
```

`verify`独立复算样本梯度汇总、Adam和归一化梯度，检查状态重载、解析运动学、耗散与时间步长收敛。`demo`从自产数据运行PPO/SAC，输出真实Trace、精确更新前/后检查点、Q/损失切片。检查点 `.pgz` 使用JSON+Safetensors，不执行pickle。数值正确性不等于已经训练出成功策略；不会用短示例声称策略已经收敛。

`Test-Workbench.ps1` 要求8787/5173空闲，创建独立D盘测试store，实际启动服务和浏览器，完成后只停止自有进程。浏览器/临时profile/截图均在D盘。五项E2E覆盖训练检查分支导入重算、双Q数值、暂停恢复取消、前向/物理来源和真实五种子课程。另在frontend目录运行 `pnpm test` 检查坐标、网格索引和离面残差。具体结果、失败修复和边界保存在evidence。

默认Trace包含所有样本贡献，约12MB量级。前端先请求事件索引，再按需取事件，不能每帧下载完整Trace。初始64×64网络可以改成合法配置；完整追踪有显式内存预算。首页研究库显示全部登记种子和失败边界，可把任意已校验自产检查点复制成新实验；不是最好seed演示集。

## 接口、范围与证据

- [接口与数据契约](docs/CONTRACTS.md)：API、张量、坐标、任务和分支语义。
- [科学契约](docs/SCIENTIFIC_CONTRACT.md)：PPO/SAC精确定义与验收不变量。
- [真实验证记录](evidence/002-numerical-foundation.md)：初次通过与实际失败修复。
- `evidence/dialogue-stage1.jsonl`：从真实授权消息开始的公开原生记录节选；范围、脱敏和遗漏见同名manifest。私密完整原始文件保存在忽略目录，绝不伪造完整Prompt链。
- `evidence/dialogue-stage2.jsonl`：本聊天原生记录的真实快照节选；协调消息属于机器交接，不冒充人类反馈。截止时间、哈希和遗漏见manifest。
- [三个聊天协调信息](handoffs/CHAT_COORDINATION.json)：Stage1 READY后才启动Stage2；Stage2 READY后再启动Stage3。

本地服务仅绑定loopback，浏览器Origin和Host有白名单。不要把该科学服务直接暴露到公网。[DeepSeek讲解配置和限制](docs/EXPLANATION.md)：只有服务端D盘本地配置可持有密钥；用户看过外发预览并点击发送后才请求官方API。未配置时完整离线功能继续可用。供应商测试使用明确模拟响应，未声称真实账户与讲解质量已验证。`.env.example`不包含凭证。

研究预登记见 `docs/STAGE3_STUDY.json`；运行 `python -m policyglass.studies` 会实际消耗CPU训练，不能把研究脚本当瞬时截图演示。科学图通过独立分析依赖重建，`scripts/analyze_study.py` 只接受全部登记运行，并验证检查点哈希；分析依赖在D盘 `.runtime/analysis-libs/`，不加入应用运行依赖。真实反馈方案见 [LEARNER_PROTOCOL](docs/LEARNER_PROTOCOL.md)，比赛素材索引见 [SUBMISSION_MATERIALS](docs/SUBMISSION_MATERIALS.md)。

网络默认绘制全部神经元与层间权重，直接检查W/b、真实前向及参数分支。双Q和损失的自动计算与前提见 [网络与曲面](docs/NETWORK_EXPLORER.md)。
