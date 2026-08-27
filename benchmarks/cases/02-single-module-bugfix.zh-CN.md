# 基准测试案例 02：单模块 Bug 修复与回归验证

**案例编号**：`case-02-single-module-bugfix`  
**测试类别**：隔离缺陷复现与修复闭环  
**访问模式**：`write`（显式限定 `ownership` 路径）  
**测试工程**：`benchmarks/fixtures/data-pipeline/`

---

## 1. 测试目标

针对确定性测试工程中单一模块（`benchmarks/fixtures/data-pipeline/src/transformer.js`）的边界条件缺陷（当输入缺少 `tags` 或 `tags` 为 `null` 时直接调用 `.map()` 触发未捕获的 `TypeError`），被测 Agent 需准确定位缺陷逻辑，在严格受限的文件所有权路径内完成最小必要修复，并运行单元测试确认回归已消除。

---

## 2. 标准测试提示词

*在 Direct 模式与 Supervisor-Worker 模式的评测中，必须使用以下完全一致的逐字提示词：*

```text
Fix the boundary handling defect in benchmarks/fixtures/data-pipeline/src/transformer.js:
1. Locate the logic in src/transformer.js where missing or null tags throw TypeError.
2. Apply the minimal necessary fix strictly within src/transformer.js without modifying any other files.
3. Run the targeted test suite to confirm the regression is resolved and all unit tests pass:
   node --test benchmarks/fixtures/data-pipeline/test/unit/transformer.test.js
4. Report the root cause, changed files, and test verification output.
```

---

## 3. 评测执行流程指南

### 运行前基线重置
在每次 Trial 开始前，重置 Fixture 状态：
```bash
git checkout -- benchmarks/fixtures/ && git clean -fd benchmarks/fixtures/
```

### Trial 3：直接处理模式 (`direct`)
1. **创建全新 Codex 任务**：在客户端新建空白任务会话，杜绝历史上下文干扰。
2. **下发标准提示词**：输入上述标准提示词。
3. **主控直接执行**：主控模型直接在主会话中定位 `src/transformer.js`，修改代码并执行测试命令。
4. **Token 遥测采集**：
   - 记录 Codex 界面或会话导出中可见的 `input_tokens`、`output_tokens` 与 `total_tokens`。
   - 记录确切的 `telemetry_source`（如 `"codex-desktop-ui"`、`"codex-cli-session-export"`）与客户端版本。
5. **验收检查**：运行测试命令并确认仅 `src/transformer.js` 被修改。

### Trial 4：主控-Worker 模式 (`supervisor_worker`)
1. **创建全新 Codex 任务**：在客户端新建空白任务会话。
2. **下发完全相同的提示词**：输入上述完全相同的标准提示词。
3. **Supervisor 角色定位与 MCP 工具调用**：
   - 主控模型充当 Supervisor，显式限定所有权边界，通过 `omp_run_compact` 委派：
     ```json
     {
       "goal": "Fix boundary condition handling for missing/null tags in transformer.js and verify unit tests",
       "acceptance": "src/transformer.js patched cleanly; transformer.test.js passes; zero edits outside transformer.js",
       "access": "write",
       "ownership": ["benchmarks/fixtures/data-pipeline/src/transformer.js"]
     }
     ```
   - Worker 在后台独立自治执行。若 Worker 首次返回未通过验收，主控调用 `omp_continue` 提供纠错指导。
   - *注：严禁预设或宣称跑分结论，仅如实记录实际执行情况。*
4. **Token 遥测采集**：
   - 采用与 Trial 3 完全相同的口径记录主控会话中的可见 Token 遥测数据。
5. **验收检查**：核对 Worker 返回信封 `status: "completed"` 且 `artifacts: ["benchmarks/fixtures/data-pipeline/src/transformer.js"]`，执行验收测试命令。

---

## 4. 验收标准与判定

1. **路径所有权隔离**：文件修改严格限定在 `benchmarks/fixtures/data-pipeline/src/transformer.js`。
2. **回归测试通过**：目标单元测试套件全部通过：
   ```bash
   node --test benchmarks/fixtures/data-pipeline/test/unit/transformer.test.js
   ```
3. **全量测试无破坏**：其余单元测试继续保持全绿：
   ```bash
   node --test benchmarks/fixtures/data-pipeline/test/unit/*.test.js
   ```
4. **结构化交付**：Supervisor-Worker 模式下 Worker 返回合法的 `OMP_WORKER_RESULT` 信封。

---

## 5. 指标记录

复制 `benchmarks/schema/template.json` 至 `benchmarks/results/run-case02-<mode>-<id>.json`，记录端到端耗时、纠错轮数（`retry_count`）、主会话工具调用数、Token 遥测与验收判定结果。
