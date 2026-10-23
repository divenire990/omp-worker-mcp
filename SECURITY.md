# Security Policy

[简体中文](#安全策略中文)

## Supported versions

`omp-worker-mcp` is in the `0.x` series. Security fixes are made on the latest release only.

| Version | Supported |
| :--- | :--- |
| 0.2.x (latest) | ✅ |
| < 0.2.0 | ❌ |

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report privately through GitHub: go to the repository's **Security** tab → **Report a vulnerability** ([direct link](https://github.com/divenire990/omp-worker-mcp/security/advisories/new)). Please include:

- the affected version (`npx omp-worker-mcp --version`), OS and MCP client;
- a description of the issue and its impact;
- steps or a minimal configuration to reproduce it.
You can expect an acknowledgement within 7 days. Once a fix is available, it will be released and credited in the changelog unless you prefer to stay anonymous.

## Threat model in brief

What `omp-worker-mcp` is designed to enforce, and therefore what counts as a vulnerability:

- **Execution-root allowlist** — in `omp-worker-mcp >= 0.2.0` (npm `0.1.1` lacks this feature), with `OMP_WORKER_ALLOWED_ROOTS` set, no job may start with a `cwd` outside the approved roots (including via sibling prefixes, symlinks or junctions), and an invalid value must fail closed.
- **Batch validation** — cycles and overlapping parallel write ownership must be rejected before any worker is spawned.
- **State directory integrity** — symlinks inside the state directory must not be followed, and retention cleanup must never delete non-terminal records.

What is **out of scope** by design:

- `omp-worker-mcp` is not an OS sandbox. OMP and its child processes run with the permissions of the account that launched the server; `ownership` is a scheduling check and an instruction to the worker, not a filesystem lock.
- Behaviour of the OMP CLI itself, the model it uses, or the MCP client. Please report those upstream.
- Misconfiguration such as exposing the server remotely without `OMP_WORKER_ALLOWED_ROOTS`.

For remote setups (e.g. ChatGPT via Secure MCP Tunnel), see the trust boundary section of the [tunnel guide](docs/chatgpt-secure-tunnel.md#8-trust-boundary).

---

## 安全策略（中文）

`omp-worker-mcp` 目前处于 `0.x` 阶段，只对最新版本提供安全修复。

**报告漏洞：** 请**不要**公开提 Issue。在仓库的 **Security** 标签页点击 **Report a vulnerability**（[直达链接](https://github.com/divenire990/omp-worker-mcp/security/advisories/new)）私下提交，并附上受影响版本（`npx omp-worker-mcp --version`）、操作系统、MCP 客户端、问题描述与复现步骤。我们会在 7 天内确认收到。

**属于漏洞的情况：** 在支持 `OMP_WORKER_ALLOWED_ROOTS` 的版本（`>= 0.2.0`；历史版本 npm `0.1.1` 不具备该特性）中设置该变量后仍能在白名单外启动任务（包括同名前缀、符号链接、junction 绕过），或无效配置没有拒绝执行；批量任务中依赖成环或并行写入范围重叠却未被拒绝；状态目录中的符号链接被跟随，或清理时删除了未结束的任务记录。

**不在范围内的情况：** 本项目不是系统级沙箱，OMP 拥有启动服务器的账户的全部权限；OMP CLI、模型或 MCP 客户端自身的问题请向上游反馈；未设置 `OMP_WORKER_ALLOWED_ROOTS`（或使用早于 `0.2.0`、不具备该特性的 npm `0.1.1` 包）就对外暴露服务属于配置问题。远程使用的信任边界见 [Tunnel 指南](docs/chatgpt-secure-tunnel.zh-CN.md#8-信任边界)。
