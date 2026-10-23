# 参与贡献 omp-worker-mcp

[English](CONTRIBUTING.md) · 简体中文

感谢你愿意帮忙！Bug 报告、实测过的客户端配置、Linux 验证以及聚焦的 PR 都非常欢迎。

## 可以怎么帮忙

- **报告 Bug**：提交 [Bug 报告](https://github.com/divenire990/omp-worker-mcp/issues/new?template=bug_report.yml)，附上版本号、操作系统、MCP 客户端和任务日志中的相关部分。
- **验证平台或客户端**：如果你在 Linux 上、或用我们只提供了文档的客户端（Claude Code、Cursor、VS Code、Windsurf、Continue）跑过，欢迎告诉我们哪些可行、哪些不行。
- **提功能建议**：提交 [功能请求](https://github.com/divenire990/omp-worker-mcp/issues/new?template=feature_request.yml)，说明你想支持的工作流。
- **安全问题**：请**不要**公开提 Issue，按 [SECURITY.md](SECURITY.md) 的方式私下报告。

## 开发环境

需要 Node.js ≥ 22 和 npm。跑测试**不需要**安装真实的 OMP——测试使用模拟的 OMP 程序（`tests/fake-omp.mjs`）。

```bash
git clone https://github.com/divenire990/omp-worker-mcp.git
cd omp-worker-mcp
npm ci
npm test            # 先运行 tsc，再运行 node --test tests/*.test.mjs
```

想在 MCP 客户端里试用本地构建，把客户端指向编译后的入口：

```json
{
  "mcpServers": {
    "omp-worker-dev": {
      "command": "node",
      "args": ["<仓库路径>/dist/index.js"],
      "env": { "OMP_WORKER_OMP_COMMAND": "omp" }
    }
  }
}
```

开发时建议把 `OMP_WORKER_STATE_DIR` 指向一个临时目录，避免测试任务和真实任务混在一起。

## 目录结构

| 路径 | 内容 |
| :--- | :--- |
| `src/index.ts` | MCP 服务器与工具定义 |
| `src/runner.ts` | 启动并监督单个 OMP 进程 |
| `src/group-orchestrator.ts`、`src/group-runner.ts` | 批量 / DAG 调度 |
| `src/job-store.ts` | 磁盘上的任务与任务组状态、清理策略 |
| `src/security.ts` | `OMP_WORKER_ALLOWED_ROOTS` 检查 |
| `src/protocol.ts` | Worker 提示词与 `OMP_WORKER_RESULT` 结果约定 |
| `tests/` | `node:test` 测试与模拟 OMP |
| `docs/`、`benchmarks/` | 文档（中英双语）与基准测试协议 |

## PR 要求

1. **保持聚焦**：一个 PR 只做一件事，审查起来容易得多。
2. **补充或更新测试**：行为变化需要测试覆盖，`npm test` 必须在 CI 的三个平台上都通过。
3. **尊重公共契约**：工具名、输入参数、返回结构、`OMP_WORKER_RESULT` 信封和磁盘目录结构由 [COMPATIBILITY.md](COMPATIBILITY.md) 定义。改动其中任何一项，请在 PR 中说明并附迁移说明。
4. **更新变更记录**：在 [CHANGELOG.md](CHANGELOG.md) 的 `## [Unreleased]` 下加一行。
5. **双语文档同步**：`docs/` 下的每篇文档和根目录 README 都有 `<page>.md` 与 `<page>.zh-CN.md` 两个版本。如果你只会写其中一种语言，在 PR 里说明即可，维护者会协助补齐。
6. **不要泄露隐私信息**：用 `<workspace_path>` 这类占位符；不要提交真实的家目录路径、API Key、Token 或你自己账号的基准测试数据。

## 提交信息

简短的祈使句标题最好，例如 `fix: reject empty ownership for write tasks` 或 `docs: add Linux setup notes`。欢迎使用 [Conventional Commits](https://www.conventionalcommits.org/) 前缀，但不强制。

## 许可证

提交贡献即表示你同意以 [MIT 许可证](LICENSE) 授权你的贡献。
