<div align="center">

# 基准测试评估规范 (Benchmark Protocol)

**一套用于对比“主控直接执行 (Direct)”与“主控-Worker 委派编排 (Supervisor-Worker)”的公开、可复现基准测试规范。**

<p align="center">
  <a href="README.md">English</a> •
  简体中文 •
  <a href="../README.zh-CN.md">项目首页</a>
</p>

</div>

---

## 1. 目标与定位

本基准测试规范旨在提供一套标准化、基于实测的评测流程，用于度量两种不同执行架构在真实软件工程场景下的行为表现：

1. **直接处理模式 (`direct`)**：主控大语言模型（如 Codex、Claude Code、Cursor 等）在当前主对话会话中直接发起工具调用（文件读取、代码编辑、终端执行）。
2. **主控-Worker 模式 (`supervisor_worker`)**：主控模型充当架构师与监督者（负责需求理解、任务分解、边界约束与结果验收），将具体自治执行单元委派给后台 `omp-worker-mcp` Worker 实例执行。

### 架构收益假设 (Hypothesis)
`omp-worker-mcp` 的核心价值定位表述为**一项待验证的技术假设**：
> *“将高耗时的具体执行任务委派给后台 Worker，使高级主控模型能够专注于高层架构设计与质量验收，有助于降低主会话上下文压力与交互疲劳，并在支持并发的批处理任务中提升吞吐效率。”*

本规范定义了标准的测试案例、确定性的本地测试基准环境（Fixture）与度量标准，旨在以严谨实验检验该假设。**严禁伪造跑分数据、杜撰成本节省结论或宣称固定配额优势。**

---

## 2. 确定性基准测试工程 (Fixture)

所有测试 Trial 均基于位于 [`fixtures/data-pipeline/`](fixtures/data-pipeline/) 的自包含、零外部依赖 Node.js 测试工程运行：

```
benchmarks/fixtures/data-pipeline/
├── package.json                   # 零外部依赖（内置使用 node:test 与 node:assert）
├── README.md                      # Fixture 结构与本地命令说明
├── src/
│   ├── index.js                   # 流水线主入口
│   ├── validator.js               # 载荷格式校验（Case 01 调研目标）
│   ├── storage.js                 # 状态持久化与 TTL 清理逻辑（Case 01 调研目标）
│   ├── transformer.js             # 数据转换模块，含故意植入的边界缺陷（Case 02 修复目标）
│   └── modules/
│       ├── alpha-enricher.js      # 独立写目标 A（Case 03 目标 A）
│       └── beta-formatter.js      # 独立写目标 B（Case 03 目标 B）
└── test/
    ├── unit/
    │   ├── storage.test.js        # Case 01 验证测试
    │   ├── validator.test.js      # 校验器单元测试
    │   ├── transformer.test.js    # Case 02 验证测试（覆盖植入缺陷）
    │   ├── alpha-enricher.test.js # 模块 A 单元测试
    │   └── beta-formatter.test.js # 模块 B 单元测试
    └── integration/
        └── pipeline.test.js       # Case 03 端到端集成测试
```

### 确定性基准重置命令

在每个 Trial 运行前，必须使用针对 Fixture 目录的单行重置命令恢复至初始基线状态：

```bash
git checkout -- benchmarks/fixtures/ && git clean -fd benchmarks/fixtures/
```

*注意：该命令严格限定在 `benchmarks/fixtures/` 路径内，绝不执行全局宽路径破坏性清理（如 `git reset --hard`）。*

### Fixture 验收测试命令

运行全量测试套件：
```bash
node --test benchmarks/fixtures/data-pipeline/test/unit/*.test.js benchmarks/fixtures/data-pipeline/test/integration/*.test.js
```

---

## 3. 基准测试用例概览

评测套件包含 3 个代表典型开发流程的稳定测试案例：

| 案例编号 | 案例名称 | 关注重点 | 工作流特征 |
| :--- | :--- | :--- | :--- |
| [`case-01`](cases/01-read-only-investigation.zh-CN.md) | **只读技术调研与影响分析** | 架构探查与无修改报告 | 纯只读探索 `storage.js` / `validator.js`、关键机制梳理、零代码修改。 |
| [`case-02`](cases/02-single-module-bugfix.zh-CN.md) | **单模块 Bug 修复与回归验证** | 隔离缺陷复现与修复闭环 | 针对 `src/transformer.js` 中缺少 tags 的 TypeError 精准修复与单元测试验证。 |
| [`case-03`](cases/03-disjoint-write-dag.zh-CN.md) | **不相交写路径 DAG 与集成测试** | 多任务 DAG 并发与下游汇总 | 并行修改 `alpha-enricher.js` 与 `beta-formatter.js`，下游依赖节点运行端到端集成测试。 |

