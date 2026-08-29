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

## 2. Security configuration before remote access

For remote exposure, strongly consider setting `OMP_WORKER_ALLOWED_ROOTS`. It is a non-empty JSON array of absolute directory paths.

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

When enabled, the worker checks immediately before spawning OMP that:

1. `cwd` is an existing absolute directory;
2. `cwd` and configured roots are canonicalized through `realpath`;
3. sibling prefix tricks such as `/work/project-evil` are rejected when `/work/project` is allowed;
4. symlink / junction escapes outside the approved roots are rejected;
5. OMP starts only when the canonical working directory is contained by an approved root.

> `OMP_WORKER_ALLOWED_ROOTS` is an execution-entry allowlist, not an operating-system sandbox. OMP and its descendants still inherit the OS privileges of the account running the tunnel. For stronger isolation, combine it with a dedicated low-privilege account, filesystem ACLs, a container, or a VM.

---

## 3. Connect the local stdio MCP to Secure MCP Tunnel

The OpenAI `tunnel-client` can manage a long-lived local stdio MCP runtime directly. The example below assumes you already have a tunnel ID and runtime API key.

Keep the runtime key in an environment variable rather than embedding it in command history or config files:

```powershell
$env:TUNNEL_RUNTIME_KEY = "<runtime-api-key>"
```

Connect the local MCP server:

```powershell
tunnel-client runtimes connect `
  --alias omp-worker `
  --tunnel-id tunnel_0123456789abcdef0123456789abcdef `
  --runtime-api-key env:TUNNEL_RUNTIME_KEY `
  --mcp-command "npx -y omp-worker-mcp"
```

macOS / Linux:

```bash
export TUNNEL_RUNTIME_KEY='<runtime-api-key>'

tunnel-client runtimes connect \
  --alias omp-worker \
  --tunnel-id tunnel_0123456789abcdef0123456789abcdef \
  --runtime-api-key env:TUNNEL_RUNTIME_KEY \
  --mcp-command "npx -y omp-worker-mcp"
```

The stdio process launched by `tunnel-client` inherits its runtime environment, so `OMP_WORKER_OMP_COMMAND` and `OMP_WORKER_ALLOWED_ROOTS` are inherited by `omp-worker-mcp` and its runners.

---

## 4. Verify the runtime

Do not treat a successful launch command as sufficient verification. Check the managed runtime:

```bash
tunnel-client runtimes status omp-worker --json
```

Verify that the process is running, local health/readiness is healthy, and the ChatGPT workspace has permission to use the corresponding tunnel / MCP app.

Useful diagnostics:

```bash
tunnel-client runtimes status omp-worker
tunnel-client doctor --profile <profile> --explain
```

---

## 5. Recommended ChatGPT supervision model

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

## 6. First verification task

Start with a read-only task:

```text
Use omp-worker-mcp to inspect D:\Projects\example, summarize its directory structure, dependencies, and Git status, and do not modify any files.
```

Then verify the negative path: if only `D:\Projects` is allowed, a job whose `cwd` is `C:\Users` should fail before OMP starts and record an `outside OMP_WORKER_ALLOWED_ROOTS` error.

---

## 7. Trust boundary

Secure MCP Tunnel solves network reachability and transport; it does not automatically sandbox the local execution environment. A complete boundary should combine:

1. ChatGPT / workspace access controls for the tunnel;
2. tunnel runtime key and tunnel permissions;
3. `OMP_WORKER_ALLOWED_ROOTS` workspace allowlisting;
4. OMP Worker task / ownership constraints;
5. OS account, ACL, container, or VM permissions as the final enforcement layer.

High-impact operations such as `git push`, publishing, production deployment, or secret modification should still require explicit human confirmation.
