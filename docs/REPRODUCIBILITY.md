# 启动、发行与复现

本文对应 Windows x64 发行脚本与当前引擎。固定输入、策略和种子可以重算实验；这不表示让模型重新生成源码时会逐字得到同样结果，也不表示两个 ZIP 的压缩字节必然相同。

## 运行便携版

1. 将完整 `CounterLab-win-x64-*.zip` 解压到 D 盘普通目录，例如 `D:\CounterLab`。不要直接在压缩文件预览里启动，不要把目录放在指向 C 盘的链接或 junction 下。
2. 双击 `Start-CounterLab.cmd`。保持命令窗口打开；服务打印 `CounterLab listening at ...` 后，在浏览器打开对应地址，默认是 `http://127.0.0.1:4317`。
3. 按 `Ctrl+C` 关闭服务。已保存实验位于应用目录的 `.runtime\counterlab.sqlite`；运行期间还可能有 SQLite WAL/SHM 文件。备份数据前先正常关闭服务。

便携包自带 Windows x64 Node.js **24.22.1** 和生产依赖。运行本地实验不要求另装 Node、pnpm、Python、数据库或购买服务器，也不需要模型密钥。包内 `examples` 提供区间、背包和图路由实验包，可用界面的导入功能重新验证。

应用只监听 `127.0.0.1`。启动脚本拒绝非 D 盘应用/数据目录以及路径中的 junction/symlink，并把临时文件和工具缓存放到应用上一级目录的 `.counterlab-runtime`。这些路径是当前 Windows 交付的明确限制；本项目未把其他平台启动方式列为已验证支持。

## 可选配置

需要 AI 功能时，在应用目录复制 `.env.example` 为 `.env`，只在自己的本机填写密钥。不要把 `.env` 加入压缩包、实验包、Git 或截图。

可以在 `.env` 设置：

```dotenv
COUNTERLAB_PORT=4318
COUNTERLAB_DATA_DIR=D:/CounterLab-data
```

端口必须是 1024–65535 的整数。Node 按自身 `.env` 规则解析配置；已有进程环境变量优先于 `.env`。启动提示与实际服务使用同一解析结果，因此会显示自定义端口。未设置数据目录时，使用应用自身 `.runtime`，不会用启动脚本的默认值覆盖 `.env`。

端口占用、配置错误、缺失前端构建、缺失生产依赖或运行时版本不符都会返回非零退出码并显示错误。脚本不会因为服务尚未监听就宣称启动成功。

## 从源码重建

源码构建环境为 Windows x64、Node.js 24.22.1、pnpm 11.25.0。项目及工具均放在 D 盘。在 PowerShell 中先初始化缓存路径，再运行包管理命令：

```powershell
Set-Location -LiteralPath 'D:\CounterLab-source'
. .\scripts\env.ps1
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
```

以上要求 `node` 和 `pnpm` 已在当前进程的 PATH 中。没有 pnpm 时，可以在已配置的 Node 环境和上述 D 盘缓存环境下安装到独立工具目录，不使用全局安装：

```powershell
npm install --prefix D:\CounterLab-tools pnpm@11.25.0 --ignore-scripts --no-audit --no-fund
$env:Path = 'D:\CounterLab-tools\node_modules\.bin;' + $env:Path
```

首次依赖安装需要网络；后续能否离线重建取决于 D 盘 pnpm store 是否包含锁文件需要的全部包。版本由 `pnpm-lock.yaml` 锁定；不能用一次成功安装推断所有未来机器都无需联网。

独立 Python 参照检查是开发验证，不是运行依赖：在 D 盘可用的 Python 3 环境执行 `python -B tests/oracle.py`。浏览器验证另需 Playwright Chromium；执行 `pnpm exec playwright install chromium` 前同样先加载 `env.ps1`，然后运行 `pnpm test:e2e`。脚本将浏览器下载到 D 盘，不要求修改系统浏览器。

## 创建发行包

在源码根目录执行：

```powershell
. .\scripts\env.ps1
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-release.ps1
```

