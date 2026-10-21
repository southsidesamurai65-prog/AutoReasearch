# 自动科研台

一个本地运行的多 Agent 科研工作台：左侧管理工作区、资料和 Agent，右侧实时查看调用链、Boss 汇报和教师讲解。真实模式通过 [opencode](https://opencode.ai)、[Claude Code](https://docs.anthropic.com/en/docs/claude-code)、[Codex CLI](https://developers.openai.com/codex/cli) 或任意 OpenAI 兼容 API 端点调用模型，直接在你的项目目录里读写文件。

当前版本已完成：**运行历史持久化、预算/轮次/超时限制、子代理会话清理、网络代理设置、工作区快照与回滚，以及 opencode / Claude Code / Codex / OpenAI 兼容 API 四种 harness**。

## 功能

- **多 Agent 编排**：Boss 规划任务，按需调度搜索、后端、前端、Debug、攻坚、教师等角色。
- **多 harness**：每个 Agent 可独立选择 opencode、Claude Code、Codex CLI 或 OpenAI 兼容 API。
- **真实 / Mock 双模式**：Mock 不调用模型，用于演示和 UI 调试。
- **Boss 线程续聊**：跨运行复用 Boss session，支持项目记忆和自动新开；更换 harness 或模型会自动新开。
- **实时事件流**：SSE 推送调用节点、Boss 流式汇报、教师讲义。
- **工作区直读直写**：Agent 以当前工作区为 cwd，文件区和外部引用可挂载资料。
- **运行历史**：报告、调用链、成本与状态持久化到 `data/runs/`，重启不丢。
- **成本与轮次限制**：每个 Agent 的 `budgetUsd`、`maxTurns` 和全局超时会在 harness 层强制生效。
- **子代理会话清理**：默认在子任务完成后删除子代理会话，只保留 Boss 会话。
- **网络代理**：支持 `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` / 自定义 CA，并在设置页测试模型连通性。
- **工作区快照**：真实运行前为 git 工作区创建快照，结束后可查看 diff，也可回滚到运行前。

## 技术栈

- 后端：Node.js、TypeScript、Fastify、SSE
- 前端：React 19、Vite、Tailwind CSS
- Agent 执行：opencode CLI、Claude Code CLI、Codex CLI、OpenAI 兼容 API
- 数据：本地 JSON 文件

## 环境要求

- Node.js 20+
- 至少准备一种执行方式：安装并登录任意一种 CLI，或准备一个 OpenAI 兼容端点。

  ```bash
  opencode --version && opencode auth login
  claude --version   # Claude Code，按 CLI 提示登录
  codex --version && codex login
  ```

- 直连 API 不需要安装 CLI，但需要支持 `/chat/completions` 的端点和模型名；API Key 可选。
- 建议在独立的 git 工作区里运行，便于快照、diff 和回滚。
- 真实模式下 Agent 可以执行命令和修改工作区文件；opencode 使用 `--auto`，Claude 使用 `bypassPermissions`，Codex 使用 `workspace-write + approval never`，直连 API 使用内置工作区工具。

## 快速开始

```bash
npm install
npm run dev
```

启动后：

- Web UI：<http://127.0.0.1:5173>
- API：<http://127.0.0.1:8787>

生产构建：

```bash
npm run build
npm start
```

`npm start` 会以生产模式启动 Fastify，并托管 `dist/`。

## 目录结构

```text
.
├── server/                 # Fastify API、编排、harness、持久化
│   ├── harness/
│   │   ├── opencode.ts     # opencode CLI 适配、session、费用与限制
│   │   ├── claude.ts       # Claude Code stream-json 适配
│   │   ├── codex.ts        # Codex exec JSONL 适配
│   │   ├── openai.ts       # OpenAI 兼容 /chat/completions 适配与工具循环
│   │   └── index.ts        # harness 分发与会话清理
│   ├── runs.ts             # 运行生命周期、历史、快照
│   ├── run-history.ts      # data/runs/ 持久化
│   ├── real.ts             # 真实多 Agent 编排
│   ├── workspace-checkpoint.ts
│   ├── workspace.ts        # 工作区、引用、Boss 线程
│   └── store.ts            # Agent 与运行设置
├── shared/                 # 前后端共享类型与预设
├── src/                    # React UI
│   ├── components/         # 面板、弹窗、设置、历史
│   ├── hooks/useRun.ts     # SSE 运行状态
│   └── lib/api.ts
├── data/                   # 本地数据（gitignored）
│   ├── config.json         # Agent、网络、运行限制
│   ├── state.json          # 活动工作区、引用、Boss 线程
│   ├── api-sessions/       # 直连 API 的本地会话历史
│   └── runs/               # 运行历史
├── dist/                   # 生产构建产物
└── README.md
```

## 配置

### 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `AUTO_DATA_DIR` | `./data` | 配置、状态和历史目录 |
| `PORT` | `8787` | 后端端口 |
| `HOST` | `127.0.0.1` | 监听地址，默认仅本机 |
| `LOG_LEVEL` | `info` | Fastify 日志级别 |

### 模型与 harness

在左侧「子代理编排」里为每个 Agent 选择 harness 和模型。

**opencode**：使用 `provider/model`，例如：

```text
opencode/deepseek-v4.1-flash
opencode-go/deepseek-v4.1-flash
opencode/glm-5.3-flash-free
opencode/deepseek-v4.1-flash-free
```

**Claude Code**：可填 `haiku`、`sonnet`、`opus` 等别名，或完整模型名；留空使用 CLI 默认模型。

**Codex CLI**：可填 `gpt-5.x` 等模型名；留空使用 CLI 默认模型。

**OpenAI 兼容 API**：填写模型名、Base URL 和可选 API Key。Base URL 可以是：

```text
https://api.openai.com/v1
http://127.0.0.1:8000/v1
https://openrouter.ai/api/v1
```

系统会自动补全为 `/chat/completions`；也可以直接填完整的 `.../chat/completions` 地址。API Key 会以 `Authorization: Bearer <key>` 发送，留空则不带认证头，适合本地端点。

CLI harness 的登录态由各自 CLI 管理；`baseUrl` / `apiKey` 只对 OpenAI 兼容 API 生效。设置页提供「保存并测试 Boss 模型」，会使用 Boss 当前的 harness 发起一次极小的真实请求。

### CLI harness 细节

| harness | 执行方式 | Boss 续聊 | 子代理清理 |
| --- | --- | --- | --- |
| opencode | `opencode run --format json` | `--session <id>` | 完成后 `opencode session delete` |
| Claude Code | `claude -p --output-format stream-json --verbose` | `--resume <id>` | `--no-session-persistence` |
| Codex CLI | `codex exec --json` | `codex exec resume <thread-id>` | `--ephemeral` |
| OpenAI 兼容 API | `POST /v1/chat/completions` | 本地 `data/api-sessions/<id>.json` | 子代理默认 ephemeral，不落盘 |

- opencode 使用 `--auto` 自动批准工作区权限。
- Claude Code 使用 `--permission-mode bypassPermissions` 和 `--max-budget-usd`。
- Codex 使用 `workspace-write` sandbox 和 `approval_policy="never"`。
- 直连 API 提供 `read_file`、`list_files`、`write_file`、`run_command` 四个工具；写入限制在工作区内，`.auto/refs` 只读。端点不支持 `tools` 时会自动退化为纯对话，此时不能读写工作区。
- 直连 API 当前使用非流式请求，文本会在每个响应步骤完成后写入调用链，而不是逐 token 推送。
- Codex CLI 和直连 API 目前不提供费用硬上限，`budgetUsd` 只做记录，不会中止调用；超时和轮次限制仍然生效。

### 网络代理

点击顶栏齿轮 →「运行设置」：

- 启用代理
- 设置 `HTTP_PROXY` / `HTTPS_PROXY`
- 设置 `NO_PROXY`（默认 `localhost,127.0.0.1,::1`）
- 可选自定义 CA 证书路径

代理会传给 opencode / Claude Code / Codex 子进程，不会改动系统环境。直连 API 使用 Node 原生 fetch，暂不读取应用内代理设置。代理密码会随 `data/config.json` 明文保存在本地，请勿把该文件提交到仓库或分享给他人。

### 运行限制

- **单次调用超时**：默认 15 分钟，可按 Agent 调用生效。
- **预算**：`budgetUsd` 是每个 Agent 在一次运行中的累计上限；opencode 和 Claude Code 会硬中止，Codex 和直连 API 只做记录。
- **轮次**：`maxTurns` 通过 harness 事件计数强制中止。
- `budgetUsd = 0` 表示不限制预算。

## 使用流程

1. 选择工作区。工作区里的文件会被 Agent 直接读写；外部引用只读挂载到 `.auto/refs`。
2. 在 Prompt 输入区写研究目标。
3. 选择「真实」或「Mock」。真实模式会先创建 git 工作区快照（如果可用）。
4. 启动研究，右侧查看调用链和 Boss 汇报。
5. 结束后在顶栏历史按钮中查看持久化报告、diff，必要时回滚工作区。
6. 下一轮可选择「续聊」复用 Boss 会话和项目记忆，或「新开」。

## 运行历史与工作区安全

### 历史

- 完成/失败/取消的运行都会写入 `data/runs/<runId>.json`。
- 默认最多保留 200 条，超出后按文件时间清理最旧记录。
- 历史记录包含报告、调用链、成本、状态和工作区快照引用。
- 历史弹窗支持「载入右侧」「查看改动」「回滚工作区」「删除记录」。

### 快照与回滚

真实模式启动前，如果工作区是 git 仓库且有提交：

1. 将当前工作区状态（含未跟踪文件）写入一个临时快照 commit；
2. 在 `refs/auto/checkpoints/<runId>` 下保存引用；
3. 运行结束后，用 `git diff <snapshot>` 展示本次运行产生的改动。

`git diff` 只覆盖已跟踪文件；运行期间新增的文件会在历史弹窗的 `git status` 区域列出。

回滚会把工作区恢复到运行前状态，并删除运行期间新增、且不在快照中的文件。**这是破坏性操作，执行前请确认。**

限制：

- 非 git 工作区不会创建快照。
- 快照创建是 best-effort，失败只会记录警告，不会阻止研究。
- 快照创建会短暂执行 `git add -A` 再 `git reset`，因此预先暂存的文件会变为未暂存状态。

## 子代理会话

- Boss 会话持久化在 `data/state.json`，支持跨运行续聊；直连 API 的对话记录在 `data/api-sessions/`。
- 子代理默认使用各自的临时会话：opencode 完成后 `opencode session delete`，Claude Code 使用 `--no-session-persistence`，Codex 使用 `--ephemeral`，直连 API 不落盘。
- 可在设置页把「子代理会话」改为「保留会话」用于排查问题。
- 历史遗留的 opencode 子代理会话不会自动清理；可用 `opencode session list` 查看，`opencode session delete <id>` 手动删除。

## API 速览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康检查 |
| `GET` | `/api/config` | Agent 与设置 |
| `PUT` | `/api/settings` | 更新网络/运行设置 |
| `POST` | `/api/settings/test-model` | 测试模型连通性 |
| `GET` | `/api/workspace` | 当前工作区与 Boss 线程 |
| `POST` | `/api/workspace/open` | 打开工作区 |
| `GET` | `/api/workspace/files` | 工作区文件 |
| `GET` | `/api/workspace/references` | 外部引用 |
| `POST` | `/api/runs` | 启动运行 |
| `GET` | `/api/runs` | 运行历史列表 |
| `GET` | `/api/runs/:id` | 运行详情 |
| `DELETE` | `/api/runs/:id` | 删除历史记录 |
| `GET` | `/api/runs/:id/events` | SSE 事件流 |
| `POST` | `/api/runs/:id/cancel` | 取消运行 |
| `GET` | `/api/runs/:id/diff` | 相对快照的 diff |
| `POST` | `/api/runs/:id/rollback` | 回滚到运行前快照 |

## 开发

```bash
npm run dev        # server + web
npm run dev:server # 只启动 Fastify
npm run dev:web    # 只启动 Vite
npm run typecheck  # TypeScript 检查
npm run build      # typecheck + 生产构建
```

Vite 的 `/api` 代理固定指向 `127.0.0.1:8787`；如果改后端端口，需要同步修改 `vite.config.ts`。

## 安全与限制

- 本项目默认只监听 `127.0.0.1`，没有用户系统，适合本机单人使用。
- 真实模式会自动批准 CLI 的文件与命令操作，直连 API 也会执行内置文件和命令工具，Agent 可以修改工作区。请使用专用工作区，不要直接指向重要目录。
- `data/config.json` 中的 API Key、代理密码是明文；不要提交 `data/`。
- 快照和回滚只覆盖 git 工作区；非 git 工作区需要自行备份。
- 目前未接入 MCP 管理、多用户权限、任务队列和云端同步，这些属于后续功能。