---

## 4. 评测执行规范：6 项标准 Trials

一次完整的 A/B 对比评测由 **6 次独立 Trial** 组成（3 个案例 × 2 种执行模式）：

1. **Trial 1**：Case 01 — Direct 模式
2. **Trial 2**：Case 01 — Supervisor-Worker 模式
3. **Trial 3**：Case 02 — Direct 模式
4. **Trial 4**：Case 02 — Supervisor-Worker 模式
5. **Trial 5**：Case 03 — Direct 模式
6. **Trial 6**：Case 03 — Supervisor-Worker 模式

### 必须遵守的操作纪律

对于每一次 Trial，操作者必须严格遵循以下流程：

1. **全新 Codex 任务 (Fresh Task)**：每次 Trial **必须**在 Codex 中创建一个全新的独立对话任务，严禁复用历史会话，避免跨会话记忆或上下文缓存污染。
2. **完全一致的提示词 (Identical Prompt)**：在 Direct 模式与 Supervisor-Worker 模式下，必须使用用例规范中给出的**逐字完全相同**的标准任务提示词。
3. **执行前基线重置**：启动任务前必须在终端执行 `git checkout -- benchmarks/fixtures/ && git clean -fd benchmarks/fixtures/`。
4. **Token 遥测数据采集**：
   - 检查 Codex 界面、会话导出或 CLI 遥测中可见的 Token 消耗指标，或使用套件内置的安全遥测提取工具自动提取：
     ```bash
     node benchmarks/tools/extract-codex-telemetry.mjs --session-id <uuid>
     # 或
     node benchmarks/tools/extract-codex-telemetry.mjs --session-file <path>
     ```
   - 记录 `input_tokens`、`output_tokens` 与 `total_tokens`。
   - 记录确切的 `telemetry_source`（如 `"codex_session_jsonl"`、`"codex-desktop-ui"`、`"codex-cli-session-export"`）与 `client_version`。
   - 若操作者当前环境未暴露 Token 遥测，必须显式将 `token_telemetry.available` 标记为 `false` 并填写透明度声明。
5. **独立运行验收测试**：执行对应的 Fixture 验收测试命令，验证修改是否符合预期。
6. **Supervisor-Worker 模式角色定位**：
   - 主控模型充当 Supervisor（负责任务分解、声明所有权边界、调用 MCP 工具、核对验收结果）。
   - Worker 通过 `omp_run_compact` 或 `omp_run_batch_compact` 在后台自治执行。
   - 严禁在测试前预设或虚构跑分数据，必须如实记录实际观测结果。
7. **本地结果隔离存储**：将单次 Trial 的 JSON 记录存放在 `benchmarks/results/` 目录下（该目录默认被 git 忽略，防止个人遥测被意外提交）。

---

## 5. 度量指标与数据采集规范

每次基准测试运行均需按照标准的 [JSON 结果 Schema](schema/benchmark-result.schema.json) 与 [记录模板](schema/template.json) 记录结果。

### 核心记录字段

1. **`mode`** (`"direct"` | `"supervisor_worker"`)：本次运行采用的执行架构。
2. **`case_id`**：基准测试案例标识（如 `case-01-read-only-investigation`）。
3. **`task_id`**：操作者指定的唯一运行标识（如 `run-20260827-01`）。
4. **`operator_metadata`**：
   - `model_identifier`：主控模型与 Worker 模型标识（如 `claude-3-7-sonnet`、`gemini-3.7-flash`）。
   - `client_identifier`：主控客户端标识（如 `codex`、`claude-code`、`cursor`、`workbuddy`）。
   - `client_version`：主控客户端/Harness 的确切版本号、构建号或发布标识。
   - `omp_worker_version`：`omp-worker-mcp` 版本号（如 `0.1.0`）。
   - `environment_os`：操作系统与架构（如 `win32-x64`）。
5. **`wall_clock_seconds`**：从任务下发到最终验收通过的物理耗时（秒）。
6. **`primary_harness_tool_calls`**：主控 Harness 在主会话中直接执行的工具调用次数（若可观测）。
7. **`acceptance_result`** (`"passed"` | `"failed"` | `"partial"`)：对照验收标准的评估结论。
8. **`retry_count`**：同会话纠错或重试次数（如 `omp_continue` 调用次数）。
9. **`token_telemetry`**：
   - `available` (`boolean`)：显式标记客户端是否提供了可信的 Token 消耗遥测。
   - `telemetry_source` (`string` | `null`)：客户端提供的用量视图、CLI 导出或遥测界面名称（如 `codex_session_jsonl`、`codex-desktop-ui`、`codex-cli-session-export`）。在遥测可用时必填；不可观测时为 `null`。
   - `input_tokens` / `output_tokens` / `total_tokens`：观测到的真实 Token 数量；未暴露时填写 `null`。
   - `disclosure`：强制性遥测透明度声明，说明数据采集途径或不可观测的原因。
