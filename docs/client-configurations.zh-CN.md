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
| **官方文档或可复制配置示例** | **Claude Code**、**Cursor**、**VS Code / GitHub Copilot**、**Windsurf Cascade**、**Continue** | 源自官方公开文档或可直接复现的标准 JSON / YAML 配置形态 | *未在本仓库 CI 进行集成测试*。反映官方公开规范与原生 stdio 子进程执行能力。 |
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

## 4. 具体客户端配置指南

### 4.1 Codex 配置

- **配置文件位置**：`~/.codex/config.toml`（Windows 路径为 `C:\Users\<username>\.codex\config.toml`）。
- **官方文档参考**：Codex 专属工作流与命名空间配置已在仓库内部文档中详细说明（见下文）。

#### 最小配置示例

在 Codex 的 `config.toml` 中添加如下配置段：

```toml
[mcp_servers.omp-worker]
command = "npx"
args = ["-y", "omp-worker-mcp"]

[mcp_servers.omp-worker.env]
OMP_WORKER_OMP_COMMAND = "omp"
```

*若使用本地源码构建，可将 `command` 改为 `"node"`，`args` 设为 `["<仓库路径>/dist/index.js"]`。*

#### 直接命名空间访问与模型选择边界

在 Codex 中，注册 MCP 服务使服务端进程连通，但直接工具命名空间访问由 `~/.codex/config.toml` 中的 `direct_only_tool_namespaces` 控制。将 `"mcp__omp_worker"` 加入该列表可使 Codex 会话无障碍地直接调用相关工具。