默认先执行当前源码的完整类型检查与前端构建，再在 D 盘 `release` 下创建新的带时间戳目录。默认生产依赖安装使用离线 store；缺包时失败，不发布 ZIP。确认需要获取缺失包时，可用 `-AllowNetwork`。`-SkipBuild` 仅适用于刚刚成功构建的同一源码，脚本不能凭此开关证明 `dist` 没有过期。

打包步骤包含：

- 核对 Node 精确版本、Windows x64 目标和 pnpm 版本，复制对应 Node 程序及完整许可。
- 按名单复制前端构建、服务端、引擎、共享类型、示例和文档；不复制源码工作区的 `node_modules`、`.env` 或运行数据。
- 使用冻结锁文件、生产依赖、hoisted 布局和 copy 导入方式干净安装，不依靠指向原项目或 store 的文件链接。不执行依赖安装脚本。
- 拒绝链接、数据库、运行目录、私钥文件及明显令牌文本；检测仅显示路径，不打印秘密内容。此项扫描是额外检查，不能保证识别所有未知格式的秘密。
- 用发行目录自身的 Node/依赖加载服务端模块，并重新验证三个领域的演示反例。此处只检查模块和计算，不把它当作浏览器端到端测试。
- 生成 `RELEASE-MANIFEST.json`：记录版本、目标平台、各文件大小与 SHA-256；生成 ZIP 及独立 `.sha256` 文件。失败时保留中间目录便于诊断，不覆盖已有发行目录。

可以使用 `Get-FileHash -Algorithm SHA256 -LiteralPath '<ZIP的D盘路径>'` 与同名 `.sha256` 文件核对。清单不包含其自身的循环哈希；它记录 ZIP 内其他文件。时间戳、压缩器和依赖元数据可能使两次构建的 ZIP 哈希不同，因此这里的承诺是锁定依赖、明确输入和可核验文件，而不是字节级可重复构建。

源码完整开发文档、测试和开发记录在 Git 仓库；便携包针对运行与实验导入，不包含开发用测试工具、个人开发对话或用户数据库。第三方条款见 [第三方来源与许可](THIRD_PARTY.md)，系统边界见 [架构说明](ARCHITECTURE.md)。

## 最终发行验收

最终应用代码固定于 `240bd3c`，再次执行类型检查与生产构建，得到前端入口 `index-Bm0hQNWU.js`。最终发行包为 `CounterLab-win-x64-20261116-020419-366.zip`，大小 60,853,912 字节；SHA-256：

```text
f0954f9bb4e180a863f99db721640b39a879a0259f63a6d3a5f0ba9dd4ecfdb7
```

北京时间 2026-11-16，本次使用 **Windows PowerShell 5** 执行完整验收：将最终 ZIP 解压到源码目录之外的新建 D 盘目录，验证 ZIP 旁侧校验和与清单内 **7278 个文件**，再由包内 Node.js 24.22.1 与自身生产依赖启动。未复制开发 `.env` 或数据库，未下载依赖，未配置 AI，模型调用为 0。`.env` 内自定义端口 4320 和外置 D 盘数据目录生效。

| 最终包实测阶段 | 本次耗时 |
| --- | --- |
| Windows PowerShell 5 解压 ZIP | 91.533 秒 |
| 验证文件清单与哈希 | 13.117 秒 |
| 启动进程至 `/api/health` 就绪 | 1.710 秒 |
| 从开始解压，经文件校验，至本地服务就绪 | **108.090 秒** |
| 三个领域 HTTP 全流程与重启验证 | 从开始解压累计 **112.587 秒** |
| 第二次启动至就绪 | 1.133 秒 |

区间、背包、图均完成当前输入独立核验、真实搜索、缩减、13 例回归、保存、JSON 导出、导入重新计算及 HTML 报告。共 6 个保存/导入实验，在终止该发行包自身 Node 进程后重启完整保留。验证结束后测试服务关闭。包内 Markdown 相对链接全部可解析，README 截图、设计参考与公开证据摘要已包含；原始可见对话 JSON、真实密钥和用户运行数据均排除。

