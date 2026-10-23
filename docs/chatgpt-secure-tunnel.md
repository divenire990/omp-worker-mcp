<div align="center">

# Use Local OMP from ChatGPT via Secure MCP Tunnel

**Run ChatGPT as the supervisor and local `omp-worker-mcp` + OMP as the controlled execution worker.**

<p align="center">
  English •
  <a href="chatgpt-secure-tunnel.zh-CN.md">简体中文</a> •
  <a href="README.md">Documentation Index</a>
</p>

</div>

---

## 1. Architecture

```text
ChatGPT Web
    |
    | Custom MCP / Secure MCP Tunnel
    v
OpenAI tunnel service
    |
    | outbound HTTPS only
    v
local tunnel-client
    |
    | stdio MCP
    v
omp-worker-mcp
    |
    v
local OMP workers
    |
    v
approved local workspaces
```

OpenAI `tunnel-client` can launch a local stdio MCP child process through `--mcp-command` / `--mcp.command`. `omp-worker-mcp` therefore does not need an HTTP transport and the local machine does not need an inbound public port.

---

## 2. Version requirement (`>= 0.2.0`) & security configuration before remote access

> **Version requirement (`omp-worker-mcp >= 0.2.0`):**
> `OMP_WORKER_ALLOWED_ROOTS` is available starting in `omp-worker-mcp` `0.2.0`. Historical npm `0.1.1` lacks this feature and will **not** enforce `OMP_WORKER_ALLOWED_ROOTS` (nor did `0.1.1` include the single-source CLI `--version` reader).
>
> Before exposing `omp-worker-mcp` through a tunnel with `"npx -y omp-worker-mcp"`, verify that your resolved package is `0.2.0` or newer:
> ```bash
> npx -y omp-worker-mcp@latest --version
> ```
> If your local `npx` cache still resolves `0.1.1`, clear or update it (`npx -y omp-worker-mcp@latest`) or run a local `>= 0.2.0` checkout (`npm ci && npm run build`, then pass `node <absolute-path-to-repo>/dist/index.js` to `--mcp-command`).

For remote exposure, always set `OMP_WORKER_ALLOWED_ROOTS`. It is a non-empty JSON array of absolute directory paths.

### Windows PowerShell

```powershell
$env:OMP_WORKER_OMP_COMMAND = "omp"
$env:OMP_WORKER_ALLOWED_ROOTS = '["D:\\Projects","D:\\Research"]'
```

### macOS / Linux

```bash
export OMP_WORKER_OMP_COMMAND=omp
export OMP_WORKER_ALLOWED_ROOTS='["/Users/alice/Projects","/Users/alice/Research"]'
```

When enabled (requires `omp-worker-mcp >= 0.2.0`), the worker checks immediately before spawning OMP that:

1. `cwd` is an existing absolute directory;
2. `cwd` and configured roots are canonicalized through `realpath`;
3. sibling prefix tricks such as `/work/project-evil` are rejected when `/work/project` is allowed;
4. symlink / junction escapes outside the approved roots are rejected;
5. OMP starts only when the canonical working directory is contained by an approved root.

> `OMP_WORKER_ALLOWED_ROOTS` is an execution-entry allowlist, not an operating-system sandbox. OMP and its descendants still inherit the OS privileges of the account running the tunnel. For stronger isolation, combine it with a dedicated low-privilege account, filesystem ACLs, a container, or a VM.

---

## 3. Prerequisites & OpenAI access requirements

Per OpenAI's [Secure MCP Tunnels guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) and `tunnel-client help quickstart`, you need:

