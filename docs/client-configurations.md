<div align="center">

# Client Configurations

**Integration guides, local stdio compatibility contracts, and verified configuration templates for MCP host harnesses.**

<p align="center">
  English •
  <a href="client-configurations.zh-CN.md">简体中文</a> •
  <a href="README.md">Documentation Index</a>
</p>

</div>

---

## 1. Local stdio Compatibility Contract

`omp-worker-mcp` communicates over standard input/output (stdio) according to the Model Context Protocol specification. Any MCP host harness that supports launching local stdio sub-processes can integrate with this server provided the following three foundational prerequisites are satisfied:

1. **Standard Local stdio Transport**: The host harness must launch `omp-worker-mcp` as a local child process communicating over stdin/stdout.
2. **Local OMP CLI Availability**: The `omp` binary (or the custom executable configured via `OMP_WORKER_OMP_COMMAND`) must be installed and accessible within the host process's runtime `PATH`.
3. **Runtime & Workspace Access**: The execution environment must provide **Node.js >= 22.0.0**, a writable target workspace directory, and adequate filesystem permissions.

---

## 2. Evidence-Tier Compatibility Matrix

Support across various host harnesses is categorized by empirical verification level:

| Support Tier | Harness / Client | Status & Verification Basis | Notes & Boundaries |
| :--- | :--- | :--- | :--- |
| **Author-Verified** | **Codex** | Primary local development workflow | Verified in the author's daily workflow; does not constitute a cross-platform CI guarantee. |
| **Documented / Reproducible Examples** | **Claude Code**, **Cursor**, **VS Code / GitHub Copilot**, **Windsurf Cascade**, **Continue** | Standard stdio configurations from vendor documentation or reproducible JSON/YAML patterns | *Not integration-tested in this repository CI.* Reflects public vendor specifications and native stdio execution capabilities. |
| **Cloud / Remote Hosts** | Web-hosted or cloud-hosted agent environments | Conditional (environment-dependent) | *No out-of-the-box guarantee.* Requires remote container to provide Node.js >= 22, OMP CLI in PATH, writable workspace, and process spawning permissions. |

---

## 3. Generic Configuration Template (`mcpServers`)

For any MCP client that uses a standard JSON `mcpServers` configuration format, use the following snippet as a baseline starting point:

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

*For local source builds, replace `"command": "npx"` and `"args": ["-y", "omp-worker-mcp"]` with `"command": "node"` and `"args": ["<path-to-repo>/dist/index.js"]`.*

---

## 4. Specific Client Configurations

### 4.1 Codex Configuration

- **Config Location**: `~/.codex/config.toml` (on Windows: `C:\Users\<username>\.codex\config.toml`).
- **Official Documentation**: Codex author workflow and namespace setup are documented internally in this repository (see below).

#### Minimal Configuration

Add the following block to your Codex `config.toml` file:

```toml
[mcp_servers.omp-worker]
command = "npx"
args = ["-y", "omp-worker-mcp"]

[mcp_servers.omp-worker.env]
OMP_WORKER_OMP_COMMAND = "omp"
```

*For local source builds, replace `command` with `"node"` and `args` with `["<path-to-repo>/dist/index.js"]`.*

#### Direct Namespace Access & Selection Boundary

In Codex, registering the server connects the process, but direct tool namespace access is managed via `direct_only_tool_namespaces` in `~/.codex/config.toml`. Adding `"mcp__omp_worker"` enables friction-free tool invocation in Codex sessions.

