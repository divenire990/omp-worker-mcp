# 基准测试案例 03：不相交写路径 DAG 与集成测试

**案例编号**：`case-03-disjoint-write-dag`  
**测试类别**：多任务 DAG 并发与集成汇总  
**访问模式**：`write`（并行互斥所有权）+ 串行只读集成校验  
**测试工程**：`benchmarks/fixtures/data-pipeline/`

---

## 1. 测试目标

在确定性测试工程中执行包含多个阶段的工作流：两个互不影响的并行功能子任务分别修改互斥的文件路径（`src/modules/alpha-enricher.js` 与 `src/modules/beta-formatter.js`），下游依赖任务在前两项均完成后执行全量集成测试并汇总结果。

---

## 2. 标准测试提示词

*在 Direct 模式与 Supervisor-Worker 模式的评测中，必须使用以下完全一致的逐字提示词：*

```text
Implement two independent module enhancements and run the end-to-end integration test in benchmarks/fixtures/data-pipeline/:
1. Task A: Enhance src/modules/alpha-enricher.js (owned path: benchmarks/fixtures/data-pipeline/src/modules/alpha-enricher.js) to support custom stage metadata and verify with test/unit/alpha-enricher.test.js.
2. Task B: Enhance src/modules/beta-formatter.js (owned path: benchmarks/fixtures/data-pipeline/src/modules/beta-formatter.js) to support custom destination sinks and verify with test/unit/beta-formatter.test.js.
3. Task C (Integration): Run the full integration test suite after Task A and Task B complete:
   node --test benchmarks/fixtures/data-pipeline/test/integration/pipeline.test.js
Ensure Task A and Task B have non-overlapping ownership paths and Task C depends on both upstream completions.
```

---

## 3. 评测执行流程指南

### 运行前基线重置
在每次 Trial 开始前，重置 Fixture 状态：
```bash
git checkout -- benchmarks/fixtures/ && git clean -fd benchmarks/fixtures/
```

### Trial 5：直接处理模式 (`direct`)
1. **创建全新 Codex 任务**：在客户端新建空白任务会话，杜绝历史上下文干扰。
2. **下发标准提示词**：输入上述标准提示词。
3. **主控直接执行**：主控模型在主对话中依次或交替编辑两个模块，完成后运行集成测试命令。
4. **Token 遥测采集**：
   - 记录 Codex 界面或会话导出中可见的 `input_tokens`、`output_tokens` 与 `total_tokens`。
   - 记录确切的 `telemetry_source`（如 `"codex-desktop-ui"`、`"codex-cli-session-export"`）与客户端版本。
5. **验收检查**：运行集成测试命令验证端到端流水线。

### Trial 6：主控-Worker 模式 (`supervisor_worker`)
1. **创建全新 Codex 任务**：在客户端新建空白任务会话。
2. **下发完全相同的提示词**：输入上述完全相同的标准提示词。
3. **Supervisor 角色定位与 MCP 工具调用**：
   - 主控模型构建 DAG 批量任务并调用 `omp_run_batch_compact`：
     ```json
     {
       "tasks": [
         {
           "id": "enhance-alpha",
           "goal": "Enhance Alpha Enricher metadata handling in src/modules/alpha-enricher.js",
           "access": "write",
           "ownership": ["benchmarks/fixtures/data-pipeline/src/modules/alpha-enricher.js"],
           "acceptance": "Alpha Enricher updated and test/unit/alpha-enricher.test.js passes."
         },
         {
           "id": "enhance-beta",
           "goal": "Enhance Beta Formatter sink handling in src/modules/beta-formatter.js",
           "access": "write",
           "ownership": ["benchmarks/fixtures/data-pipeline/src/modules/beta-formatter.js"],
           "acceptance": "Beta Formatter updated and test/unit/beta-formatter.test.js passes."
         },
         {
           "id": "run-integration",
           "goal": "Run full pipeline integration test suite after upstream tasks complete",
           "access": "read_only",
           "depends_on": ["enhance-alpha", "enhance-beta"],
           "acceptance": "node --test test/integration/pipeline.test.js passes cleanly."
         }
       ],
       "max_parallel": 2
     }
     ```
   - Worker 运行时校验写路径互斥性与拓扑无环性，并发调度任务 A 与 B，并在完成后触发任务 C。
   - *注：严禁预设或宣称跑分结论，仅如实记录实际执行情况。*
4. **Token 遥测采集**：
   - 采用与 Trial 5 完全相同的口径记录主控会话中的可见 Token 遥测数据。
5. **验收检查**：核验 Worker 批处理返回信封并执行集成测试。

---

## 4. 验收标准与判定

1. **写路径互斥隔离**：并发运行的写任务不得声明或修改相同文件（任务 A 拥有 `alpha-enricher.js`，任务 B 拥有 `beta-formatter.js`）。
2. **拓扑序调度保证**：任务 C 必须且仅在任务 A 和任务 B 均成功完成后启动。
3. **集成测试通过**：全量集成测试套件执行通过：
   ```bash
   node --test benchmarks/fixtures/data-pipeline/test/integration/pipeline.test.js
   ```
4. **结构化信封完整**：各子任务及批处理汇总均具备合法的 `OMP_WORKER_RESULT`。

---

## 5. 指标记录

复制 `benchmarks/schema/template.json` 至 `benchmarks/results/run-case03-<mode>-<id>.json`，记录 DAG 总体耗时、重试次数、主会话工具调用数、Token 遥测与验收判定结果。
