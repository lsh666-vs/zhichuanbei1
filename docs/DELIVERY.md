# 本次交付索引

源码：GitHub `lsh666-vs/zhichuanbei1`，公开仓库，保留从方案、契约、引擎、后端、界面到实际缺陷修复的逐步提交。执行器语义版本 1.0.0，应用发行版本 0.1.0。

## 运行产物

- Windows x64 便携 ZIP：`release/CounterLab-win-x64-20261116-020419-366.zip`。
- ZIP 大小：60,853,912 字节。
- SHA-256：`f0954f9bb4e180a863f99db721640b39a879a0259f63a6d3a5f0ba9dd4ecfdb7`。
- 同名 `.zip.sha256` 和 `.zip.verification.json` 为归档校验及独立解压验收记录。
- 机器原始发行验证副本：[release-verification-20261116.json](../evidence/release-verification-20261116.json)。

ZIP 与依赖不进入 Git；源码中的打包和验证脚本可以生成新的发行包。两次构建的 UUID、时间戳和 ZIP 字节不保证完全相同，固定语义的程序和实验结果按记录版本重放。最终源码的运行部分、前端 dist、包信息和锁文件共29项，与最终发行清单比对一致。

本机 D 盘工作区额外准备了 `启动反例实验室.cmd`：调用已验证的包内 Node，沿用仓库外泄露保护下的本地 `.env` 配置与已有数据目录。它是机器本地便捷入口，不包含密钥正文，不作为可转移源码的一部分。独立分发请使用 ZIP 内的 `Start-CounterLab.cmd`；包内没有真实密钥。

2026-11-16 修复本机启动入口的进程生命周期：本机入口现在通过 `scripts/background.ps1` 启动独立后台 Node，启动器退出不再导致网页关闭；`停止反例实验室.cmd` 核对 PID、可执行路径与创建时间后停止。日志和状态留在 D 盘，不注册系统服务或开机任务。此启动修复不改变已校验的 ZIP；ZIP 原前台入口仍按原说明保持窗口打开。

## 验证与资料

完整验证见 [实测报告](TEST_REPORT.md) 和 [复现说明](REPRODUCIBILITY.md)。关键结果为92项单元/接口检查、14项完整浏览器检查、960个独立计算样本、4次真实官方模型调用；最终包在同主机全新目录中112.587秒完成解压、校验、三领域全流程和重启验证。

使用说明：[用户指南](USER_GUIDE.md)。设计和计算边界：[架构](ARCHITECTURE.md)、[已知限制](KNOWN_LIMITS.md)、[来源与许可](THIRD_PARTY.md)。真实界面：[桌面](screenshots/workbench-desktop.png)、[手机](screenshots/workbench-mobile.png)。

开发过程证据见 [三条真实迭代索引](../evidence/ITERATION_CHAINS.md) 和 [证据说明](../evidence/README.md)。原始可见导出排除私有推理并脱敏；有明确截断边界，不能伪称完整无缺。视频、PDF及参赛者本人协同过程展示按当前范围留待最终参赛材料阶段，没有伪造试用人群或学习效果。