> **Important**: The `direct_only_tool_namespaces` setting is exclusive to Codex and is not used, supported, or required by any other host harness. Please consult the dedicated setup instructions in [Author Workflow: Codex Direct Namespace Setup](author-workflow.md#codex-direct-namespace-setup).

- **Activation & Verification**: Save `config.toml` and restart Codex. You can run the [One-Time Verification Prompt](author-workflow.md#one-time-verification-prompt) to confirm the connection.
- **Selection Policy**: Registering `omp-worker-mcp` makes tools available in Codex, but does not guarantee automatic selection for any given task. Guide delegation behavior with an `AGENTS.md` policy file.

---

### 4.2 Claude Code Configuration

- **Config Location**: Managed via the official CLI (with user or project scope), or declared directly in the project root's `.mcp.json`.
- **Official Documentation**: [Claude Code MCP Documentation](https://code.claude.com/docs/en/mcp).

#### Minimal Registration (CLI Commands)

Register `omp-worker-mcp` across your user environment (`--scope user`):

```bash
claude mcp add omp-worker --scope user --env OMP_WORKER_OMP_COMMAND=omp -- npx -y omp-worker-mcp
```

To register specifically for the current project (`--scope project`):

```bash
claude mcp add omp-worker --scope project --env OMP_WORKER_OMP_COMMAND=omp -- npx -y omp-worker-mcp
```

*(On Windows environments using native `cmd.exe`, if `npx` execution encounters path resolution issues, prefix the command with `cmd /c npx`)*.

#### Alternative Project File Configuration (`.mcp.json`)

Alternatively, declare the server directly in `.mcp.json` at your project root:

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

#### Activation, Approval & Direct-Use Behavior

- **Activation & Verification**: Inspect the registered server with `claude mcp get omp-worker` or list all configured servers using `claude mcp list`. The server is automatically spawned when starting a Claude Code session.
- **Approval & Tool Enablement**: Claude Code prompts for user approval before invoking external tools based on its security and permission settings.
- **Selection Boundary**: Registering the server exposes tools to Claude Code, but automatic model invocation is not guaranteed. Place delegation guidelines in your project's `CLAUDE.md` to establish when background workers should be dispatched.

---

### 4.3 Cursor Configuration

- **Config Location**: Project-level `<workspace>/.cursor/mcp.json` or global user configuration `~/.cursor/mcp.json` (or via `Cursor Settings` > `Features` > `MCP`).
- **Official Documentation**: [Cursor MCP Documentation](https://docs.cursor.com/context/model-context-protocol).

#### Minimal Configuration (`.cursor/mcp.json`)

Create or update `.cursor/mcp.json` in your project root:

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

#### Activation, Toggles & Direct-Use Behavior

- **Activation & Verification**: Navigate to `Cursor Settings` > `Features` > `MCP` and click the refresh button next to `omp-worker` (or restart Cursor). A green status indicator confirms that the stdio process is connected and lists available tools (such as `omp_run_compact`).
- **Tool Toggles & Auto-Run**: In Cursor Composer / Agent mode, registered MCP tools appear in the tool selection panel. You can toggle individual tools on or off and enable auto-run execution permissions per tool.
- **Selection Boundary**: Having the tools enabled in Cursor does not guarantee the model will choose them autonomously. Use `.cursorrules` or project instructions to specify delegation rules for substantive coding tasks.

---

### 4.4 VS Code with GitHub Copilot / Agent Host

- **Config Location**:
  - Workspace-level: `<workspace>/.vscode/mcp.json` or portable workspace `.mcp.json`.
  - User-level / Agent Host: VS Code User Profile `mcp.json` or `~/.copilot/mcp-config.json`.
- **Official Documentation**: [VS Code MCP Documentation](https://code.visualstudio.com/docs/agent-customization/mcp-servers) and [GitHub Copilot MCP Documentation](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers).

#### Minimal Configuration (`.vscode/mcp.json`)

Add the server definition to `.vscode/mcp.json` in your workspace:

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

#### Activation, Enable State & Direct-Use Behavior

- **Activation & Verification**: Save the configuration file. In VS Code, reload the window via the Command Palette (`Developer: Reload Window`) or use the MCP Servers view in the Chat / Agent panel to verify that `omp-worker` is active and its tools are listed.
- **Enable State & Tool Confirmation**: VS Code and GitHub Copilot allow enabling/disabling individual MCP servers. When Copilot Agent calls an MCP tool, the UI may prompt for user confirmation depending on your configured workspace trust and agent permission settings.
- **Selection Boundary**: Server availability makes tools accessible to GitHub Copilot Chat / Agent, but selection is driven by context. Define policy rules in `.github/copilot-instructions.md` to guide when multi-step tasks should be offloaded to `omp_run_compact` or `omp_run_batch_compact`.

---

### 4.5 Windsurf Cascade Configuration

- **Config Location**: Global configuration `~/.codeium/windsurf/mcp_config.json` (or configured via `Windsurf Settings` > `Cascade` > `MCP Servers`).
- **Official Documentation**: [Windsurf MCP Documentation](https://docs.windsurf.com/windsurf/cascade/mcp).

#### Minimal Configuration (`mcp_config.json`)

Add `omp-worker` to your `~/.codeium/windsurf/mcp_config.json`:

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

#### Activation, Per-Tool Toggles & Direct-Use Behavior

- **Activation & Verification**: In Windsurf, open Cascade settings or the MCP panel and refresh the server list, or restart the Windsurf editor. A green status dot indicates successful stdio initialization and displays all discovered `omp_*` tools.
- **Per-Tool Toggles**: Windsurf Cascade provides per-tool toggle switches in the MCP interface, allowing you to selectively enable or disable individual tools exposed by `omp-worker-mcp`.
- **Selection Boundary**: Enabling tools in Windsurf provides Cascade with execution capabilities, but does not guarantee automatic dispatch. Add workflow instructions in your workspace guidelines or system prompt to direct Cascade to delegate complex tasks.

---

### 4.6 Continue Configuration

- **Config Location**: User configuration file `~/.continue/config.yaml`.
- **Official Documentation**: [Continue MCP Documentation](https://docs.continue.dev/customize/deep-dives/mcp).

#### Minimal Configuration (`config.yaml`)

Add `omp-worker` under the `mcpServers` list in `~/.continue/config.yaml`:

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

#### Activation, Tool Management & Direct-Use Behavior

- **Activation & Verification**: Save `config.yaml`. Continue automatically detects configuration changes and reloads MCP servers (or click the reload icon in the Continue sidebar). The connected server and its tools will appear in the Continue tools list.
- **Tool Management & Approvals**: Continue allows enabling or disabling tools in the chat interface. Depending on your configuration, Continue may request approval prior to tool execution.
- **Selection Boundary**: Exposing tools to Continue gives the assistant access to `omp-worker-mcp`, but model invocation depends on prompt context. Include delegation heuristics in your system prompt or project rules.

---

## 5. Official Harness Documentation Links

For further details on host-specific MCP settings, tool approval flows, or client updates, refer to the official vendor documentation:

- **Claude Code**: [Claude Code MCP Documentation](https://code.claude.com/docs/en/mcp)
- **Cursor**: [Cursor MCP Documentation](https://docs.cursor.com/context/model-context-protocol)
- **VS Code**: [Visual Studio Code MCP Documentation](https://code.visualstudio.com/docs/agent-customization/mcp-servers)
- **GitHub Copilot / Agent Host**: [GitHub Copilot MCP Documentation](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers)
- **Windsurf Cascade**: [Windsurf MCP Documentation](https://docs.windsurf.com/windsurf/cascade/mcp)
- **Continue**: [Continue MCP Documentation](https://docs.continue.dev/customize/deep-dives/mcp)
- **Codex (Internal Guide)**: [Author Workflow: Codex Direct Namespace Setup](author-workflow.md#codex-direct-namespace-setup)

---

## 6. Next Steps: Enable the Selection Policy

Registering `omp-worker-mcp` in your host harness makes the tools available in the host's callable toolset, but does not tell the host agent when or why to choose them over built-in tools. To establish clear delegation guidelines for your host, continue to the [Author Workflow Enablement & Architecture Reference](author-workflow.md) and add project-level instructions (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`, or `.github/copilot-instructions.md`).
