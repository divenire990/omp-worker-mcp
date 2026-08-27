<div align="center">

# omp-worker-mcp

**用于将异步编码任务和 DAG 工作流委托给本地 Oh My Pi (OMP) CLI 子 Agent 执行的持久化模型上下文协议（MCP）服务器。**

<p align="center">
  <a href="README.md">English</a> •
  简体中文 •
  <a href="docs/README.zh-CN.md">文档中心</a>
</p>

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/omp-worker-mcp.svg)](https://www.npmjs.com/package/omp-worker-mcp)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](package.json)
[![CI](https://github.com/divenire990/omp-worker-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/divenire990/omp-worker-mcp/actions/workflows/ci.yml)
[![MCP Protocol](https://img.shields.io/badge/MCP-1.30.0-orange.svg)](https://modelcontextprotocol.io/)
[![M8ven Score](https://m8ven.ai/badge/mcp/divenire990-omp-worker-mcp-4fc9xm?v=4dd1b4cec6489cf043b8630c80138c73)](https://m8ven.ai/mcp/divenire990-omp-worker-mcp-4fc9xm)

<br />

<img src="assets/orchestration.gif" alt="异步 DAG 编排流程" width="800" />

<p align="center">
  <em>异步任务执行、DAG 依赖解析、路径所有权隔离与结构化结果校验。</em>
</p>

[快速开始](#安装与快速开始) • [最小配置](#最小-mcp-配置) • [工具概览](#可用-mcp-工具) • [安全约束](#任务安全与所有权约束) • [基准测试规范](benchmarks/README.zh-CN.md) • [平台支持](#平台支持与支持边界) • [文档中心](docs/README.zh-CN.md)

</div>

---

## 核心亮点

- ⚡ **异步委托执行**：将耗时的编码、重构与调研任务下发给后台 OMP Worker 实例，主对话会话无需等待阻塞。
- 🔀 **拓扑 DAG 编排**：执行相互依赖的批量任务，支持自动依赖解析、并发池调度与故障隔离。
- 🛡️ **工作区路径隔离**：强制执行严格的写路径边界约束，防止并发任务之间发生文件写入冲突。
- 🔍 **持续监督与结构化信封**：支持实时查看运行日志、提取结构化 JSON 结果信封（`OMP_WORKER_RESULT`），并通过 `omp_continue` 注入纠错指导。
- 💾 **持久化状态与生命周期管理**：基于磁盘文件的任务元数据与日志持久化，支持可配置的保留时间（TTL）与磁盘容量上限。


---

## 为什么采用此架构？

`omp-worker-mcp` 采用“主控监督与自治委派”模型：高级主控模型（如 Codex、Claude Code 等）专注于高层架构设计、任务拆解与质量把关，后台 `omp-worker-mcp` 实例则负责具体编码、重构与调研任务的自治执行。

> **待测经验假设**：将高耗时的具体执行任务委派给后台 Worker，使高级主控模型能够专注于架构设计与质量验收，有助于降低主会话上下文压力与交互疲劳，并在支持并发的批处理任务中提升吞吐效率。欢迎通过我们的公开 [基准测试评估规范](benchmarks/README.zh-CN.md) 开展实测检验。
---

## 平台支持与支持边界

- **外部上游引擎**：调用 [Oh My Pi (OMP)](https://github.com/can1357/oh-my-pi) CLI（基于 MIT 许可证）。上游二进制文件**不随本包分发**，需自行安装并置于 `PATH` 中。
- **运行环境要求**：Node.js **>= 22.0.0**（依赖原生 ECMAScript Modules 与标准库能力）。
- **操作系统支持**：
  - **Windows** (`win32`) 与 **macOS** (`darwin` / Apple Silicon)：经由真实 Node 22+ 与 OMP CLI E2E 完整验证支持。
  - **Linux** (`x86_64`, `aarch64`)：目前为架构设计目标，待在生产环境中进一步验证。
- **支持等级**：
  - **作者实测**：Codex（作者个人主力本机工作流实测；不构成跨平台 CI 集成保证）。
  - **官方文档或可复制配置**：Claude Code、WorkBuddy、Claude Desktop、Cursor、Cline、VS Code、GitHub Copilot CLI（*未在 CI 做集成测试*）。
  - **云端 / 远程宿主**：有条件支持（*需远程容器完整提供 Node.js >= 22、处于 PATH 的 OMP CLI、可写工作区及进程启动权限*）。

---

## 安装与快速开始

`omp-worker-mcp` 作为 MCP 服务器运行，由 stdio MCP 宿主（如 Codex、Claude Code 等）通过 `npx` 或全局安装命令调起，并非独立的交互式命令行工具。

### 宿主 Stdio 启动命令（推荐）

```bash
# 由 MCP 宿主配置（如 mcpServers）自动调起的启动命令
npx -y omp-worker-mcp
```
### 全局安装

```bash
# 通过 npm 全局安装
npm install -g omp-worker-mcp
```

### 从源码编译

```bash
git clone https://github.com/divenire990/omp-worker-mcp.git
cd omp-worker-mcp
npm ci
npm run build
npm test
```

---

## 最小 MCP 配置

在您的主控 Harness 的 `mcpServers` 配置中添加标准 stdio 服务定义：

```json
{
  "mcpServers": {
    "omp-worker": {
      "command": "npx",
      "args": ["-y", "omp-worker-mcp"],
      "env": {
        "OMP_WORKER_OMP_COMMAND": "omp"
      }
    }
  }
}
```

*关于 Codex (`config.toml`)、Claude Code CLI、WorkBuddy 及其他客户端的完整配置，请参阅 [客户端接入与配置指南](docs/client-configurations.zh-CN.md)。*

---

## 可用 MCP 工具

### 单任务委托工具

| 工具名称 | 用途 |
| :--- | :--- |
| `omp_run_compact` | **单任务推荐**：便捷工具，委托单个任务并在 `wait_seconds` 内等待结果，返回压缩摘要。 |
| `omp_delegate` | 底层分发：异步创建后台 Worker 执行编码任务，立即返回 `job_id`。 |
| `omp_wait` | 轮询或等待正在运行的后台任务直至终态或超时。 |
| `omp_result` | 获取任务的尝试历史、标准输出/错误日志、修改产物及结构化结果信封。 |
| `omp_continue` | 向失败或阻塞的任务注入监督指导，在同一会话中发起新一轮尝试。 |
| `omp_cancel` | 发送取消信号，优雅终止正在运行的任务及其子进程树。 |

### 批量任务与 DAG 编排工具

| 工具名称 | 用途 |
| :--- | :--- |
| `omp_run_batch_compact` | **多任务推荐**：创建具有依赖图（DAG）的批量任务组，控制并发度并等待全部完成返回汇总结果。 |
| `omp_wait_group` | 等待异步批量任务组的执行推进或全部完成。 |
| `omp_cancel_group` | 取消批量任务组中所有正在运行及等待队列中的任务。 |

*有关完整工具 Schema 与参数定义，请查阅 [工具参考与安全约束](docs/tool-reference.zh-CN.md)。*

---

## 任务安全与所有权约束

1. **写入与只读隔离**：`write` 任务必须通过 `ownership` 明确声明拥有所有权的文件路径；`read_only` 任务被严格禁止修改任何工作区文件。
2. **DAG 冲突与重叠校验**：同一组内并行运行的任务之间不得声明重叠的写入路径；操作相同路径的任务必须通过 `depends_on` 声明串行先后关系。
3. **结构化校验信封约定**：所有子任务均需在最终输出中遵循 `OMP_WORKER_RESULT` 格式返回结构化结果（状态、总结、产物列表、测试验证、遗留项）。

*高影响操作（如 `npm publish`、`git push`、生产部署、修改生产机密）必须始终保留在主控 Harness 与人类用户的直接交互中由人类确认。*

---

## 文档中心导航

更深入的技术指南与运维参考已系统整理至 [`docs/`](docs/README.zh-CN.md) 目录：

- [**文档中心首页**](docs/README.zh-CN.md)：文档结构布局与职责划分说明。
- [**作者工作流与架构设计**](docs/author-workflow.zh-CN.md)：主控与 Worker 监督闭环、执行策略矩阵与工作流撰写准则。
- [**客户端接入与配置指南**](docs/client-configurations.zh-CN.md)：涵盖 Codex（作者实测）及 Claude Code、WorkBuddy、Cursor、VS Code 等客户端的配置指南与可复现示例。
- [**运维配置与状态生命周期**](docs/operations.zh-CN.md)：环境变量完整表、磁盘状态布局、保留清理策略与重启恢复。
- [**工具参考与安全约束**](docs/tool-reference.zh-CN.md)：全部 MCP 工具定义、参数规范与安全边界。
- [**基准测试评估规范**](benchmarks/README.zh-CN.md)：对比主控直接执行与主控-Worker 委派编排的可复现评测协议。

---

## 兼容性政策与变更记录

- **公共契约与升级保证**：请参阅 [COMPATIBILITY.md](COMPATIBILITY.md) 了解版本策略与契约定义。
- **发布记录**：请参阅 [CHANGELOG.md](CHANGELOG.md) 了解详细版本更新历史。

---

## 许可证

本项目基于 [MIT 许可证](LICENSE) 开源。
