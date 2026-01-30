import { deepseek, evaluatorPrompts } from "../config/index.js";
import { generateText } from "ai";
import { findMiraTrace } from "./trace-helpers.js";
import { generateSummary } from "./helpers.js";
import type { ConversationMessage } from "../types.js";

export interface SessionStatus {
  ended: boolean;
  reason: string;
}

export interface ConversationDecision {
  taskCompleted: boolean;
  shouldContinue: boolean;
  nextMessage: string;
  reason: string;
}

export async function isSessionEnded(taskId: string, turnCount: number): Promise<SessionStatus> {
  try {
    let tracesCount = 0;
    const miraTraces = await findMiraTrace(taskId, 18, 10, turnCount);
    if (!miraTraces || miraTraces.length === 0) {
      return { ended: false, reason: "未找到 trace" };
    }
    
    tracesCount = miraTraces.length;
    if (tracesCount === turnCount) {
      return {
        ended: true,
        reason: `找到 ${tracesCount} 个 traces，等于 turnCount ${turnCount}`,
      };
    } else {
      return {
        ended: false,
        reason: `traces 数量 (${tracesCount}) 不等于 turnCount (${turnCount})`,
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`  ❌ [isSessionEnded] 检查失败: ${errorMessage}`);
    return { ended: false, reason: `错误: ${errorMessage}` };
  }
}

export async function shouldContinueConversation(
  question: string,
  conversationHistory: ConversationMessage[],
  lastResponse: string
): Promise<ConversationDecision> {
  if (!deepseek) {
    return { taskCompleted: false, shouldContinue: false, nextMessage: "请继续完成任务", reason: "DeepSeek 未配置" };
  }
  try {
    const historySummaryPromises = conversationHistory
      .slice(-6)
      .map(async (msg) => {
        const roleName = msg.role === "user" ? "用户" : "助手";
        let content = msg.content;
        if (content.length > 500) content = await generateSummary(content);
        return `${roleName}: ${content}`;
      });
    const historySummary = (await Promise.all(historySummaryPromises)).join("\n");
    const promptConfig = evaluatorPrompts.conversation_continuation_evaluator;
    if (!promptConfig) {
      return { taskCompleted: false, shouldContinue: false, nextMessage: "请继续完成任务", reason: "未找到提示语配置" };
    }
    let processedLastResponse = lastResponse;
    if (lastResponse.length > 500) processedLastResponse = await generateSummary(lastResponse);
    const promptText = Array.isArray(promptConfig.prompt) ? promptConfig.prompt.join("\n") : promptConfig.prompt;
    const prompt = promptText
      .replace("{{question}}", question)
      .replace("{{historySummary}}", historySummary || "无")
      .replace("{{lastResponse}}", processedLastResponse);
    const result = await generateText({ model: deepseek("deepseek-chat"), prompt, temperature: 0.3 });
    let decision: ConversationDecision;
    try {
      const text = result.text.trim();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      decision = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(text);
    } catch (parseError) {
      const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
      console.error(`  ❌ [shouldContinueConversation] 解析 LLM 响应失败: ${errorMessage}`);
      return {
        taskCompleted: false,
        shouldContinue: false,
        nextMessage: "请继续完成任务",
        reason: `解析失败: ${errorMessage}`,
      };
    }
    return {
      shouldContinue: decision.shouldContinue !== false,
      nextMessage: decision.nextMessage || "请继续完成任务",
      taskCompleted: decision.taskCompleted === true,
      reason: decision.reason || "无理由",
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`  ❌ [shouldContinueConversation] LLM 判断失败: ${errorMessage}`);
    return {
      taskCompleted: false,
      shouldContinue: false,
      nextMessage: "请继续完成任务",
      reason: `判断失败: ${errorMessage}`,
    };
  }
}
