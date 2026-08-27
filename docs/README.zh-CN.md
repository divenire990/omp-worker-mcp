<div align="center">

# omp-worker-mcp 文档中心

**`omp-worker-mcp` 完整架构指南、客户端配置、运维参考与 MCP 工具说明。**

<p align="center">
  <a href="README.md">English</a> •
  简体中文 •
  <a href="../README.zh-CN.md">返回根目录 README</a>
</p>

</div>

---

## 概述

欢迎查阅 `omp-worker-mcp` 官方文档中心。本目录包含有关 Agent 编排工作流、跨客户端本地 stdio 集成配置、状态生命周期运维管理以及完整 MCP 工具规格的深度技术指南。

如果您需要快速了解项目概况或获取快速起步指引，请访问根目录 [README.zh-CN.md](../README.zh-CN.md)。

---

## 文档结构与职责划分

为保持文档清晰精简并杜绝内容重复，各技术专题划分如下：

| 文档页面 | 主要职责与涵盖范围 | 核心主题 |
| :--- | :--- | :--- |
| [**作者工作流与架构设计**](author-workflow.zh-CN.md) | 架构模型、编排流程与工作流撰写准则。 | • 主控与 Worker 监督闭环（6 步生命周期）<br>• 执行策略对比矩阵（直接处理 vs. 单任务 vs. 批量 DAG）<br>• 跨场景自然语言委派示例<br>• 作者个人 Gemini / Antigravity 实测体验（明确为非保证参考）<br>• 发布与撰写工作流的安全准则 |
| [**客户端接入与配置指南**](client-configurations.zh-CN.md) | 各类 MCP 主控 Harness 的接入与配置说明。 | • 本地 stdio 兼容性前提条件<br>• 证据分级支持矩阵（实测验证 vs. 文档可复制 vs. 有条件支持）<br>• 通用 `mcpServers` JSON 配置模板<br>• 具体客户端配置（Codex、Claude Code、WorkBuddy、Claude Desktop）<br>• 官方文档参考链接（Cursor、VS Code、Copilot CLI、Cline） |
| [**运维配置与状态生命周期**](operations.zh-CN.md) | 运行时配置、持久化内部机制与日常运维管理。 | • 环境变量完整参考表<br>• 磁盘状态目录布局（`~/.codex/state/omp-worker`）<br>• 保留与清理策略（TTL 与磁盘容量阈值）<br>• 服务器重启、崩溃恢复与进程解耦 |
| [**工具参考与安全约束**](tool-reference.zh-CN.md) | 全部 MCP 工具的详细参数、规格与安全协议约定。 | • 单任务委托工具集（`omp_run_compact`、`omp_delegate` 等）<br>• 批量任务与 DAG 编排工具集（`omp_run_batch_compact` 等）<br>• 路径所有权隔离规则（`write` vs. `read_only`）<br>• 结构化结果信封约定（`OMP_WORKER_RESULT`） |

---

## 快速导航指引

- **初次了解 Agent 委托？** 请阅读 [作者工作流与架构设计](author-workflow.zh-CN.md)，快速掌握主控与 Worker 的协同模式。
- **需要配置您的 MCP 客户端？** 请查阅 [客户端接入与配置指南](client-configurations.zh-CN.md) 获取即用配置与模板。
- **管理生产或持续运行环境？** 请查阅 [运维配置与状态生命周期](operations.zh-CN.md) 了解保留清理与状态恢复。
- **编写 Prompt 或开发集成逻辑？** 请参考 [工具参考与安全约束](tool-reference.zh-CN.md) 查阅工具定义与结构化信封规范。

---

## 双语同步机制

本目录下的所有文档均严格采用中英文双语 1:1 同步维护：

- **英文版本**：`docs/<page>.md`
- **中文版本**：`docs/<page>.zh-CN.md`
