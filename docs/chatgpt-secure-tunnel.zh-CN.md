<div align="center">

# ChatGPT 网页端通过 Secure MCP Tunnel 调用本地 OMP

**将 ChatGPT 作为 Supervisor，将本机 `omp-worker-mcp` + OMP 作为受控执行 Worker。**

<p align="center">
  <a href="chatgpt-secure-tunnel.md">English</a> •
  简体中文 •
  <a href="README.zh-CN.md">文档索引</a>
</p>

</div>

---

## 1. 架构

```text
ChatGPT Web
    |
    | Custom MCP / Secure MCP Tunnel
    v
OpenAI tunnel service
    |
    | outbound HTTPS only
    v
local tunnel-client
    |
    | stdio MCP
    v
omp-worker-mcp
    |
    v
local OMP workers
    |
    v
approved local workspaces
```

`tunnel-client` 官方支持通过 `--mcp-command` / `--mcp.command` 启动本地 stdio MCP 子进程，因此无需把 `omp-worker-mcp` 改造成 HTTP 服务，也无需对公网开放本机端口。

---

## 2. 版本边界与远程接入前的安全配置

> **重要提示——未发布的 `master` 源码（通过 commit SHA 标识）vs. 已发布的 npm `0.1.1`：**
> `OMP_WORKER_ALLOWED_ROOTS` 位于尚未发布至 npm 的 `master` 源码中（请通过 commit SHA 标识源码版本，其 `package.json` 与 CLI 仍显示 `0.1.1`）；已发布的 npm `0.1.1` 早于该特性。当 npm 最新版本仍为 `0.1.1` 时，直接运行 `npx -y omp-worker-mcp` **不会**执行 `OMP_WORKER_ALLOWED_ROOTS` 目录白名单检查。
>
> 通过 Tunnel 远程暴露 `omp-worker-mcp` 时，请从 `master` 源码构建：
> ```bash
> git clone https://github.com/divenire990/omp-worker-mcp.git
> cd omp-worker-mcp
> npm ci
> npm run build
> ```
> 然后在下文配置中将 `--mcp-command` 指向 `node <仓库绝对路径>/dist/index.js`。（待包含该提交的版本发布至 npm 后，即可直接使用 `"npx -y omp-worker-mcp"`。）

远程接入时务必设置 `OMP_WORKER_ALLOWED_ROOTS`。它是一个非空 JSON 数组，元素必须是绝对目录路径：

### Windows PowerShell

```powershell
$env:OMP_WORKER_OMP_COMMAND = "omp"
$env:OMP_WORKER_ALLOWED_ROOTS = '["D:\\Projects","D:\\Research"]'
```

### macOS / Linux

```bash
export OMP_WORKER_OMP_COMMAND=omp
export OMP_WORKER_ALLOWED_ROOTS='["/Users/alice/Projects","/Users/alice/Research"]'
```

在未发布的 `master` 源码构建中启用后，Worker 在真正启动 OMP 子进程前会：

1. 要求 `cwd` 为存在的绝对目录；
2. 对 `cwd` 和允许根目录执行 `realpath` 规范化；
3. 拒绝普通前缀伪装（例如允许 `/work/project` 时拒绝 `/work/project-evil`）；
4. 拒绝通过 symlink / junction 跳出允许根目录的路径；
5. 只有规范化后的工作目录位于某个允许根目录内部时才启动 OMP。

> `OMP_WORKER_ALLOWED_ROOTS` 是执行入口白名单，不是操作系统沙箱。OMP 及其子进程仍继承运行账户拥有的 OS 权限。对于高信任边界场景，应同时使用专用低权限账户、文件系统 ACL、容器或虚拟机隔离。

---

## 3. 前置条件与 OpenAI 权限要求

根据 OpenAI 官方 [Secure MCP Tunnels 指南](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) 与本地 `tunnel-client help quickstart`，您需要具备：

