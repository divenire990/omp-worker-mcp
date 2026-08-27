<div align="center">

# 客户端接入与配置指南

**主流 MCP 主控 Harness 接入说明、本地 stdio 兼容性契约与经核验的配置模板。**

<p align="center">
  <a href="client-configurations.md">English</a> •
  简体中文 •
  <a href="README.zh-CN.md">文档索引</a>
</p>

</div>

---

## 1. 本地 stdio 兼容性契约

`omp-worker-mcp` 遵循 Model Context Protocol 标准规范，通过标准输入输出（stdio）进行通信。任何支持启动本地 stdio MCP 子进程的主控 Harness 均可接入本服务器，前提是满足以下三项核心前置条件：

1. **标准本地 stdio 传输**：主控 Harness 必须将 `omp-worker-mcp` 作为本地子进程启动，并通过标准输入输出（stdin/stdout）进行协议交互。
2. **本地 OMP CLI 可用性**：`omp` 二进制可执行文件（或通过 `OMP_WORKER_OMP_COMMAND` 自定义的命令路径）必须已安装且处于主控进程运行时的 `PATH` 环境变量中。
3. **运行时与工作区权限**：运行环境需提供 **Node.js >= 22.0.0**、本地可写的工作区目录以及完备的文件系统操作权限。

---

## 2. 证据分级兼容性矩阵

不同主控 Harness 的兼容性依据其实测与文档验证程度进行分级：

| 支持等级 | 宿主 / 客户端 | 支持状态与验证依据 | 说明与注意事项 |
| :--- | :--- | :--- | :--- |
| **作者实测** | **Codex** | 作者当前主力本机工作流 | 在作者日常开发环境中实测验证；不构成跨平台 CI 集成保证。 |
| **官方文档或可复制配置示例** | **Claude Code**、**WorkBuddy**、**Claude Desktop**、**Cursor**、**Cline**、**VS Code**、**GitHub Copilot CLI** | 源自官方公开文档或可直接复现的标准 JSON 配置形态 | *未在本仓库 CI 进行集成测试*。Claude Desktop 采用标准通用的 `mcpServers` JSON 结构。 |
| **云端 / 远程宿主** | Web 端或云端托管的 Agent 容器环境 | 有条件支持（取决于远程运行容器） | *不提供开箱即用保证*。要求远程环境需具备 Node.js >= 22、处于 PATH 的 OMP CLI、可写工作区及子进程启动权限。 |

---

## 3. 通用配置模板 (`mcpServers`)

对于采用标准 JSON 格式 `mcpServers` 的 MCP 客户端，可以以下配置作为基础起点：

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

*若使用本地源码构建，可将 `"command": "npx"` 与 `"args": ["-y", "omp-worker-mcp"]` 替换为 `"command": "node"` 与 `"args": ["<仓库路径>/dist/index.js"]`。*

---

## 4. 具体客户端配置示例

### Codex 配置示例 (`config.toml`)

在 Codex 的 `config.toml` 中添加如下配置段：

```toml
[mcp_servers.omp-worker]
command = "npx"
args = ["-y", "omp-worker-mcp"]

[mcp_servers.omp-worker.env]
OMP_WORKER_OMP_COMMAND = "omp"
```

*若使用本地源码构建，可将 `command` 改为 `"node"`，`args` 设为 `["<仓库路径>/dist/index.js"]`。*

---

### Claude Code 配置示例

使用官方 Claude Code CLI 命令注册 MCP 服务：

```bash
claude mcp add --transport stdio --env OMP_WORKER_OMP_COMMAND=omp omp-worker -- npx -y omp-worker-mcp
```

查看已注册的服务配置：

```bash
claude mcp get omp-worker
```

*关于 Claude Code 的 MCP 详细管理说明，请参阅 [Claude Code MCP 官方文档](https://code.claude.com/docs/en/mcp)。（注：此处仅为基于官方 CLI 语法的配置示例，未在本仓库 CI 中进行集成测试）。*

---

### WorkBuddy 配置示例

WorkBuddy 支持通过其图形界面的 Plugins/MCP 设置添加 stdio MCP，或在用户级（`~/.workbuddy/mcp.json`）或项目级（`<workspace>/.workbuddy/mcp.json`）配置文件中声明：

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

*更多信息请参阅 [WorkBuddy MCP 官方指南](https://staging.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/MCP-Guide)。（注：此处仅为基于公开文档提供的配置示例，未在本仓库 CI 中进行验证）。*

---

### Claude Desktop 配置示例 (`claude_desktop_config.json`)

在 `claude_desktop_config.json` 中添加服务定义：

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

*（注：作为标准通用的 `mcpServers` JSON 配置示例提供；本轮未对上游官方文档进行独立核验）。*

---

## 5. 官方 Harness 文档参考

有关各主流客户端的高级功能或 MCP 配置更新，请参阅其官方文档：

- **Cursor**：[Cursor MCP 官方文档](https://prod.cursor.com/docs/mcp)
- **VS Code**：[Visual Studio Code MCP 配置参考](https://code.visualstudio.com/docs/agents/reference/mcp-configuration)
- **GitHub Copilot CLI**：[GitHub Copilot CLI MCP 配置指南](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers)
- **Cline**：[Cline MCP 官方文档](https://docs.cline.bot/mcp-servers/overview)
