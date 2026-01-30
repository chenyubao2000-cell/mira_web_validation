import { config, currentEnv, deepseek, evaluatorPrompts } from "../config/index.js";
import { generateText } from "ai";
import type { EnvConfig } from "../types.js";

export function getEnvConfig(env?: string): EnvConfig {
  const envName = env || currentEnv;
  return (config[envName] || config.test) as EnvConfig;
}

export async function generateSummary(content: string): Promise<string> {
  if (!deepseek) {
    return content.length > 500 ? content.substring(0, 500) + "... (内容过长，已截断)" : content;
  }
  try {
    const promptConfig = evaluatorPrompts.summary_generator;
    if (!promptConfig) {
      return content.length > 500 ? content.substring(0, 500) + "... (内容过长，已截断)" : content;
    }
    const promptText = Array.isArray(promptConfig.prompt) ? promptConfig.prompt.join("\n") : promptConfig.prompt;
    const prompt = promptText.replace("{{content}}", content);
    
    console.log(`  🤖 使用模型生成摘要 (原始长度: ${content.length} 字符)...`);
    
    const result = await generateText({ model: deepseek("deepseek-chat"), prompt, temperature: 0.3 });
    
    const summary = result.text.trim();
    console.log(`  ✅ 摘要生成完成 (摘要长度: ${summary.length} 字符)`);
    
    return summary;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log(`  ⚠️  生成摘要失败: ${errorMessage}，使用截断方式`);
    return content.length > 500 ? content.substring(0, 500) + "... (内容过长，已截断)" : content;
  }
}

export function cleanControlChars<T>(obj: T): T {
  if (typeof obj === "string") {
    // 移除控制字符（ASCII 0-31），但保留常见的换行符(\n)、回车符(\r)、制表符(\t)
    return obj.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F]/g, "") as T;
  } else if (Array.isArray(obj)) {
    return obj.map((item) => cleanControlChars(item)) as T;
  } else if (obj !== null && typeof obj === "object") {
    const cleaned = {} as Record<string, unknown>;
    for (const key in obj) {
      if ((obj as Record<string, unknown>).hasOwnProperty(key)) {
        cleaned[key] = cleanControlChars((obj as Record<string, unknown>)[key]);
      }
    }
    return cleaned as T;
  }
  return obj;
}
