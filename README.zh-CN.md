<div align="center">

# omp-worker-mcp

**用于将后台编码任务和 DAG 工作流委托给本地 Oh My Pi (OMP) CLI 子 Agent 执行的持久化模型上下文协议（MCP）服务器。**

<p align="center">
  <a href="README.md">English</a> •
  简体中文 •
  <a href="docs/README.zh-CN.md">文档中心</a>
</p>

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/omp-worker-mcp.svg)](https://www.npmjs.com/package/omp-worker-mcp)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](package.json)
[![CI](https://github.com/divenire990/omp-worker-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/divenire990/omp-worker-mcp/actions/workflows/ci.yml)

<br />

<img src="assets/orchestration.gif" alt="异步 DAG 编排流程" width="800" />

<p align="center">
  <em>异步任务执行、DAG 依赖解析、路径所有权隔离与结构化结果校验。</em>
</p>

[快速开始](#安装与快速开始) • [最小配置](#最小-mcp-配置) • [推荐入口](#推荐接入入口) • [安全约束](#任务安全与所有权约束) • [平台支持](#平台支持与支持边界) • [文档中心](docs/README.zh-CN.md)

</div>

---

## 核心价值与运行模式

`omp-worker-mcp` 围绕以结果为导向的 **主控-工作者（Supervisor-Worker）** 模式构建，将高层决策与具体实现清晰解耦：

- **主智能体保持完全把控**：主会话 Harness（如 Codex、Claude Code）专注于高层架构设计、任务分解、权衡决策与最终验收审查。
- **持久化本地后台执行**：具体、耗时的编码、重构与调研任务委派给后台运行的本地 OMP Worker 实例，主对话无需等待阻塞。
- **拓扑 DAG 工作流编排**：相互独立的子任务可通过有向无环图（DAG）形式并行或按序调度，具备自动依赖追踪、并发池控制与故障隔离能力。
- **显式路径所有权边界**：写任务必须显式声明其拥有写入权限的路径边界；服务端在批量 DAG 中校验并拒绝并发重叠的写入范围，并将声明的边界作为约束提供给 Worker，以避免并行写冲突。
- **结构化结果与监督断点续跑**：Worker 遵循 `OMP_WORKER_RESULT` 信封返回结构化结果（状态、摘要、产物列表、验证检查与遗留项）。若任务失败或阻塞，主智能体可实时审查日志并通过 `omp_continue` 在同一会话中注入纠错提示发起重试。

---

## 安装与快速开始

### 1. 安装 OMP
前往 [Oh My Pi (OMP) 官方项目](https://github.com/can1357/oh-my-pi) 安装 OMP（要求 Node.js `>= 22.0.0`）。

### 2. 验证 OMP 可用性
在终端中运行以下命令，验证 OMP CLI 是否可用：

```bash
omp --version
```

*排错提示：如果 `omp` 不在系统 `PATH` 中，请在 MCP 配置中将 `OMP_WORKER_OMP_COMMAND` 环境变量设置为其可执行文件的绝对路径。*

### 3. 配置宿主并重启
在主控 Harness 的 stdio `mcpServers` 配置中添加 `omp-worker-mcp`（推荐使用 `npx`），然后重启宿主 Harness：

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

### 4. 执行安全的首次任务
在主控 Harness 中调用 `omp_run_compact`，传入工作区的绝对路径，执行一次只读的仓库检查以验证端到端委托链路：

```json
{
  "cwd": "/absolute/path/to/workspace",
  "goal": "检查仓库目录结构、校验依赖并报告顶层目录，不得修改任何文件。"
}
```

---

### 其他安装方式（可选）

#### 全局安装（可选）

```bash
npm install -g omp-worker-mcp
```

#### 从源码编译

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

*关于 Codex (`config.toml`)、Claude Code CLI、WorkBuddy、Cursor、VS Code 及其他客户端的完整配置，请参阅 [客户端接入与配置指南](docs/client-configurations.zh-CN.md)。*

---

## 推荐接入入口

根据任务复杂度选择合适的操作入口：

- **`omp_run_compact`（单任务推荐）**：便捷入口，委托单个编码或调研任务并在 `wait_seconds` 内等待执行完成，返回压缩摘要与产物列表。
- **`omp_run_batch_compact`（多任务与 DAG 推荐）**：批量与工作流推荐入口，创建并调度具有依赖关系的有向无环图批量任务，控制并发度并等待全部完成返回汇总结果。

*有关底层原子工具（`omp_delegate`、`omp_wait`、`omp_result`、`omp_continue`、`omp_cancel`、`omp_wait_group`、`omp_cancel_group`）与完整参数规范，请查阅 [工具参考与安全约束](docs/tool-reference.zh-CN.md)。*

---

## 任务安全与所有权约束

1. **声明式写入所有权**：`write` 任务必须通过 `ownership` 明确声明写入文件路径，`read_only` 任务不声明写入范围；服务端将所声明的边界作为约束提供给 Worker。
2. **DAG 冲突与重叠校验**：服务端在批量任务组中校验并拒绝并发重叠的写入范围；操作相同路径的任务必须通过 `depends_on` 声明串行先后关系。
3. **结构化校验信封约定**：所有子任务均需在最终输出中遵循 `OMP_WORKER_RESULT` 格式返回结构化结果（状态、总结、产物列表、测试验证、遗留项）。

*高影响操作（如 `npm publish`、`git push`、生产部署、修改生产机密）必须始终保留在主控 Harness 与人类用户的直接交互中由人类确认。*

---

## 平台支持与支持边界

- **外部上游引擎**：调用 [Oh My Pi (OMP)](https://github.com/can1357/oh-my-pi) CLI（基于 MIT 许可证）。上游二进制文件**不随本包分发**，需自行安装并置于 `PATH` 中。
- **运行环境要求**：Node.js **>= 22.0.0**（依赖原生 ECMAScript Modules 与现代 Node.js 标准库能力）。
- **操作系统支持**：
  - **Windows** 与 **macOS（Apple Silicon）**：已通过 Node.js 22+ 与真实 OMP CLI 端到端测试验证。
  - **Linux**：架构已支持，仍待更广泛的生产环境验证。
- **支持等级**：
  - **作者实测**：Codex（作者个人主力本机工作流实测；不构成跨平台 CI 集成保证）。
  - **官方文档或可复制配置**：Claude Code、WorkBuddy、Claude Desktop、Cursor、Cline、VS Code、GitHub Copilot CLI（*未在 CI 做集成测试*）。
  - **云端 / 远程宿主**：有条件支持（*需远程容器完整提供 Node.js >= 22、处于 PATH 的 OMP CLI、可写工作区及进程启动权限*）。

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
