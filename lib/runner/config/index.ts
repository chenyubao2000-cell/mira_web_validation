import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { LangfuseClient } from "@langfuse/client";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { DatabaseClient } from "../database-client.js";
import logger from "../utils/logger.js";
import type { EnvConfig } from "../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNNER_ROOT = join(__dirname, "..");

if (!process.env.AI_SDK_SUPPRESS_WARNINGS) {
  process.env.AI_SDK_SUPPRESS_WARNINGS = "1";
}

const originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
  const msg = args.join(" ");
  if (msg.includes("specificationVersion") || msg.includes("compatibility mode")) return;
  originalWarn.apply(console, args);
};

interface ConfigFile {
  currentEnv: string;
  test: EnvConfig;
  online: EnvConfig;
  [key: string]: unknown;
}

interface EvaluatorPrompts {
  tool_call_evaluator?: {
    name: string;
    prompt: string | string[];
  };
  summary_generator?: {
    name: string;
    prompt: string | string[];
  };
  conversation_continuation_evaluator?: {
    name: string;
    prompt: string | string[];
  };
  comprehensive_evaluator?: {
    name: string;
    prompt: string | string[];
  };
  check_all_no_expected_output_evaluator?: {
    name: string;
    prompt: string | string[];
  };
}

const config = JSON.parse(readFileSync(join(RUNNER_ROOT, "config.json"), "utf-8")) as ConfigFile;
const evaluatorPrompts = JSON.parse(
  readFileSync(join(RUNNER_ROOT, "evaluator-prompts.json"), "utf-8")
) as EvaluatorPrompts;

const currentEnv = (process.env.MIRA_ENV || config.currentEnv || "test") as string;
const envVars = (config[currentEnv] || config.test) as EnvConfig;

// 优先使用环境变量，如果环境变量为空则使用配置文件中的值
// 但空字符串视为无效，需要重新配置
const getConfigValue = (envVar: string | undefined, configValue: string | undefined): string => {
  const envValue = process.env[envVar || ""];
  if (envValue && envValue.trim() !== "") return envValue;
  if (configValue && configValue.trim() !== "") return configValue;
  return "";
};

const langfusePublicKey = getConfigValue("LANGFUSE_PUBLIC_KEY", envVars?.LANGFUSE_PUBLIC_KEY);
const langfuseSecretKey = getConfigValue("LANGFUSE_SECRET_KEY", envVars?.LANGFUSE_SECRET_KEY);
const langfuseBaseUrl = getConfigValue("LANGFUSE_BASE_URL", envVars?.LANGFUSE_BASE_URL) || "https://us.cloud.langfuse.com";

const deepseekApiKey = getConfigValue("DEEPSEEK_API_KEY", envVars?.DEEPSEEK_API_KEY);
const deepseek = deepseekApiKey ? createDeepSeek({ apiKey: deepseekApiKey }) : null;

logger.info(`⚙️  配置环境: ${currentEnv.toUpperCase()}`);

// 验证 Langfuse 配置
if (!langfusePublicKey || !langfuseSecretKey) {
  logger.error("❌ Langfuse 配置缺失！");
  logger.error("请设置环境变量或配置 lib/runner/config.json:");
  logger.error("  - LANGFUSE_PUBLIC_KEY");
  logger.error("  - LANGFUSE_SECRET_KEY");
  logger.error("  - LANGFUSE_BASE_URL (可选，默认: https://us.cloud.langfuse.com)");
  process.exit(1);
}

const sdk = new NodeSDK({
  spanProcessors: [
    new LangfuseSpanProcessor({
      publicKey: langfusePublicKey,
      secretKey: langfuseSecretKey,
      baseUrl: langfuseBaseUrl,
      exportMode: "immediate",
    }),
  ],
});
sdk.start();

const langfuse = new LangfuseClient({
  secretKey: langfuseSecretKey,
  publicKey: langfusePublicKey,
  baseUrl: langfuseBaseUrl,
});

const databaseClient = new DatabaseClient(
  process.env.DATABASE_URL ||
    "postgresql://postgres:XUgQxjkYgvtBTeiGAwnWrSFnWpzyhyPo@switchback.proxy.rlwy.net:40072/railway"
);

export { config, evaluatorPrompts, currentEnv, envVars, deepseek, sdk, langfuse, databaseClient };
