# 基准测试案例 01：只读技术调研与架构分析

**案例编号**：`case-01-read-only-investigation`  
**测试类别**：架构探查与影响分析  
**访问模式**：`read_only`（只读）  
**测试工程**：`benchmarks/fixtures/data-pipeline/`

---

## 1. 测试目标

对确定性测试工程中的状态持久化、保留期清理与存储容量限制机制（`src/storage.js` 与 `src/validator.js`）执行定向只读调研。被测 Agent 需识别涉及的核心文件，梳理数据记录的生命周期逻辑并给出总结，期间严禁修改工作区中的任何文件。

---

## 2. 标准测试提示词

*在 Direct 模式与 Supervisor-Worker 模式的评测中，必须使用以下完全一致的逐字提示词：*

```text
Perform an architectural investigation on the data-pipeline fixture in benchmarks/fixtures/data-pipeline/:
1. Identify all source and documentation files involved in validation and storage.
2. Trace how records are saved in src/storage.js, how TTL expiration is calculated, how stale records are purged, and how max capacity is enforced.
3. Summarize your findings and highlight any potential edge cases or failure modes.
4. Do not modify, create, or delete any files in the workspace.
```

---

## 3. 评测执行流程指南

### 运行前基线重置
在每次 Trial 开始前，重置 Fixture 状态：
```bash
git checkout -- benchmarks/fixtures/ && git clean -fd benchmarks/fixtures/
```

### Trial 1：直接处理模式 (`direct`)
1. **创建全新 Codex 任务**：在客户端新建空白任务会话，杜绝历史上下文干扰。
2. **下发标准提示词**：输入上述标准提示词。
3. **主控直接执行**：主控模型在当前主会话中直接调用其文件读取与搜索工具完成调研。
4. **Token 遥测采集**：
   - 记录 Codex 界面或会话导出中可见的 `input_tokens`、`output_tokens` 与 `total_tokens`。
   - 记录确切的 `telemetry_source`（如 `"codex-desktop-ui"`、`"codex-cli-session-export"`）与客户端版本。
5. **验收检查**：验证零文件修改（`git status --porcelain benchmarks/fixtures/` 必须为空）。

### Trial 2：主控-Worker 模式 (`supervisor_worker`)
1. **创建全新 Codex 任务**：在客户端新建空白任务会话。
2. **下发完全相同的提示词**：输入上述完全相同的标准提示词。
3. **Supervisor 角色定位与 MCP 工具调用**：
   - 主控模型充当 Supervisor，通过 `omp_run_compact` 委派后台 Worker：
     ```json
     {
       "goal": "Investigate state persistence, TTL calculation, and capacity enforcement in benchmarks/fixtures/data-pipeline/",
       "acceptance": "Identify validator.js and storage.js; explain TTL/purge/eviction logic; zero files modified.",
       "access": "read_only"
     }
     ```
   - Worker 在后台独立自治执行并返回标准 `OMP_WORKER_RESULT` 信封。
   - *注：严禁预设或宣称跑分结论，仅如实记录实际执行情况。*
4. **Token 遥测采集**：
   - 采用与 Trial 1 完全相同的口径记录主控会话中的可见 Token 遥测数据。
5. **验收检查**：核验 Worker 返回信封 `status: "completed"` 且 `artifacts: []`，验证 `git status --porcelain benchmarks/fixtures/` 为空。

---

## 4. 验收标准与判定

1. **核心文件识别**：准确识别 `src/storage.js`、`src/validator.js` 与 `README.md`。
2. **零文件修改不变量**：执行完毕后 `git status --porcelain benchmarks/fixtures/` 必须完全为空。
3. **测试通过**：执行存储单元测试通过：
   ```bash
   node --test benchmarks/fixtures/data-pipeline/test/unit/storage.test.js
   ```
4. **结构化交付**：在 Supervisor-Worker 模式下，Worker 输出合法的 `OMP_WORKER_RESULT` 信封。

---

## 5. 指标记录

复制 `benchmarks/schema/template.json` 至 `benchmarks/results/run-case01-<mode>-<id>.json`，记录端到端耗时、主会话工具调用数、Token 遥测与验收判定结果。
