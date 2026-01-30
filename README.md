# Mira Evaluation

React + Next.js + TypeScript 的 Mira 评估实验配置与运行 Web 应用。已将 langfuse 项目完整迁移至本仓库。

## 功能

- **数据集**：单选（Ask、GAIA）
- **评价器**：多选（11 个，对应原 testMira-with-tools.js 第 32–42 行）
- **并发数**：数字输入（maxConcurrency）

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 从 langfuse 复制配置与数据文件（可选，首次建议执行）
npm run setup-runner

# 3. 配置 Langfuse 密钥（二选一）：
#    方式A: 设置环境变量（推荐）
#      export LANGFUSE_PUBLIC_KEY="your-public-key"
#      export LANGFUSE_SECRET_KEY="your-secret-key"
#      export LANGFUSE_BASE_URL="https://us.cloud.langfuse.com"  # 可选
#    方式B: 编辑 lib/runner/config.json，填写 LANGFUSE_PUBLIC_KEY、LANGFUSE_SECRET_KEY 等

# 4. 启动网站
npm run dev
```

访问 http://localhost:3002 使用 Web 界面运行实验。

### 使用网站运行实验

1. 打开浏览器访问 http://localhost:3002
2. 选择数据集（Ask 或 GAIA）
3. 选择评价器（可多选）
4. 设置并发数（1-20）
5. 点击"运行实验"按钮
6. 实验将在后台运行，结果会写入 Langfuse

## 命令行运行实验

```bash
# 方式1: 使用环境变量（推荐）
EVAL_DATASET=Ask EVAL_EVALUATORS=completedEvaluator,sessionCostEvaluator EVAL_MAX_CONCURRENCY=5 npm run run-experiment

# 方式2: 使用预设命令（Windows需要先安装 cross-env）
npm run run-experiment:ask    # 运行 Ask 数据集
npm run run-experiment:gaia   # 运行 GAIA 数据集

# 方式3: 直接运行（需要手动设置环境变量）
# Windows PowerShell:
$env:EVAL_DATASET="Ask"; $env:EVAL_EVALUATORS="completedEvaluator,sessionCostEvaluator"; $env:EVAL_MAX_CONCURRENCY="5"; npm run run-experiment

# Windows CMD:
set EVAL_DATASET=Ask && set EVAL_EVALUATORS=completedEvaluator,sessionCostEvaluator && set EVAL_MAX_CONCURRENCY=5 && npm run run-experiment

# Linux/Mac:
EVAL_DATASET=Ask EVAL_EVALUATORS=completedEvaluator,sessionCostEvaluator EVAL_MAX_CONCURRENCY=5 npm run run-experiment
```

### 环境变量说明

- `EVAL_DATASET`: 数据集名称（如 "Ask" 或 "GAIA"）
- `EVAL_EVALUATORS`: 评价器列表，逗号分隔（如 "completedEvaluator,sessionCostEvaluator,gaiaEvaluator"）
- `EVAL_MAX_CONCURRENCY`: 最大并发数（1-20，默认5）

## 完整配置

### 配置 Langfuse 密钥

**方式1: 使用环境变量（推荐，更安全）**

```bash
# Windows PowerShell:
$env:LANGFUSE_PUBLIC_KEY="pk-lf-your-public-key"
$env:LANGFUSE_SECRET_KEY="sk-lf-your-secret-key"
$env:LANGFUSE_BASE_URL="https://us.cloud.langfuse.com"

# Windows CMD:
set LANGFUSE_PUBLIC_KEY=pk-lf-your-public-key
set LANGFUSE_SECRET_KEY=sk-lf-your-secret-key
set LANGFUSE_BASE_URL=https://us.cloud.langfuse.com

# Linux/Mac:
export LANGFUSE_PUBLIC_KEY="pk-lf-your-public-key"
export LANGFUSE_SECRET_KEY="sk-lf-your-secret-key"
export LANGFUSE_BASE_URL="https://us.cloud.langfuse.com"
```

**方式2: 编辑配置文件**

1. 复制 `lib/runner/config.json.example` 为 `lib/runner/config.json`
2. 填写你的 Langfuse 密钥：
   - `LANGFUSE_PUBLIC_KEY`: 从 Langfuse 项目设置获取
   - `LANGFUSE_SECRET_KEY`: 从 Langfuse 项目设置获取
   - `LANGFUSE_BASE_URL`: Langfuse 实例地址（默认: https://us.cloud.langfuse.com）

### 其他配置

将 `langfuse/config.json` 中的 `test` / `online` 配置填入 `lib/runner/config.json`，或运行：

```bash
# 从 langfuse 复制 evaluator-prompts.json、toolsForValidation.json
npm run setup-runner
```

若使用带本地文件的数据集，需复制 `langfuse/evaluators/datas/dataset` 到 `lib/runner/evaluators/datas/dataset`。

## 目录结构

```
mira_evaluation/
  app/                    # Next.js 页面与 API
  lib/
    runner/               # 实验运行逻辑（从 langfuse 迁移）
      config/
      utils/
      evaluators/
      task.js
      chat-api-task.js
      run-experiment.js
      config.json
      evaluator-prompts.json
    options.ts
  scripts/setup-runner.js # 复制 langfuse 中的 JSON 等文件
```

## 依赖

已包含 @langfuse/client、@ai-sdk/deepseek、ai、pg、form-data、https-proxy-agent 等运行实验所需依赖。
