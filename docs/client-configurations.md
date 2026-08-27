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
| **Author-Verified** | **Codex** | Primary local development workflow | Verified in the author's local daily workflow; does not constitute a cross-platform CI guarantee. |
| **Documented / Reproducible Examples** | **Claude Code**, **WorkBuddy**, **Claude Desktop**, **Cursor**, **Cline**, **VS Code**, **GitHub Copilot CLI** | Standard stdio configurations from vendor documentation or reproducible JSON patterns | *Not integration-tested in this repository CI.* Claude Desktop reflects a generic `mcpServers` JSON pattern. |
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

### Codex Configuration (`config.toml`)

Add the following block to your Codex `config.toml` file:

```toml
[mcp_servers.omp-worker]
command = "npx"
args = ["-y", "omp-worker-mcp"]

[mcp_servers.omp-worker.env]
OMP_WORKER_OMP_COMMAND = "omp"
```

*For local source builds, replace `command` with `"node"` and `args` with `["<path-to-repo>/dist/index.js"]`.*

---

### Claude Code Configuration

Register the server using the official Claude Code CLI command:

```bash
claude mcp add --transport stdio --env OMP_WORKER_OMP_COMMAND=omp omp-worker -- npx -y omp-worker-mcp
```

Verify the registered configuration:

```bash
claude mcp get omp-worker
```

*For more details on Claude Code MCP management, refer to the [Claude Code MCP Documentation](https://code.claude.com/docs/en/mcp). (Note: Provided as a configuration example based on official CLI syntax; not integration-tested in this repository CI).*

---

### WorkBuddy Configuration

WorkBuddy supports stdio MCP server configuration via its graphical Plugins/MCP interface, or by directly editing user-level (`~/.workbuddy/mcp.json`) or project-level (`<workspace>/.workbuddy/mcp.json`) configuration:

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

*For more details, see the [WorkBuddy MCP Guide](https://staging.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/MCP-Guide). (Note: Provided as a configuration example based on public documentation; not verified in this repository CI).*

---

### Claude Desktop Configuration (`claude_desktop_config.json`)

Add the server definition to your `claude_desktop_config.json`:

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

*(Note: Provided as a standard generic `mcpServers` JSON pattern; not independently verified against upstream documentation in this review cycle).*

---

## 5. Official Harness Documentation Links

For advanced host features or updates to client-specific MCP configuration schemas, refer to the official documentation:

- **Cursor**: [Cursor MCP Documentation](https://prod.cursor.com/docs/mcp)
- **VS Code**: [Visual Studio Code MCP Configuration Reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration)
- **GitHub Copilot CLI**: [GitHub Copilot CLI MCP Documentation](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers)
- **Cline**: [Cline MCP Documentation](https://docs.cline.bot/mcp-servers/overview)
