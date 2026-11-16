# Windows 离线评审包

构建工具：`scripts/Build-Offline.ps1`。这是 Windows x64 的本地评审运行包，不代作者新增源码许可，不把同机换路径验证称为跨机复现。最终阶段是否完成以 `handoffs/STAGE_3.md` 和真实证据为准。

当前三轮迭代后的实际核验包为`PolicyGlass-stage3-review-20261117-r5.zip`（995,065,649字节），冻结源码`93263c5617318b8ad8d2a7805a5978546a0f3151`，SHA256 `b98b98d1d4c5b4cec958d905fb1152b61ff26ff44673833f17615754b2f55269`。本机已安装到`D:/传智杯1/PolicyGlass-final-offline-20261117-r5-01/PolicyGlass-stage3-review-20261117-r5`，使用包根目录`Start-PolicyGlass-Offline.cmd`，网址`http://127.0.0.1:8787/`。350份Git文件、100份最终输入及完整交付manifest核对通过，20份参考状态和真实PPO/SAC更新通过。旧R4与原始数据保留。实际安装及键盘范围边界见[三轮记录](THREE_ROUND_REFINEMENT.md)；构建后065/066收据在仓库，未嵌入其自身冻结ZIP。

## 重新构建

在项目 D 盘目录执行：

```powershell
. .\scripts\Environment.ps1
& .\scripts\Build-Offline.ps1 -Name 'PolicyGlass-review-20261116' -IncludeStudy -Zip
```

名称必须唯一；已有包保持不变，构建不会删除或覆盖它。当前前端先重新构建，随后显式收集源码、锁定 Python 依赖的已安装文件、官方嵌入式 Python 3.12.7、官方 Node 24.22.1、MuJoCo 4.0.1 WASM 和本地构建前端。运行不依赖开发机 Python/Node/pnpm、虚拟环境绝对路径、GPU、API key 或网络。重新从源码构建前端仍需开发环境和锁依赖，离线运行包不包含完整 pnpm 开发工具链。

首次构建会从官方 HTTPS 源把运行时压缩包和第三方许可下载到 D 盘 `.runtime/release-downloads/`；后续使用本地缓存。Python 和 Node 压缩包有代码内固定 SHA256；Node SHA256 对照官方发行清单。所有归档文件均有 SHA256 和字节数。构建耗时、首次下载、压缩、解压和首次实际更新分别报告，不混为“十分钟复现”。

包位于 `.runtime/release/<名称>/`，可选 ZIP 在旁边，另有 ZIP SHA256 JSON。`manifest.json` 记录源提交、未提交路径、每个实际交付文件的哈希、运行时来源、版本和组装耗时。源码提交存在未提交变更时会明确标记；最终封存前须由负责人从最终代码重新构建。

`-IncludeStudy` 按预登记 `docs/STAGE3_STUDY.json` 收齐 4 条件 × 5 种子全部实际 `final.pgz` 与 `result.json`，核对种子/算法，保存到 `examples/study/`，并在 `examples/index.json` 记录 SHA256、交互/更新次数和完整结果。缺一条就失败，不挑选最佳种子。包同时收录公共 `evidence/`、阶段交接和研究协议；私密目录始终排除。不带该开关的包仅用于运行时预检，不冒充最终比赛证据包。

## 解压和启动

双击包根目录的 Start-PolicyGlass-Offline.cmd 启动，避免.ps1被记事本打开；此入口不永久更改执行策略。必须把整个目录解压到 D 盘；例如 `D:\PolicyGlass-review\`。无需安装软件、激活虚拟环境或改系统设置。

```powershell
& 'D:\PolicyGlass-review\Start-PolicyGlass-Offline.ps1'
```

在浏览器打开 `http://127.0.0.1:8787/`。启动脚本仅为当前进程设置路径，所有日志、数据库、缓存和临时文件均位于包内 `.runtime/`。运行前应确保 8787 空闲。Ctrl+C 停止服务。服务始终绑定 loopback，请勿直接公开到互联网。

CPython `python312._pth` 仅包含包内标准库、包内第三方依赖和包内 `src/`，不复制 `pyvenv.cfg`、开发机绝对路径或 editable 安装。Node 的路径也由包位置导出。操作系统 DLL 和 PowerShell 仍由 Windows 提供；未声称在无 Windows 系统组件的机器运行。

