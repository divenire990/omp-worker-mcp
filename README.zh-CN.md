<div align="center">

# omp-worker-mcp

**用于将异步编码任务和 DAG 工作流委托给本地 Oh My Pi (OMP) CLI 子 Agent 执行的持久化模型上下文协议（MCP）服务器。**

<p align="center">
  <a href="README.md">English</a> •
  <a href="README.zh-CN.md">简体中文</a>
</p>

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](package.json)
[![MCP Protocol](https://img.shields.io/badge/MCP-1.30.0-orange.svg)](https://modelcontextprotocol.io/)

<br />

<img src="assets/orchestration.gif" alt="异步 DAG 编排流程" width="800" />

<p align="center">
  <em>异步任务执行、DAG 依赖解析、路径所有权隔离与结构化结果校验。</em>
</p>

[快速开始](#安装与快速开始) • [配置说明](#配置说明) • [可用工具](#可用-mcp-工具) • [安全与所有权约束](#任务安全与所有权约束) • [上游归属与免责声明](#上游归属与免责声明)

</div>

---

## 核心亮点

- ⚡ **异步委托执行**：将繁重的编码、重构与调研任务下发给后台 OMP Worker 实例，主对话会话无需等待或被阻塞。
- 🔀 **拓扑 DAG 编排**：执行相互依赖的批量任务，支持自动拓扑排序、并发控制与依赖上下文传递。
- 🛡️ **工作区路径隔离**：强制执行严格的写路径边界约束，防止并发任务之间发生文件写入冲突。
- 🔍 **持续监督与结构化信封**：支持实时查看运行日志、提取结构化 JSON 结果信封，并向任务注入监督指导以进行重试或调整。

---

## 上游归属与免责声明

- **外部上游 CLI**：本项目调用 [Oh My Pi (OMP)](https://github.com/can1357/oh-my-pi)，该上游开源工具基于 [MIT 许可证](https://github.com/can1357/oh-my-pi/blob/main/LICENSE) 发布。
- **非官方独立项目**：`omp-worker-mcp` 是一个由社区独立开发的 MCP 服务器，**并非** Oh My Pi 官方项目，亦未获得上游 OMP 维护者的关联或背书。
- **不打包 / 不分发**：本项目**绝不打包、捆绑、链接或分发 OMP CLI 的可执行二进制文件或源代码**。本项目仅通过进程调用 (`OMP_WORKER_OMP_COMMAND`) 执行用户环境中已自行安装的外部 OMP CLI。
- **用户前置要求**：
  - Node.js **>= 22.0.0**。
  - 用户需在本地自行安装并配置好 OMP CLI 运行环境。
  - 用户有责任遵守适用于其自身环境的 OMP CLI 许可证及使用条款。

---

## 功能特性

- **异步委托执行**：随时发起独立的子 Agent 编码任务，主会话保持流畅交互。
- **DAG 与批处理编排**：支持运行具有拓扑依赖关系的批量任务组，提供并发度限制与自动依赖传递。
- **严格的任务安全与所有权**：内置校验机制，防止多个并发任务写入相同路径或在同一工作区产生冲突。
- **持续监督与反馈机制**：实时检查中间输出、流式读取日志、解析结构化 JSON 结果，并在失败时注入指导进行纠错重试。
- **跨平台支持**：专为 Windows、macOS 和 Linux 本地 Node.js 环境设计；请确保当前平台已配置好 OMP CLI。

---

## 安装与快速开始

```bash
# 1. 克隆代码仓库
git clone https://github.com/divenire990/omp-worker-mcp.git
cd omp-worker-mcp

# 2. 安装依赖
npm ci

# 3. 编译 TypeScript 到 dist/
npm run build

# 4. 运行测试套件
npm test
```

---

## 配置说明

支持通过环境变量（或在 MCP 客户端配置中）进行灵活配置。

| 环境变量 | 说明 | 默认值 |
| :--- | :--- | :--- |
| `OMP_WORKER_OMP_COMMAND` | OMP CLI 二进制文件的路径或可执行文件名。 | `omp` |
| `OMP_WORKER_OMP_PREFIX_ARGS` | 每次调用 OMP CLI 时前置添加的参数（JSON 数组格式）。 | `[]` |
| `OMP_WORKER_STATE_DIR` | 用于保存任务状态、尝试记录、日志与产物的目录路径。 | `~/.codex/state/omp-worker` |
| `OMP_WORKER_BROWSER_RULES` | 可选：注入到任务提示词中的自定义浏览器自动化指令。 | *(无)* |

### 跨平台环境变量设置示例

#### Windows (cmd / PowerShell)
```cmd
set OMP_WORKER_OMP_COMMAND=omp
set OMP_WORKER_STATE_DIR=C:\Users\YourUser\.codex\state\omp-worker
```

#### macOS / Linux (bash / zsh)
```bash
export OMP_WORKER_OMP_COMMAND=/usr/local/bin/omp
export OMP_WORKER_STATE_DIR=/home/youruser/.codex/state/omp-worker
```

---

## Codex MCP 客户端配置示例

将本服务添加到 Codex 的 MCP 配置文件中（例如 `config.toml`）：

### Windows 配置示例
```toml
[mcp_servers.omp-worker]
command = "node"
args = ["C:/path/to/omp-worker-mcp/dist/index.js"]

[mcp_servers.omp-worker.env]
OMP_WORKER_OMP_COMMAND = "omp"
OMP_WORKER_STATE_DIR = "C:/Users/YourUser/.codex/state/omp-worker"
```

### macOS / Linux 配置示例
```toml
[mcp_servers.omp-worker]
command = "node"
args = ["/path/to/omp-worker-mcp/dist/index.js"]

[mcp_servers.omp-worker.env]
OMP_WORKER_OMP_COMMAND = "/usr/local/bin/omp"
OMP_WORKER_STATE_DIR = "/home/youruser/.codex/state/omp-worker"
```

---

## 可用 MCP 工具

| 工具名称 | 用途 |
| :--- | :--- |
| `omp_run_compact` | 便捷工具：委托单个任务并在单轮对话中等待最多 `wait_seconds` 秒以获取结果。 |
| `omp_delegate` | 异步创建后台 Worker 执行编码任务，并立即返回 `job_id`。 |
| `omp_wait` | 等待正在运行的后台任务执行完成，或轮询直至超时。 |
| `omp_result` | 获取任务的完整尝试历史、执行日志、产物输出及解析后的结构化结果信封。 |
| `omp_continue` | 向失败或阻塞的任务注入监督修正/补充指导，发起新的执行尝试。 |
| `omp_cancel` | 优雅终止正在运行的任务及其子进程树。 |
| `omp_run_batch_compact` | 创建具有依赖关系图（DAG）的并行/串行批量任务组，并等待全部完成。 |
| `omp_wait_group` | 等待异步批量任务组的执行推进或全部完成。 |
| `omp_cancel_group` | 取消批量任务组中所有正在运行及处于等待队列中的任务。 |

---

## 任务安全与所有权约束

1. **写入与只读隔离**：
   - `write` 任务必须明确声明其拥有所有权的文件写入路径。
   - `read_only` 任务被严格限制，禁止对工作区进行任何修改。
2. **DAG 冲突与重叠校验**：
   - 并行运行的任务之间不得声明相互重叠的写入路径边界。
   - 需要修改相同路径的任务必须显式声明线性的 DAG 依赖关系（`depends_on`）。
3. **结构化校验约定**：
   - 每个执行完成的子任务均需返回结构化的验证详情与已变更的产物描述。

---

## 许可证

本项目基于 [MIT 许可证](LICENSE) 开源。
