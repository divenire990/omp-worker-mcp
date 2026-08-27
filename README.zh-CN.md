<div align="center">

# omp-worker-mcp

**用于将异步编码任务和 DAG 工作流委托给本地 Oh My Pi (OMP) CLI 子 Agent 执行的持久化模型上下文协议（MCP）服务器。**

<p align="center">
  <a href="README.md">English</a> •
  <a href="README.zh-CN.md">简体中文</a>
</p>

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](package.json)
[![CI](https://github.com/divenire990/omp-worker-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/divenire990/omp-worker-mcp/actions/workflows/ci.yml)
[![MCP Protocol](https://img.shields.io/badge/MCP-1.30.0-orange.svg)](https://modelcontextprotocol.io/)

<br />

<img src="assets/orchestration.gif" alt="异步 DAG 编排流程" width="800" />

<p align="center">
  <em>异步任务执行、DAG 依赖解析、路径所有权隔离与结构化结果校验。</em>
</p>

[快速开始](#安装与快速开始) • [作者实测体验](#作者实测体验) • [MCP 客户端配置](#mcp-客户端配置) • [配置说明](#配置说明与环境变量) • [状态生命周期](#状态生命周期保留策略与重启恢复) • [可用工具](#可用-mcp-工具) • [安全与所有权约束](#任务安全与所有权约束) • [兼容性政策](#兼容性政策与变更记录) • [上游归属与支持边界](#上游归属与支持边界)

</div>

---

## 核心亮点

- ⚡ **异步委托执行**：将繁重的编码、重构与调研任务下发给后台 OMP Worker 实例，主对话会话无需等待或被阻塞。
- 🔀 **拓扑 DAG 编排**：执行相互依赖的批量任务，支持自动拓扑排序、并发控制与依赖上下文传递。
- 🛡️ **工作区路径隔离**：强制执行严格的写路径边界约束，防止并发任务之间发生文件写入冲突。
- 🔍 **持续监督与结构化信封**：支持实时查看运行日志、提取结构化 JSON 结果信封（`OMP_WORKER_RESULT`），并向任务注入监督指导以进行重试或纠错。
- 💾 **持久化状态与可配置生命周期**：基于磁盘文件的任务元数据与日志持久化，支持可配置的保留时间（TTL）与磁盘容量上限。

---

## 作者实测体验

在作者个人的日常本地工作流中，`omp-worker-mcp` 配置了 **Gemini 3.7 Flash** 作为后台 OMP Worker 的底层运行模型。在作者个人的 Antigravity 账户与配额环境中（配额相对充裕），该配置在多步骤编码、技术调研以及批量任务编排等场景下，主观体验上响应迅速且执行稳定可靠。

> **免责声明与使用边界**：
> 本节仅代表作者个人的实际工作流配置与主观使用体验，**不构成**任何独立的性能基准测试、质量保证或服务承诺。模型的可用性、响应速度、可用配额以及实际任务生成效果会因账户类型、所在地区、模型版本迭代、任务规模及本地运行环境的不同而存在差异。本项目未获得 Google Gemini 或 Antigravity 的任何官方背书或赞助。

---

## 上游归属与支持边界

- **外部上游 CLI**：本项目调用 [Oh My Pi (OMP)](https://github.com/can1357/oh-my-pi)，该上游开源工具基于 [MIT 许可证](https://github.com/can1357/oh-my-pi/blob/main/LICENSE) 发布。
- **分发边界**：上游 OMP CLI 二进制文件**不随本 npm 包打包分发**。用户需在本地自行安装并配置好 OMP CLI 运行环境。
- **运行环境要求**：
  - Node.js **>= 22.0.0**（依赖原生 ECMAScript Modules 与标准库能力）。
  - 用户有责任遵守适用于其自身环境的 OMP CLI 许可证及使用条款。
- **平台支持**：
  - **Windows** (win32) 与 **macOS** (Darwin / Apple Silicon，经由真实 Node 22+ 与 OMP CLI E2E 完整验证) 均已验证支持。
  - **Linux** (x86_64, aarch64) 目前为架构设计目标，待在生产环境中进一步验证。
---

## 功能特性

- **异步委托执行**：随时发起独立的后台子 Agent 编码任务，主会话保持流畅交互。
- **DAG 与批处理编排**：支持运行具有拓扑依赖关系的批量任务组，提供并发度限制、自动依赖传递与故障隔离。
- **严格的任务安全与所有权**：内置校验机制，防止多个并发任务在同一工作区写入重叠路径。
- **持续监督与反馈机制**：实时流式读取日志、解析结构化 JSON 结果信封，并在失败或阻塞时注入指导继续执行。
- **保守的状态持久化**：安全保存任务状态、提示词与日志，并支持可选的用户显式清理策略。

---

## 安装与快速开始

### 当前安装方式：源码编译与本地开发

在 npm 官方包正式发布上线之前，通过源码构建与运行是当前可用的使用路径：

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

### 发布后快速启动：通过 npx 或全局 npm 安装运行

一旦包正式发布至 npm 注册表，您即可无需克隆仓库直接运行 `omp-worker-mcp`：

```bash
# 直接通过 npx 启动（发布后可用）
npx omp-worker-mcp

# 或全局安装后运行（发布后可用）
npm install -g omp-worker-mcp
omp-worker-mcp --help
```

## MCP 客户端配置

`omp-worker-mcp` 通过标准输入输出（stdio）进行通信。以下是常用 MCP 客户端的配置示例。

### Codex 配置示例 (`config.toml`)

#### 使用本地源码构建运行（当前可用）
```toml
[mcp_servers.omp-worker]
command = "node"
args = ["/path/to/omp-worker-mcp/dist/index.js"]

[mcp_servers.omp-worker.env]
OMP_WORKER_OMP_COMMAND = "omp"
```

#### 使用 npx 运行（待发布至 npm 后可用）
```toml
[mcp_servers.omp-worker]
command = "npx"
args = ["-y", "omp-worker-mcp"]

[mcp_servers.omp-worker.env]
OMP_WORKER_OMP_COMMAND = "omp"
```

### Claude Desktop 配置示例 (`claude_desktop_config.json`)

#### 使用本地源码构建运行（当前可用）
```json
{
  "mcpServers": {
    "omp-worker": {
      "command": "node",
      "args": ["/path/to/omp-worker-mcp/dist/index.js"],
      "env": {
        "OMP_WORKER_OMP_COMMAND": "omp"
      }
    }
  }
}
```

#### 使用 npx 运行（待发布至 npm 后可用）
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

## 配置说明与环境变量

支持通过环境变量（或在 MCP 客户端配置中）进行灵活配置。

| 环境变量 | 说明 | 默认值 |
| :--- | :--- | :--- |
| `OMP_WORKER_OMP_COMMAND` | OMP CLI 二进制文件的路径或可执行文件名。 | `omp` |
| `OMP_WORKER_OMP_PREFIX_ARGS` | 每次调用 OMP CLI 时前置添加的参数（JSON 数组字符串，例如 `["--profile", "default"]`）。 | `[]` |
| `OMP_WORKER_STATE_DIR` | 用于保存任务状态、尝试记录、日志与产物的根目录路径。 | `~/.codex/state/omp-worker` |
| `OMP_WORKER_BROWSER_RULES` | 可选：注入到任务提示词中的自定义浏览器自动化指令。 | *(无)* |
| `OMP_WORKER_RETENTION_TTL_SECONDS` | 可选：终态任务/任务组的保留时间（秒）。未设置时不基于时间自动清理。 | *(无)* |
| `OMP_WORKER_RETENTION_MAX_BYTES` | 可选：状态目录允许占用的最大磁盘字节数。未设置时不基于容量上限自动清理。 | *(无)* |
| `OMP_WORKER_AUTO_CLEANUP_ON_START` | 可选：布尔值（`"true"` 或 `"1"`），在 MCP 服务器启动时自动执行一次清理。 | `false` |

---

## 状态生命周期、保留策略与重启恢复

### 磁盘目录结构

所有状态记录均存储在 `OMP_WORKER_STATE_DIR` 目录下（默认为 `~/.codex/state/omp-worker`）：
```text
~/.codex/state/omp-worker/
├── jobs/
│   └── job-<时间戳>-<哈希>/
│       ├── job.json              # 任务元数据、参数与当前状态
│       ├── cancel.request.json   # 取消信号文件（若已发起取消）
│       ├── attempt-01.prompt.md  # 第 1 次尝试生成的提示词
│       ├── stdout.log            # 任务执行标准输出
│       └── stderr.log            # 任务执行标准错误
└── groups/
    └── group-<时间戳>-<哈希>/
        ├── group.json            # 批量 DAG 任务组元数据、任务列表与状态
        └── cancel.request.json   # 任务组取消信号文件（若已发起取消）
```

### 保留与清理策略

- **默认保守保留**：默认情况下，`omp-worker-mcp` **绝不自动删除任何已完成或历史记录**，防止用户数据或日志意外丢失。
- **显式清理规则**：用户可通过配置 `OMP_WORKER_RETENTION_TTL_SECONDS`（清理超过指定秒数的终态记录）或 `OMP_WORKER_RETENTION_MAX_BYTES`（按时间由旧到新清理终态记录直至满足字节上限）启用自动清理。
- **运行中任务保护**：处于非终态（`dispatched`、`running`、`pending`、`validating`、`cancelling` 等）的任务与任务组**受到严格保护，绝不被清理**。
- **损坏记录安全保护**：无法确认其是否为终态的损坏文件不会被误删；状态目录中的符号链接将被拒绝且不会被递归跟随。
- **透明的故障可见性**：清理过程中的权限异常或读写错误会完整记录在错误输出中，不会被静默吞掉。

### 服务器重启与恢复机制

- **元数据持久化**：任务与批处理组的元数据均原子写入磁盘。在 MCP 服务器重启后，所有已分发与已完成的任务依然可以通过 `omp_result` 与 `omp_wait` 完整读取。
- **进程解耦**：若 MCP 服务器在外部任务运行期间意外退出，服务器不会在重启后对失控的孤儿进程进行静默接管，持久化的元数据与日志将忠实反映记录的状态。

---

## 可用 MCP 工具

### 单任务委托工具

| 工具名称 | 用途 |
| :--- | :--- |
| `omp_run_compact` | **单任务推荐**：便捷工具，委托单个任务并在单轮对话中等待最多 `wait_seconds` 秒以获取压缩结果。 |
| `omp_delegate` | 基础委托：异步创建后台 Worker 执行编码任务，并立即返回 `job_id`。 |
| `omp_wait` | 等待正在运行的后台任务执行完成，或轮询直至超时。 |
| `omp_result` | 获取任务的完整尝试历史、执行日志、产物输出及解析后的结构化结果信封。 |
| `omp_continue` | 向失败或阻塞的任务注入监督指导，在同一会话中发起新的执行尝试。 |
| `omp_cancel` | 优雅终止正在运行的任务及其子进程树。 |

### 批量任务与 DAG 编排工具

| 工具名称 | 用途 |
| :--- | :--- |
| `omp_run_batch_compact` | **多任务推荐**：创建具有依赖关系图（DAG）的并行/串行批量任务组，控制并发度并等待全部完成返回汇总结果。 |
| `omp_wait_group` | 等待异步批量任务组的执行推进或全部完成。 |
| `omp_cancel_group` | 取消批量任务组中所有正在运行及处于等待队列中的任务。 |

---

## 任务安全与所有权约束

1. **写入与只读隔离**：
   - `write` 任务必须通过 `ownership_paths` 明确声明其拥有所有权的文件写入路径。
   - `read_only` 任务被严格限制，禁止对工作区进行任何文件修改。
2. **DAG 冲突与重叠校验**：
   - 同一组内并行运行的任务之间不得声明相互重叠的写入路径边界。
   - 需要修改相同路径的任务必须显式声明线性的 DAG 依赖关系（`depends_on`）。
3. **结构化校验信封约定**：
   - 每个执行完成的子任务均需遵循 `OMP_WORKER_RESULT` 格式返回结构化结果（包含 `status`, `summary`, `artifacts`, `verification`, `remaining`）。

---

## 兼容性政策与变更记录

- **升级与版本政策**：请参阅 [COMPATIBILITY.md](./COMPATIBILITY.md) 了解公共契约定义、废弃过渡流程与版本兼容性保证。
- **变更日志**：请参阅 [CHANGELOG.md](./CHANGELOG.md) 了解各版本的详细更新与修复记录。

---

## 许可证

本项目基于 [MIT 许可证](LICENSE) 开源。
