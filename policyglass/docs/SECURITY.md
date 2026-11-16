# 安全范围和已知依赖公告

此项目是只绑定loopback的本地科学工作台，不是经过认证的公网多用户服务。威胁输入包括恶意实验包、越界配置、浏览器跨源写请求和不可信模型回答。科学计算不接收可执行表达式，不导入用户Python/JS，不加载pickle、Torch `.pth`、TorchScript或 `.pt2`。

## 已执行的防护与核验

导入只接受有限大小的指定JSON/Safetensors ZIP，校验条目、哈希、形状、dtype、有限值和完整状态；拒绝重复张量引用以防内存放大。实验对象使用固定ID和受限路径，不接受任意系统路径。服务端限制训练、切片、请求和Trace预算。CSP、Host/Origin和WS源白名单、纯文本呈现、明确取消/失败状态均有实际测试。大事件投影与原Trace哈希绑定，逐项验证，不用解释近似代替真实值。

DeepSeek固定官方HTTPS入口，不接收任意Base URL，不跟随重定向、无工具/代码执行；有限事件外发前必须显示预览并明确发送。密钥只由服务端D盘配置读取，不写日志/仓库/导出。来源ID校验不代表模型解释正确。供应商边界测试使用明确模拟响应，未声称真实账户或质量已验证。

## 依赖审计与处置

034为实际38个Python锁包的OSV查询，保留公告ID、别名、受影响范围和官方链接；重复别名不是额外独立漏洞。035为同期真实pnpm审计，报告0条公告，含开发依赖。两者都只是时间点数据库查询，不能推断所有潜在缺陷不存在。

原参考环境的setuptools78.1.0存在PackageIndex路径穿越、sdist Unicode排除和Windows legacy wheel路径公告。已更新为84.1.0：独立候选104项测试、科学verify及14个完整恢复状态逐位比较均通过（043兼容、044、045）；主环境实际更新、editable元数据刷新和pip check通过。最终审计048单独保留Torch公告，没有把全部Python依赖说成0。旧研究锁保存在 `requirements-study-py312.lock`，主锁只改setuptools版本。来源：[PyPA Windows wheel公告](https://github.com/pypa/setuptools/security/advisories/GHSA-xmj3-9gf7-h52w)、[PyPA sdist公告](https://github.com/pypa/setuptools/security/advisories/GHSA-h35f-9h28-mq5c)。

原参考Torch2.8.0+cpu有公开安全公告，包括weights_only unpickler、JIT、RNN/序列及export加载路径。项目不调用这些入口：只从经校验的数值张量构造自有MLP，不执行上传的模型、脚本或表达式；SAC/PPO图由固定代码构造。这个可达性分析只覆盖当前应用接口，**不把有公告的Torch包称为零漏洞或任意用途安全**。不得拿该环境加载网上未知 `.pth/.pt2` 或运行未知Python程序。官方原始来源保留在034；例如 [PyTorch unpickler公告](https://github.com/pytorch/pytorch/security/advisories/GHSA-63cw-57p8-fm3p)。

D盘独立候选Torch2.13.0+cpu和2.10.0+cpu安装后，在本机均以WinError1114/c10.dll初始化失败，不能开始数值验证。失败命令、日志和状态见038/043相关报告；安装及pip check通过不代表可用。未混用DLL、未改系统设置或C盘文件，也未把其原因臆断为已知系统问题。当前发布必须以实际可导入且科学核验通过的环境为准，保留原研究版本，明确残留公告和入口限制。

当前闭包使用已验证的Torch2.8.0+cpu、NumPy2.2.6、setuptools84.1.0。048记录的Torch公告按当前应用无不可信pickle/JIT/RNN/export.load入口作有限可达性处分；未来扩展这些入口必须重新审查，不能继承这一结论。跨机器新原生Torch环境、长期压力、真实模型质量和独立渗透测试仍未执行。保持本地、结构化和有限资源的使用范围；不要把依赖审计、机器代码审查或局部攻击面测试称为安全认证。
