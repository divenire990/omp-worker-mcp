# 基准测试结果记录目录 (Benchmark Results)

本目录用于存放操作者对照 [Benchmark Result Schema](../schema/benchmark-result.schema.json) 实测记录的单次基准测试运行数据。

## 本地隐私与防泄露机制

为防止未经核实的个人遥测数据、本地机器标识或隐私 Token 数据被意外提交到版本库：

1. **默认 Git 忽略**：本目录下的所有 `*.json` 结果文件已被 `.gitignore` 规则自动忽略。
2. **公开前审核**：任何拟公开的基准测试结果必须经过独立复核与可复现性检验后方可提交。
3. **记录模板**：请复制 [`../schema/template.json`](../schema/template.json) 作为记录单次 Trial 的基准结构。

## 单次 Trial 记录流程

1. 复制模板文件：
   ```bash
   cp benchmarks/schema/template.json benchmarks/results/run-case01-direct-001.json
   ```
2. 根据被测任务界面/导出中实际观测到的指标填写元数据（客户端版本、模型、物理耗时、工具调用次数及可见的 Token 消耗）。
3. 保持文件在本地暂存，在未完成多轮复现及审核前严禁提交至公共分支。