> **重要提示**：`direct_only_tool_namespaces` 属于 Codex 专有机制，其他任何宿主 Harness 都不使用、不支持也不需要此项设置。请直接参阅 [作者工作流指南：Codex 专属直接命名空间配置](author-workflow.zh-CN.md#codex-专属直接命名空间配置)。

- **激活与验证**：保存 `config.toml` 并重启 Codex。您可运行 [一次性验证提示词](author-workflow.zh-CN.md#一次性验证提示词) 确认连通状态。
- **选择策略边界**：注册服务仅将工具暴露给 Codex，并不保证模型会在每次交互中自动选择该工具。请通过项目级 `AGENTS.md` 策略文件指导任务委派。

---

### 4.2 Claude Code 配置

- **配置文件位置**：通过官方 CLI 注册管理（支持 user 或 project 作用域），或直接在项目根目录的 `.mcp.json` 中声明。
- **官方文档**：[Claude Code MCP 官方文档](https://code.claude.com/docs/en/mcp)。

#### 最小注册方法（官方 CLI 命令）

在用户全局环境注册 `omp-worker-mcp`（`--scope user`）：

```bash
claude mcp add omp-worker --scope user --env OMP_WORKER_OMP_COMMAND=omp -- npx -y omp-worker-mcp
```

若需仅在当前项目工作区注册（`--scope project`）：

```bash
claude mcp add omp-worker --scope project --env OMP_WORKER_OMP_COMMAND=omp -- npx -y omp-worker-mcp
```

*(在 Windows 原生 `cmd.exe` 环境下，若 `npx` 路径解析异常，可添加命令前缀 `cmd /c npx`)*。

#### 替代方案：直接编辑项目配置文件 (`.mcp.json`)

亦可在项目根目录的 `.mcp.json` 中直接声明：

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

#### 激活、审批与使用行为

- **激活与检查**：使用 `claude mcp get omp-worker` 查看已注册服务，或通过 `claude mcp list` 列出全部服务。启动 Claude Code 会话时会自动加载。
- **审批与工具启用**：Claude Code 会根据自身的安全与权限策略在调用外部工具前向用户提示确认（Approval）。
- **选择策略边界**：注册服务使工具可用，但并不保证模型会自动调用。请在工作区根目录的 `CLAUDE.md` 中配置委派策略，引导 Claude Code 何时分发给后台 Worker。

---

### 4.3 Cursor 配置

- **配置文件位置**：项目级 `<workspace>/.cursor/mcp.json` 或全局用户配置 `~/.cursor/mcp.json`（亦可在界面中打开：`Cursor Settings` > `Features` > `MCP`）。
- **官方文档**：[Cursor MCP 官方文档](https://docs.cursor.com/context/model-context-protocol)。

#### 最小配置示例 (`.cursor/mcp.json`)

在项目根目录下创建或编辑 `.cursor/mcp.json`：

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

#### 激活、工具开关与使用行为

- **激活与检查**：前往 `Cursor Settings` > `Features` > `MCP`，点击 `omp-worker` 旁边的刷新按钮（或重启 Cursor）。绿色的状态指示灯即表示 stdio 进程已正常连接，并列出可用工具（如 `omp_run_compact`）。
- **工具开关与 Auto-Run**：在 Cursor Composer / Agent 模式下，已注册的 MCP 工具会显示在工具面板中。您可以单独开启/关闭（toggle）具体工具，并配置单工具的 Auto-Run 自动执行权限。
- **选择策略边界**：工具启用不代表模型会自动发起委托。建议在 `.cursorrules` 或项目说明中配置明确的任务委派启发规则。

---

### 4.4 VS Code 与 GitHub Copilot / Agent Host 配置

- **配置文件位置**：
  - 工作区级：`<workspace>/.vscode/mcp.json` 或标准工作区 `.mcp.json`。
  - 用户级 / Agent Host 便捷路径：VS Code 用户配置文件 `mcp.json` 或 `~/.copilot/mcp-config.json`。
- **官方文档**：[VS Code MCP 官方文档](https://code.visualstudio.com/docs/agent-customization/mcp-servers) 与 [GitHub Copilot MCP 官方文档](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers)。

#### 最小配置示例 (`.vscode/mcp.json`)

在工作区的 `.vscode/mcp.json` 中添加服务声明：

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

#### 激活、启用状态与使用行为

- **激活与检查**：保存配置文件后，在 VS Code 中通过命令面板执行 `Developer: Reload Window` 重载窗口，或在聊天面板（Chat / Agent 模式）的 MCP 服务器视图中确认 `omp-worker` 处于活动状态并已加载工具。
- **服务器启用状态与确认提示**：VS Code 与 Copilot 支持对 MCP 服务器进行整体启用/禁用（Enable/Disable）。当 Copilot Agent 调用 MCP 工具时，会依据工作区信任及权限设置向用户展示确认提示。
- **选择策略边界**：注册仅提供工具能力，模型是否选用取决于上下文。请在 `.github/copilot-instructions.md` 中编写明确的委派规则。

---

### 4.5 Windsurf Cascade 配置

- **配置文件位置**：全局配置文件 `~/.codeium/windsurf/mcp_config.json`（或通过图形界面：`Windsurf Settings` > `Cascade` > `MCP Servers` 进行添加）。
- **官方文档**：[Windsurf MCP 官方文档](https://docs.windsurf.com/windsurf/cascade/mcp)。

#### 最小配置示例 (`mcp_config.json`)

在 `~/.codeium/windsurf/mcp_config.json` 中声明 `omp-worker`：

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

#### 激活、单工具开关与使用行为

- **激活与检查**：在 Windsurf 中打开 Cascade 设置或 MCP 面板刷新服务列表，或重启编辑器。绿色的状态圆点表示 stdio 进程启动成功，并会展示检测到的全部 `omp_*` 工具。
- **单工具开关（Per-Tool Toggles）**：Windsurf Cascade 界面中提供了针对每个工具的开关控件，允许用户根据需求单独启用或禁用 `omp-worker-mcp` 下的各个子工具。
- **选择策略边界**：启用工具使 Cascade 具备后台执行能力，但不保证每次都会自动触发。请在工作区规则或系统提示词中指定委派场景。

---

### 4.6 Continue 配置

- **配置文件位置**：用户级配置文件 `~/.continue/config.yaml`。
- **官方文档**：[Continue MCP 官方文档](https://docs.continue.dev/customize/deep-dives/mcp)。

#### 最小配置示例 (`config.yaml`)

在 `~/.continue/config.yaml` 的 `mcpServers` 列表中加入 `omp-worker`：

```yaml
mcpServers:
  - name: omp-worker
    command: npx
    args:
      - -y
      - omp-worker-mcp
    env:
      OMP_WORKER_OMP_COMMAND: omp
```

#### 激活、工具管理与使用行为

- **激活与检查**：保存 `config.yaml` 后，Continue 会自动检测配置变更并重载 MCP 服务（亦可点击 Continue 侧边栏的刷新图标）。已连接的服务及其工具将出现在工具列表中。
- **工具管理与调用审批**：Continue 支持在对话界面中直接管理工具的启用状态。根据配置，在执行工具调用前可能需要用户手动批准。
- **选择策略边界**：向 Continue 注册工具仅代表其获得调用入口，模型何时选用需依据提示词指引。请在系统提示词或自定义规则中加入委派判断准则。

---

## 5. 官方 Harness 文档参考

有关各主流客户端的高级功能、工具审批机制或 MCP 最新配置规范，请参阅其官方文档：

- **Claude Code**：[Claude Code MCP 官方文档](https://code.claude.com/docs/en/mcp)
- **Cursor**：[Cursor MCP 官方文档](https://docs.cursor.com/context/model-context-protocol)
- **VS Code**：[Visual Studio Code MCP 官方文档](https://code.visualstudio.com/docs/agent-customization/mcp-servers)
- **GitHub Copilot / Agent Host**：[GitHub Copilot MCP 官方文档](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers)
- **Windsurf Cascade**：[Windsurf MCP 官方文档](https://docs.windsurf.com/windsurf/cascade/mcp)
- **Continue**：[Continue MCP 官方文档](https://docs.continue.dev/customize/deep-dives/mcp)
- **Codex (内部指南)**：[作者工作流：Codex 专属直接命名空间配置](author-workflow.zh-CN.md#codex-专属直接命名空间配置)

---

## 6. 下一步：启用工作流选择策略

在宿主 Harness 中注册 `omp-worker-mcp` 仅将相关工具暴露到其可调用工具列表中，但并不指导宿主智能体何时或为何优先选择它们。若要为您的宿主建立清晰的任务委派准则，请继续阅读 [作者工作流启用教程与架构参考](author-workflow.zh-CN.md)，并在项目中添加项目级策略指令（如 `AGENTS.md`、`CLAUDE.md`、`.cursorrules` 或 `.github/copilot-instructions.md`）。