离线版的 `sitecustomize.py` 限制其 Python 子进程的外连和外部 DNS，仅允许 loopback；它不修改防火墙，也不限制用户其他程序或 Node 本身。原生物理宿主仅从本地读取 WASM。DeepSeek 凭证不继承、不打包；可选在线讲解应在源码开发版单独配置。离线核心、课程、3D 和训练独立工作。

## 独立路径验证

```powershell
& 'D:\PolicyGlass-review\scripts\Verify-Offline.ps1' -Bundle 'D:\PolicyGlass-review'
```

工具先清理当前进程的开发路径/代理/凭证环境，校验所有交付文件 SHA256，拒绝额外文件（包内 `.runtime/` 除外）；再检查实际解释器、模块路径和外部网络拒绝，启动自有 8791 API 进程，读取生产网页本地资源，分别真实执行 PPO/SAC 更新并要求 optimizer Trace。最后停止自有服务并把命令结果、时间、真实作业/Trace ID 保存到 `.runtime/verification.json`。8791 仅用于 API 验证；工作台 Origin 白名单继续使用 8787。

此检查验证“包已在本机 D 盘后，从该包独立运行”；不同机器的 Windows DLL/CPU/GPU、图形性能和跨机数值容差仍需在另一台真实机器测量。禁止把未做的跨机测试、学习者反馈或策略收敛记成通过。

## 许可与隐私边界

`THIRD_PARTY/` 归档实际许可证/NOTICE 文本、官方来源以及 Python 发行包的许可；`third-party-notices.json` 列出文件、来源哈希和缺口。Python/Node 运行时保留其完整许可证；MuJoCo 许可和静态依赖来源单独保存。不能用一个 `"license":"MIT"` 字段代替完整文本。

若存在许可文本/版本对应缺口，包状态标记 `NOTICE_GAPS_REVIEW_ONLY`，不能宣称已完成可公开再分发的发布审查。当前源码根目录没有明确项目 LICENSE 时，`SOURCE-LICENSE-SCOPE.txt` 提醒需作者确认授权范围；本工具不替用户选择开源许可证。

前端每次使用 `scripts/build_license_modules.mjs` 的实际 Rollup `chunk.modules`、`renderedLength` 和 CSS 的 `isIncluded` 留证。当前构建真正分发 15 个 npm 包；`tasks-vision`、`stats-gl`、`maath` 无输出模块，未把其未分发代码列成许可缺口。KaTeX CSS 和字体单独保留。`frontend/rendered-modules.json` 含每个模块及全部输出 SHA256，打包前要求和实际分发的每个输出逐一一致；变化后必须重新计算。

`@react-three/fiber@9.8.2` 的 npm 包没有许可文件；已从其官方发行 tag `v9.8.2` 指向的固定提交 `d74622ea8ed717f7212d7e19d65ff3e325508389` 归档完整 MIT 文本及 `Copyright (c) 2019-2025 Poimandres`，没有自拟版权年份。另从实际 20 个 KaTeX TTF 的 `name` 表逐字提取版权、保留字体名和 OFL 声明，再附 [SIL 官方 OFL1.1 全文](https://openfontlicense.org/documents/OFL.txt)；`THIRD_PARTY/fonts/` 保留每字体/格式 SHA256 和可读文本。KaTeX 代码 MIT 与字体 OFL 分别记录。

其余归档来源包括 MuJoCo 所固定的 libccd、lodepng、Qhull、tinyxml2、tinyobjloader、miniz、MarchingCubeCpp 及 Emscripten。初次核查曾遇到 GitHub 路径 404 和 Python urllib TLS EOF，保留失败组装目录；随后改用官方 HTTPS PowerShell 下载器并查明实际 tag/依赖来源。预检的全部实际分发依赖许可文本清单无缺口；这不代替作者对源码授权的决定，也不构成正式法律意见。

只复制明确允许的源码、文档、测试、锁文件、工具及编译产物，不复制 `.env`、API key、Git 元数据、真实私密对话、参与者原始信息、实验数据库、运行缓存、旧 CounterLab/LightForge 文件或开发者任意目录。研究检查点仅来自负责人明确授权的预登记研究目录；本工具不会把私人运行 store 当作发布样例。
