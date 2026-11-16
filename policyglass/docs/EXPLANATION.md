# 可选 DeepSeek 数值讲解

此功能解释当前用户选择的真实事件，不参与训练和科学判定。未配置密钥、超时或服务失败时，本地课程、原始数值、PPO/SAC、三维与导出继续工作。

## 配置与外发

只在项目的 D 盘忽略目录 `.runtime/config/deepseek.json` 保存服务端配置：

```json
{
  "api_key": "在本地填入；不要提交或导出",
  "model": "deepseek-flash",
  "timeout_seconds": 30,
  "max_tokens": 1024,
  "max_requests": 20,
  "session_output_budget": 12288
}
```

也可由启动进程的 `DEEPSEEK_API_KEY` 环境变量覆盖密钥。不读取浏览器密钥，不接受任意 Base URL，不使用环境代理、不跟随重定向。修改配置后重启服务。配置格式错误会回到离线状态，错误信息不回显秘密。

用户先选择已保存 Trace 的事件，提出问题，查看完整外发预览，再点击“同意发送这些内容”。后端校验实验归属、事件范围和预览 SHA256。每次最多三个事件；界面默认仅当前一个事件。只发有限数值节选、来源版本、用户问题及固定规则。张量原始形状与省略明确标记；私密笔记、完整轨迹、其他实验与密钥不加入请求。精确外发 JSON 上限 18KB；返回正文上限 64KiB。

## 官方协议

2026-11-16 只读核实官方文档：固定 `POST https://api.deepseek.com/chat/completions`，当前模型使用 `deepseek-flash` 或 `deepseek-v4-pro`，通过 `max_tokens` 限制输出、`response_format:{"type":"json_object"}` 请求 JSON。非思考模式显式设为 `thinking:{"type":"disabled"}`，无工具/搜索/文件上传。来源：[Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)、[JSON Output](https://api-docs.deepseek.com/guides/json_mode/)。模型可用性仍以实际官方响应为准。

不显示虚构“思考过程”。真实状态为 queued/requesting/completed/cancelled/failed。单次硬超时 1–60 秒，只允许一个活动请求，不自动重试。每个服务进程累计限制请求数和预留输出 token；失败或取消也消耗保守预留，不通过重试绕开。它不是精确人民币预算；实际费用以供应商计费为准。取消会关闭本地请求，供应商可能已经开始计费。

## 回答、来源与建议

模型返回结构化解释、非空 eventID 引用和可选建议。引用必须属于本次授权事件；未知/重复引用、空白/截断正文、无效配置和超预算响应全部显示失败，不接受为答案。来源按钮定位事件。引用通过只说明 ID 存在，不能证明讲解内容正确；回答始终标为需要与原始数值核对。

可选建议仅为当前算法白名单内的单个超参数改动，并重新通过 `ExperimentConfig` 验证。界面显示来源、参数和值，用户再到分支面板手动检查执行；助手不改模型、不训练、不执行模型代码。回答以 React 文本渲染，不执行 HTML/Markdown/脚本。

不持久化问答、原始供应商正文或 API key；任务最多保留 20 条内存记录，服务重启即过期。任务响应仅包含经过验证的结构、实际返回模型名和供应商报告的 token 用量。错误正文脱敏。

## 接口与集成

`install_explanations(app, repository)` 安装路由并返回管理器。主服务 lifespan 结束时调用 `await explanations.close()`；路由应在前端 StaticFiles 挂载之前安装。

| 路由 | 用途 |
|---|---|
| `GET /api/explanations/status` | 是否配置、模型、超时与本会话预算，无密钥 |
| `POST /api/experiments/{id}/explanations/preview` | `{trace_id,event_indices:[0],question}` → 完整外发 payload、sha256、来源 |
| `POST /api/experiments/{id}/explanations` | `{request:{...},preview_sha256,consent:true}` → 202 真实任务 |
| `GET /api/explanations/{id}` | 状态、经过验证的答案/来源/用量/安全错误 |
| `POST /api/explanations/{id}/cancel` | 取消当前网络请求 |

React `Explanation` 接受 `experimentId`、`traceId`、`eventIndex`、`onLocate(index)`。选择实验/Trace或离开组件时取消未完成请求；预览后改变问题/事件会使预览失效。

## 实际验证边界

`tests/test_explanation.py` 使用真实本地 PPO 计算事件检查归属、预览和只读性；所有供应商响应使用明确的 `httpx.MockTransport`。测试覆盖离线、绑定预览、预算、外发字段、引用、非法建议、空白/截断/过大结果、HTTP错误脱敏和请求取消。它们不证明官方账户可用，也不证明模型科学解释质量。未配置真实账户时不得声称已通过真实供应商 E2E；后续可在用户授权的密钥和配额下手动实测并保留脱敏证据。