10. **`cost_telemetry`**：
    - `available` (`boolean`)：显式标记平台是否直接提供了单次会话的精确金额费用。
    - `total_cost_usd`：真实观测到的美元费用；未暴露或为固定订阅/配额制时填 `null`。严禁根据 Token 数量或订阅费自行推算。
    - `disclosure`：强制性费用透明度声明，说明费用可用性或不可观测原因。
11. **`notes`**：操作者的定性观察（如上下文消耗感受、交互流畅度等）。

---

## 6. 遥测与成本数据披露政策

### 严格禁止数据伪造原则
许多本地客户端与 MCP 宿主环境并未对外暴露每次会话的精确 Token 消耗或计费明细。
- 测试人员**严禁**自行估算、编造未观测到的 Token 数量或揣测美元成本节省。
- 基准测试报告必须清晰声明哪些数据是直接观测到的，哪些数据在当前环境下不可观测。
- 本项目未集成任何未公开的 Codex UI/API 路由或自动摄入机制；所有遥测数据均依赖操作者如实记录客户端或账户所展现的真实数据。

### Codex Token 遥测采集规范
1. **强制显式记录 Token**：若 Codex 客户端界面、CLI 输出、会话导出或账户用量页面暴露了 Token 消耗，操作者**必须显式记录**实际观测到的输入（Prompt）、输出（Completion）及总 Token 数量。从本地 Codex 会话文件提取时，可使用套件提供的安全提取工具（`benchmarks/tools/extract-codex-telemetry.mjs`）并将遥测来源标记为 `telemetry_source: "codex_session_jsonl"`。
2. **明确遥测来源**：`token_telemetry.telemetry_source` 字段必须如实填写具体的用量视图或导出来源名称（如 `"codex_session_jsonl"`、`"codex-desktop-ui"`、`"codex-cli-session-export"`）。
3. **记录确切客户端版本与界面**：操作者必须记录所使用的确切 Codex 界面（`operator_metadata.client_identifier`）与客户端版本号（`operator_metadata.client_version`）。
4. **跨模式可比性原则**：`direct` 与 `supervisor_worker` 两种模式之间的对比数据**仅在两次运行使用完全相同的遥测来源、客户端版本与界面时方为有效且具备可比性**。

### 安全遥测提取工具 (Safe Telemetry Extractor)

基准测试套件在 `benchmarks/tools/extract-codex-telemetry.mjs` 中提供了专用的 Node.js ESM 命令行提取工具：
```bash
# 按 Session UUID 提取（自动在 CODEX_HOME/sessions 或 ~/.codex/sessions 下安全检索）
node benchmarks/tools/extract-codex-telemetry.mjs --session-id <uuid>

# 或直接指定显式 Session JSONL 文件路径提取
node benchmarks/tools/extract-codex-telemetry.mjs --session-file <path>
```
该工具流式逐行解析目标会话 JSONL，并聚合以下指标：
- 累积与增量 Token 用量（`input_tokens`、`cached_input_tokens`、`output_tokens`、`reasoning_output_tokens`、`total_tokens` 及可选的 `cache_write`）的首值、末值与 delta 增量；
- 主滑动窗口速率限制 `used_percent`（首值、末值及区间消耗比例 delta）；
- 按工具名称与命名空间分类的工具调用次数；
- 函数调用输出总次数与聚合 UTF-8 字节总大小。

**隐私与安全保障**：提取工具绝不会在输出中打印、暴露或存储任何原始会话消息、提示词、工具入参、工具返回结果、凭证密钥或绝对文件路径。

### 区分“Token 总量”与“速率配额百分比 (used_percent)”

在分析 Codex 遥测数据时，必须清晰区分以下两个不同维度的指标：
- **`total_tokens`（计算处理总量）**：度量大语言模型会话在本次任务期间实际处理的上下文和生成的内容总量（包括提示词、缓存命中的提示词、输出与推理 Token）。
- **`used_percent`（滑动时间窗口配额占用率）**：反映当前账户在特定滑动时间窗口（如 5 小时滚动周期）内所消耗的配额比例。
- **绝非金钱成本 (No Monetary Cost Equivalence)**：无论是 `total_tokens` 还是 `used_percent`，**均不代表金钱费用（美元 USD）**。固定订阅制、企业阶梯方案或免费试用额度均采用固定计费模式，Token 增量或配额百分比并不产生按量计费的美元账单。测试人员**严禁**根据 Token 数量或配额占用率推算或声称美元节省。
### 区分 Token 与成本遥测
Token 遥测与金额费用遥测严格区分为两个独立对象：
