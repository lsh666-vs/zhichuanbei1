# 来源、第三方组件与许可

CounterLab 的领域执行器、表达式解释器、反例搜索/缩减、证据结构和工作台代码由本项目开发，未以现成同类产品作为底座。动态规划、Dijkstra、Bellman–Ford、种子随机采样、性质保持缩减属于已有通用方法，本项目不宣称发明这些方法。

| 组件 | 用途 | 许可 / 来源 |
| --- | --- | --- |
| React / React DOM | 界面与状态渲染 | MIT，随依赖保留 LICENSE |
| Fastify / @fastify/static | 本机 API 与静态资源 | MIT，随依赖保留 LICENSE |
| Zod | 边界数据校验 | MIT |
| Lucide | 通用功能图标 | ISC |
| tsx / esbuild | 本地 TypeScript 运行 | MIT |
| Vite / TypeScript / Vitest | 构建、类型检查与测试 | MIT / Apache-2.0 / MIT |
| Playwright | 浏览器流程验证，仅开发依赖 | Apache-2.0 |
| Node.js 24.22.1 | Windows 便携运行时与 SQLite 接口 | Node 及所含第三方许可见 [完整许可](licenses/NODE-LICENSE.txt)；[对应官方版本](https://github.com/nodejs/node/blob/v24.22.1/LICENSE) |
| SQLite | 本地数据库，经 Node 提供 | 公有领域，实际分发条款见 Node 许可 |
| DeepSeek 官方接口 | 可选的策略提案与解释 | 外部在线服务；不包含模型权重，费用以账户账单为准 |
| 原创生成设计稿与横幅 | 视觉设计参考、装饰资产 | 内置图像生成工具生成，过程见 [素材记录](design/ASSETS.md) |

精确直接与间接版本由 `pnpm-lock.yaml` 锁定。发行包带生产依赖自身的 LICENSE/NOTICE；前端使用的 React、Lucide 等代码仍受各自许可约束。Node 许可文件来自上述版本官方仓库，未修改。产品不使用外部字体、远程图片 CDN 或遥测服务。

AI 请求仅用于用户主动触发的策略建议与解释，传输的是该次领域/策略/实验内容；密钥留在本机服务端。模型文字不作为数学证明，必须经过程序执行与独立核验。官方接入参数参照 [Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)；本项目对官方域名显式禁用思考模式，以获取有界 JSON 结果。