1. **Organization / Workspace access**: Your OpenAI organization and ChatGPT workspace must have Secure MCP Tunnels and custom MCP connectors enabled (`https://platform.openai.com/settings/organization/tunnels` and `https://chatgpt.com/#settings/Connectors`).
2. **Tunnel ID (`CONTROL_PLANE_TUNNEL_ID`)**: Created in Tunnels management or via `tunnel-client admin tunnels create` (which requires `OPENAI_ADMIN_KEY` with **Tunnels Read + Manage** permission).
3. **Runtime API key (`CONTROL_PLANE_API_KEY`)**: Created in [Runtime API keys](https://platform.openai.com/settings/organization/api-keys) by a principal with **Tunnels Read + Use** permission for the tunnel. Do **not** pass `OPENAI_ADMIN_KEY` to the long-lived tunnel daemon.

---

## 4. Connect the local stdio MCP to Secure MCP Tunnel

Keep the runtime API key in `CONTROL_PLANE_API_KEY` rather than embedding it in command history or config files.

### Standard profile workflow (`init` → `doctor` → `run`)

This matches the official OpenAI Secure MCP Tunnels documentation and `tunnel-client help quickstart`:

#### Windows PowerShell

```powershell
$env:CONTROL_PLANE_API_KEY = "<runtime-api-key>"

tunnel-client init `
  --sample sample_mcp_stdio_local `
  --profile omp-worker `
  --tunnel-id tunnel_0123456789abcdef0123456789abcdef `
  --mcp-command "npx -y omp-worker-mcp"

tunnel-client doctor --profile omp-worker --explain
tunnel-client run --profile omp-worker
```

#### macOS / Linux

```bash
export CONTROL_PLANE_API_KEY='<runtime-api-key>'

tunnel-client init \
  --sample sample_mcp_stdio_local \
  --profile omp-worker \
  --tunnel-id tunnel_0123456789abcdef0123456789abcdef \
  --mcp-command "npx -y omp-worker-mcp"

tunnel-client doctor --profile omp-worker --explain
tunnel-client run --profile omp-worker
```

### Optional: managed local runtime supervision (`runtimes connect`)

If you want `tunnel-client` (or Codex) to supervise a background local runtime alias instead of keeping `tunnel-client run` attached to a terminal, the CLI also supports:

```bash
tunnel-client runtimes connect \
  --alias omp-worker \
  --tunnel-id tunnel_0123456789abcdef0123456789abcdef \
  --runtime-api-key env:CONTROL_PLANE_API_KEY \
  --mcp-command "npx -y omp-worker-mcp"
```

The stdio process launched by `tunnel-client` inherits its runtime environment, so `OMP_WORKER_OMP_COMMAND` and `OMP_WORKER_ALLOWED_ROOTS` are inherited by `omp-worker-mcp` and its detached runners.

---

## 5. Verify the runtime

Do not treat a launch command alone as sufficient verification:

- **Foreground `tunnel-client run`**: Probe the local operator endpoints (`http://127.0.0.1:8080/healthz`, `/readyz`, and `/ui` by default, or use `tunnel-client health`).
- **Managed `runtimes connect`**: Check the runtime status:
  ```bash
  tunnel-client runtimes status omp-worker --json
  ```
  Confirm that `process_running`, `healthy`, and `ready` are true.

Keep `tunnel-client` running when you create or verify the connector in ChatGPT settings (`https://chatgpt.com/#settings/Connectors`) and during every MCP call from ChatGPT.
---

## 6. Recommended ChatGPT supervision model

Keep responsibilities separated:

```text
ChatGPT = Supervisor
- understand the request
- design the plan
- decompose work
- define acceptance criteria
- review OMP results

OMP = Worker
- inspect local files
- modify code/documents
- run Shell / Python / Git
- execute tests
- return structured results
```

Prefer `omp_run_compact` for one task, `omp_run_batch_compact` for multiple parallel/dependent tasks, and `omp_continue` when corrective feedback should stay in the same OMP execution context.

---

## 7. First verification task

Start with a read-only task:

```text
Use omp-worker-mcp to inspect D:\Projects\example, summarize its directory structure, dependencies, and Git status, and do not modify any files.
```

Then verify the negative path: if only `D:\Projects` is allowed, a job whose `cwd` is `C:\Users` should fail before OMP starts and record an `outside OMP_WORKER_ALLOWED_ROOTS` error.

---

## 8. Trust boundary

Secure MCP Tunnel solves network reachability and transport; it does not automatically sandbox the local execution environment. A complete boundary should combine:

1. ChatGPT / workspace access controls for the tunnel;
2. tunnel runtime key and tunnel permissions;
3. `OMP_WORKER_ALLOWED_ROOTS` workspace allowlisting;
4. OMP Worker task / ownership constraints;
5. OS account, ACL, container, or VM permissions as the final enforcement layer.

High-impact operations such as `git push`, publishing, production deployment, or secret modification should still require explicit human confirmation.
