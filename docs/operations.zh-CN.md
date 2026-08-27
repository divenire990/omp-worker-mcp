<div align="center">

# 运维配置与状态生命周期

**运行时配置、环境变量、磁盘状态布局、保留清理策略与重启恢复机制。**

<p align="center">
  <a href="operations.md">English</a> •
  简体中文 •
  <a href="README.zh-CN.md">文档索引</a>
</p>

</div>

---

## 1. 环境变量配置参考

支持通过系统环境变量或在 MCP 客户端配置中设定以下参数：

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

## 2. 磁盘状态目录结构

所有状态记录均持久化存储在 `OMP_WORKER_STATE_DIR` 目录下（默认为 `~/.codex/state/omp-worker`）：

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

---

## 3. 保留与清理策略

为保证在长期运行的开发者机器及自动化环境中的稳定性，`omp-worker-mcp` 实现了可靠的状态生命周期防护机制：

- **默认保守保留**：默认情况下，`omp-worker-mcp` **绝不自动删除任何已完成或历史记录**，防止用户数据或日志意外丢失。
- **显式清理规则**：用户可通过配置 `OMP_WORKER_RETENTION_TTL_SECONDS`（清理超过指定秒数的终态记录）或 `OMP_WORKER_RETENTION_MAX_BYTES`（按时间由旧到新清理终态记录直至满足字节上限）启用自动清理。
- **运行中任务保护**：处于非终态（`dispatched`、`running`、`pending`、`validating`、`cancelling` 等）的任务与任务组**受到严格保护，绝不被清理**。
- **损坏记录安全保护**：无法确认其是否为终态的损坏文件不会被误删；状态目录中的符号链接将被拒绝且不会被递归跟随。
- **透明的故障可见性**：清理过程中的权限异常或读写错误会完整记录在错误输出中，不会被静默吞掉。

---

## 4. 服务器重启与恢复机制

- **元数据持久化**：任务与批处理组的元数据均原子写入磁盘。在 MCP 服务器重启后，所有已分发与已完成的任务依然可以通过 `omp_result` 与 `omp_wait` 完整读取。
- **进程解耦**：若 MCP 服务器在外部任务运行期间意外退出，服务器不会在重启后对失控的孤儿进程进行静默接管，持久化的元数据与日志将忠实反映记录的状态。