1. **组织与工作区访问权限**：您的 OpenAI 组织与 ChatGPT 工作区已开通 Secure MCP Tunnels 及自定义 MCP 连接器权限（`https://platform.openai.com/settings/organization/tunnels` 与 `https://chatgpt.com/#settings/Connectors`）。
2. **Tunnel ID（`CONTROL_PLANE_TUNNEL_ID`）**：在 Tunnels 管理页面创建，或使用 `tunnel-client admin tunnels create` 创建（需要具备 **Tunnels Read + Manage** 权限的 `OPENAI_ADMIN_KEY`）。
3. **Runtime API Key（`CONTROL_PLANE_API_KEY`）**：由具备该 Tunnel 的 **Tunnels Read + Use** 权限的主体在 [Runtime API keys](https://platform.openai.com/settings/organization/api-keys) 中创建。**切勿**将 `OPENAI_ADMIN_KEY` 提供给长期运行的 tunnel 守护进程。

---

## 4. 将本地 stdio MCP 接入 Secure MCP Tunnel

请将 runtime key 保存在环境变量 `CONTROL_PLANE_API_KEY` 中，不要直接写入命令历史或配置文件。

### 标准 Profile 流程（`init` → `doctor` → `run`）

以下流程与 OpenAI 官方文档及 `tunnel-client help quickstart` 保持一致：

#### Windows PowerShell

```powershell
$env:CONTROL_PLANE_API_KEY = "<runtime-api-key>"

tunnel-client init `
  --sample sample_mcp_stdio_local `
  --profile omp-worker `
  --tunnel-id tunnel_0123456789abcdef0123456789abcdef `
  --mcp-command "node D:\path\to\omp-worker-mcp\dist\index.js"

tunnel-client doctor --profile omp-worker --explain
tunnel-client run --profile omp-worker
```

#### macOS / Linux

```bash
export CONTROL_PLANE_API_KEY='<runtime-api-key>'

tunnel-client init \
  --sample sample_mcp_stdio_local \
  --profile omp-worker \
  --tunnel-id tunnel_0123456789abcdef0123456789abcdef \
  --mcp-command "node /abs/path/to/omp-worker-mcp/dist/index.js"

tunnel-client doctor --profile omp-worker --explain
tunnel-client run --profile omp-worker
```

### 可选：受管本地 Runtime 监督模式（`runtimes connect`）

如果您希望由 `tunnel-client`（或 Codex）在后台托管本地 runtime 别名，而不是让 `tunnel-client run` 占据前台终端，也可以使用 CLI 内置的 `runtimes` 子命令：

```bash
tunnel-client runtimes connect \
  --alias omp-worker \
  --tunnel-id tunnel_0123456789abcdef0123456789abcdef \
  --runtime-api-key env:CONTROL_PLANE_API_KEY \
  --mcp-command "node /abs/path/to/omp-worker-mcp/dist/index.js"
```

`tunnel-client` 启动的 stdio 子进程会继承运行时环境，因此上一步设置的 `OMP_WORKER_OMP_COMMAND` 与 `OMP_WORKER_ALLOWED_ROOTS` 会自动传递给 `omp-worker-mcp` 及其派生的 runner。

---

## 5. 验证 runtime

连接完成后不要只看启动命令是否返回成功：

- **前台 `tunnel-client run` 模式**：检查本地运维端点（默认为 `http://127.0.0.1:8080/healthz`、`/readyz` 与 `/ui`，或运行 `tunnel-client health`）。
- **受管 `runtimes connect` 模式**：检查 runtime 状态：
  ```bash
  tunnel-client runtimes status omp-worker --json
  ```
  确认 `process_running`、`healthy` 与 `ready` 均为真。

在 ChatGPT 设置（`https://chatgpt.com/#settings/Connectors`）中创建或验证连接器时，以及每次从 ChatGPT 发起 MCP 调用期间，都必须保持 `tunnel-client` 处于运行状态。
---

## 6. ChatGPT 端的推荐工作模式

推荐把职责保持为：

```text
ChatGPT = Supervisor
- 理解需求
- 制定方案
- 拆分任务
- 设定验收条件
- 审查 OMP 返回结果

OMP = Worker
- 读取本地文件
- 修改代码/文档
- 执行 Shell / Python / Git
- 跑测试
- 返回结构化结果
```

单任务优先使用 `omp_run_compact`；可并行或有依赖关系的多任务使用 `omp_run_batch_compact`。需要针对同一执行上下文纠错时使用 `omp_continue`，不要无必要地重新创建新任务。

---

## 7. 建议的首次验证

先使用只读任务验证整个链路：

```text
请使用 omp-worker-mcp 检查 D:\Projects\example 的目录结构、依赖与 Git 状态，只读，不修改任何文件，并返回简要结论。
```

随后再验证允许范围外目录确实被拒绝。例如当只允许 `D:\Projects` 时，尝试以 `C:\Users` 作为 `cwd` 应在 OMP 子进程启动前失败，并在任务结果中记录 `outside OMP_WORKER_ALLOWED_ROOTS`。

---

## 8. 信任边界

Secure MCP Tunnel 解决的是网络可达性与传输问题，不会自动把本机执行环境变成沙箱。完整安全模型应同时包含：

1. ChatGPT / workspace 对 tunnel 的访问控制；
2. Secure MCP Tunnel 的 runtime key 与 tunnel 权限；
3. `OMP_WORKER_ALLOWED_ROOTS` 工作目录白名单；
4. OMP Worker 自身的任务 / ownership 约束；
5. 操作系统账户、ACL、容器或 VM 的最终权限边界。

对于 `git push`、发布、生产部署、密钥修改等高影响操作，仍应要求人类显式确认。
