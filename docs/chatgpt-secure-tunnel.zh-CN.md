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

## 2. 远程接入前的安全配置

远程接入时强烈建议设置 `OMP_WORKER_ALLOWED_ROOTS`。它是一个非空 JSON 数组，元素必须是绝对目录路径：

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

启用后，Worker 在真正启动 OMP 子进程前会：

1. 要求 `cwd` 为存在的绝对目录；
2. 对 `cwd` 和允许根目录执行 `realpath` 规范化；
3. 拒绝普通前缀伪装（例如允许 `/work/project` 时拒绝 `/work/project-evil`）；
4. 拒绝通过 symlink / junction 跳出允许根目录的路径；
5. 只有规范化后的工作目录位于某个允许根目录内部时才启动 OMP。

> `OMP_WORKER_ALLOWED_ROOTS` 是执行入口白名单，不是操作系统沙箱。OMP 及其子进程仍继承运行账户拥有的 OS 权限。对于高信任边界场景，应同时使用专用低权限账户、文件系统 ACL、容器或虚拟机隔离。

---

## 3. 将本地 stdio MCP 接入 Secure MCP Tunnel

OpenAI `tunnel-client` 支持直接管理长期运行的本地 stdio MCP runtime。下面假设您已经拥有可用的 tunnel ID 和 runtime API key。

先把 runtime key 放在环境变量中，不要把密钥直接写入命令历史或配置文件：

```powershell
$env:TUNNEL_RUNTIME_KEY = "<runtime-api-key>"
```

然后连接本地 `omp-worker-mcp`：

```powershell
tunnel-client runtimes connect `
  --alias omp-worker `
  --tunnel-id tunnel_0123456789abcdef0123456789abcdef `
  --runtime-api-key env:TUNNEL_RUNTIME_KEY `
  --mcp-command "npx -y omp-worker-mcp"
```

macOS / Linux 对应命令：

```bash
export TUNNEL_RUNTIME_KEY='<runtime-api-key>'

tunnel-client runtimes connect \
  --alias omp-worker \
  --tunnel-id tunnel_0123456789abcdef0123456789abcdef \
  --runtime-api-key env:TUNNEL_RUNTIME_KEY \
  --mcp-command "npx -y omp-worker-mcp"
```

`tunnel-client` 启动的 stdio 子进程继承运行时环境，因此上一步设置的 `OMP_WORKER_OMP_COMMAND` 与 `OMP_WORKER_ALLOWED_ROOTS` 会传递给 `omp-worker-mcp` / OMP runner。

---

## 4. 验证 runtime

连接完成后不要只看启动命令是否返回成功，应检查 runtime 状态：

```bash
tunnel-client runtimes status omp-worker --json
```

确认至少满足：

- `process_running` 为真；
- runtime 健康状态正常；
- readiness 正常；
- ChatGPT 工作区已经获得对应 tunnel / MCP app 的使用权限。

如需排错，可使用：

```bash
tunnel-client runtimes status omp-worker
tunnel-client doctor --profile <profile> --explain
```

---

## 5. ChatGPT 端的推荐工作模式

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

## 6. 建议的首次验证

先使用只读任务验证整个链路：

```text
请使用 omp-worker-mcp 检查 D:\Projects\example 的目录结构、依赖与 Git 状态，只读，不修改任何文件，并返回简要结论。
```

随后再验证允许范围外目录确实被拒绝。例如当只允许 `D:\Projects` 时，尝试以 `C:\Users` 作为 `cwd` 应在 OMP 子进程启动前失败，并在任务结果中记录 `outside OMP_WORKER_ALLOWED_ROOTS`。

---

## 7. 信任边界

Secure MCP Tunnel 解决的是网络可达性与传输问题，不会自动把本机执行环境变成沙箱。完整安全模型应同时包含：

1. ChatGPT / workspace 对 tunnel 的访问控制；
2. Secure MCP Tunnel 的 runtime key 与 tunnel 权限；
3. `OMP_WORKER_ALLOWED_ROOTS` 工作目录白名单；
4. OMP Worker 自身的任务 / ownership 约束；
5. 操作系统账户、ACL、容器或 VM 的最终权限边界。

对于 `git push`、发布、生产部署、密钥修改等高影响操作，仍应要求人类显式确认。