最终 ZIP、同名 `.sha256` 和 `.zip.verification.json` 放在源码目录的 `release` 下；后者是本轮验证结果副本，不嵌入 ZIP，避免修改已核验的归档。原始机器记录为 `D:\CounterLab release check 20261116-020846-398\verification.json`。ZIP 内文档在打包时固定；本节最终哈希和验收时间在验收完成后写入源码文档，因此以同名旁侧文件和源码最新本文为准。

计时范围为同一台 Windows 主机上的新目录解压与独立运行时验证，不包括 ZIP 下载、手工浏览器操作或全新操作系统安装；磁盘和杀毒扫描会影响解压速度。完整浏览器与界面验证另见 [实测报告](TEST_REPORT.md)。使用本机压缩包的本轮路径在 10 分钟内完成，但不把这一观测承诺为所有电脑的固定时限。

## 先前候选验收记录

候选包已于北京时间 2026-11-16 完成实际解压运行验证。验证使用本机 Windows x64，将 ZIP 解压到源码目录之外的新建 D 盘目录，不下载依赖、不复制源码 `.env`；启动的是包内 Node.js 24.22.1，`tsx`、`fastify` 均解析到解压目录自身。启动程序由 Windows PowerShell 5 执行，自定义端口 4320 与外置 D 盘数据目录均正常。

候选包 `CounterLab-win-x64-20261115-223406-930.zip` 的 SHA-256 为 `718bd161e626e251417e613834236cc7a699449da1a83f209b53391a2291d6f0`。旁侧校验和及清单内 7269 个文件全部一致。该包是集成阶段候选版本；最终交付包需以最终源码再次构建并核对，不能用候选包的验收替代后续修改的验收。

| 实测阶段 | 本次耗时 |
| --- | --- |
| 解压 ZIP | 18.903 秒 |
| 验证文件清单与哈希 | 6.807 秒 |
| 启动进程至 `/api/health` 就绪 | 1.697 秒 |
| 从开始解压，经文件校验，至本地服务就绪 | 29.158 秒 |
| 完成三个领域 HTTP 流程与重启验证 | 从开始解压累计 33.123 秒 |
| 第二次启动至就绪 | 1.133 秒 |

三个领域均实际执行：当前实例独立核验 → 固定种子搜索 → 缩减 → 原例与 12 个保留样本回归 → 保存 → 导出 → 导入重算 → HTML 报告。区间、背包、图分别在第 2、5、1 个采样找到反例，接受 26、32、11 个缩减步骤。每域保存和导入各一个实验，共 6 个；终止该发行包自身的 Node 进程后重新启动，实验 ID 与数据均保留，验证了 SQLite WAL 恢复。AI 未配置，外部模型调用次数为 0。

原始机器记录在 D 盘验证目录 `D:\CounterLab release check 20261116-015328-166\verification.json`，源码中的 `scripts/verify-release.ps1` 可按下面命令重复运行。脚本每次创建新目录，不覆盖已有实验：

```powershell
. .\scripts\env.ps1
.\scripts\verify-release.ps1 -ZipPath 'D:\路径\CounterLab-win-x64-版本.zip' -Port 4320
```

这是同一台电脑上的独立新目录验证，不是新装操作系统、真人使用时间或浏览器完整流程的耗时。计时从本地 ZIP 开始解压，不包含获取 ZIP、手工打开浏览器或模型联网延迟；磁盘、杀毒扫描和机器负载会影响结果。浏览器流程、桌面/手机布局与无障碍检查由主开发任务另行记录。

本轮还修复了验证脚本在 Windows PowerShell 5 下默认 ANSI 读取 UTF-8 清单时对 Unicode 文件名的错误处理：依赖附带 `snow ☃` 测试文件夹，默认编码导致路径非法。清单现显式按 UTF-8 读取；应用计算本身不受此问题影响。此前失败的目录和日志保留在 D 盘，未伪记为通过。

数值引擎的已执行检查及限制见源码仓库 `evidence/engine-development.md`。随机搜索未找到反例是有界抽样结果；导入会重算实例，但不重建未保存的全部采样历史，也不重新证明缩减最小性。
