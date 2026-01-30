import { sessionTracesCache } from "../../utils/data-storage.js";
import { mergeTracesObservations } from "../../utils/trace-helpers.js";
import { deepseek, evaluatorPrompts } from "../../config/index.js";
import { generateText } from "ai";
import { cleanControlChars } from "../../utils/helpers.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type { EvaluatorInput, EvaluatorResult } from "../../types.js";

// 读取工具验证配置文件
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const toolsForValidation = JSON.parse(
  readFileSync(join(__dirname, "../datas/toolsForValidation.json"), "utf-8")
) as {
  tools?: Array<{ name: string; [key: string]: unknown }>;
};

// Item-Level Evaluator: 工具名称，参数，参数值评估【根据工具申明的文档】
export const toolCallEvaluator = async ({ input, expectedOutput, output }: EvaluatorInput): Promise<EvaluatorResult> => {
  try {
    // 检查 output 是否为 {success: false, message: ...} 格式
    if (output && typeof output === "object" && "success" in output && output.success === false) {
      return {
        name: "tool_validation",
        value: 0,
        comment: JSON.stringify({
          error: (output as { message?: string }).message || "output success 为 false，跳过评估",
          toolCalls: [],
        }),
      };
    }

    // 如果 output 是 {success: true, message: finalOutput} 格式，提取 message
    let sessionId: string | null = null;
    if (
      output &&
      typeof output === "object" &&
      "success" in output &&
      output.success === true &&
      "message" in output &&
      "sessionId" in output
    ) {
      sessionId = (output as { sessionId: string }).sessionId;
    } else {
      console.error(`  ❌ [toolCallEvaluator] 未找到 session_id: output 格式不正确`);
      return {
        name: "tool_validation",
        value: 0,
        comment: JSON.stringify({ error: "未找到 session_id", toolCalls: [] }),
      };
    }

    // 如果 input 是字符串，尝试解析为 JSON；如果是对象，直接使用
    let parsedInput = input;
    if (typeof input === "string") {
      try {
        parsedInput = JSON.parse(input);
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        throw new Error(`  ⚠️  解析 input 失败: ${errorMessage}`);
      }
    }

    // 提取 question（用于评估提示语）
    const question =
      (parsedInput as { question?: string; text?: string })?.question ||
      (parsedInput as { question?: string; text?: string })?.text ||
      (typeof parsedInput === "string" ? parsedInput : "");

    // 获取多个 traces 的详情（优先从缓存读取）
    const traceDetailsList = sessionId ? sessionTracesCache.get(sessionId) : undefined;
    if (!traceDetailsList || traceDetailsList.length === 0) {
      console.error(`  ❌ [toolCallEvaluator] 未找到 Mira trace (sessionId: ${sessionId})`);
      return {
        name: "tool_validation",
        value: 0,
        comment: JSON.stringify({ error: "未找到 Mira trace", toolCalls: [] }),
      };
    }

    // 合并所有 traces 的 observations
    const allObservations = mergeTracesObservations(traceDetailsList);

    // 查找 ai.streamText.doStream 节点，提取工具调用信息
    const toolCalls: Array<{ toolName: string; toolCallId?: string | null; args: unknown }> = [];

    if (Array.isArray(allObservations) && allObservations.length > 0) {
      // 查找所有 ai.streamText.doStream 节点并按时间排序，取最后一个
      const doStreamNodes = allObservations.filter(
        (obs) => obs.name === "ai.streamText.doStream" || obs.name === "doStream"
      );

      const doStreamObsList = doStreamNodes.sort(
        (a, b) =>
          new Date(a.startTime as string | number).getTime() -
          new Date(b.startTime as string | number).getTime()
      );

      if (doStreamObsList.length > 0) {
        // 取最后一个（最新的）doStream 节点
        const doStreamObs = doStreamObsList[doStreamObsList.length - 1];

        try {
          // 从 doStreamObs.input 中解析对话历史
          if (doStreamObs.input) {
            const inputObj =
              typeof doStreamObs.input === "string" ? JSON.parse(doStreamObs.input) : doStreamObs.input;

            // 检查 input 是否包含 messages 数组（对话格式）
            let messages: Array<{ role?: string; content?: unknown }> = [];
            if (Array.isArray(inputObj)) {
              messages = inputObj;
            } else if (inputObj.messages && Array.isArray(inputObj.messages)) {
              messages = inputObj.messages;
            }

            if (messages.length > 0) {
              // 从 role: "assistant" 的消息中提取工具调用（type: "tool-call"）
              for (const message of messages) {
                if (message.role === "assistant") {
                  // content 可能是字符串、对象或数组
                  let contentArray: unknown[] = [];
                  if (Array.isArray(message.content)) {
                    contentArray = message.content;
                  } else if (typeof message.content === "object" && message.content !== null) {
                    contentArray = [message.content];
                  }

                  // 在 content 数组中查找 type: "tool-call" 的对象
                  for (const contentItem of contentArray) {
                    if (
                      typeof contentItem === "object" &&
                      contentItem !== null &&
                      "type" in contentItem &&
                      contentItem.type === "tool-call"
                    ) {
                      const toolName = (contentItem as { toolName?: string }).toolName || "unknown";
                      const toolCallId = (contentItem as { toolCallId?: string | null }).toolCallId || null;
                      const input = (contentItem as { input?: unknown }).input || {};

                      toolCalls.push({
                        toolName: toolName,
                        toolCallId: toolCallId,
                        args: cleanControlChars(input),
                      });
                    }
                  }
                }
              }
            }
          }
        } catch (e) {
          const errorMessage = e instanceof Error ? e.message : String(e);
          console.error(`  ❌ [toolCallEvaluator] 解析 doStream 节点失败: ${errorMessage}`);
        }
      }
    }

    // 构建结果 JSON（只包含工具调用列表）
    const resultJson = {
      toolCalls: toolCalls.map((tc) => ({
        toolName: tc.toolName,
        args: tc.args,
      })),
    };

    // 实际工具调用：从 trace 中提取（trace 记录了模型实际执行的工具调用）
    const actualToolCalls = resultJson.toolCalls;

    // 如果没有实际工具调用，直接返回
    if (!actualToolCalls || actualToolCalls.length === 0) {
      console.warn(`  ⚠️  [toolCallEvaluator] 无实际工具调用 (sessionId: ${sessionId})`);
      return {
        name: "tool_validation",
        value: 0,
        comment: JSON.stringify({ error: "无实际工具调用", toolCalls: [] }),
      };
    }

    // 如果配置了 DeepSeek，使用 DeepSeek 评估工具调用
    if (deepseek) {
      try {
        // 准备评估提示语
        const promptConfig = evaluatorPrompts.tool_call_evaluator;
        if (!promptConfig) {
          console.error(`  ❌ [toolCallEvaluator] 未找到工具调用评估器提示语配置`);
          return {
            name: "tool_validation",
            value: 0,
            comment: "未找到工具调用评估器提示语配置",
          };
        }

        // 支持数组格式的 prompt（自动换行），如果是数组则合并为字符串
        const promptText = Array.isArray(promptConfig.prompt)
          ? promptConfig.prompt.join("\n")
          : promptConfig.prompt;

        // 循环评估每个工具调用
        const toolEvaluationResults: Array<{ toolName: string; score: number; reason: string }> = [];

        for (let i = 0; i < actualToolCalls.length; i++) {
          const actualToolCall = actualToolCalls[i];
          const toolName = actualToolCall.toolName;

          // 从 toolsForValidation.json 中查找工具详情
          const toolDefinition = toolsForValidation.tools?.find((t) => t.name === toolName);

          if (!toolDefinition) {
            console.warn(`  ⚠️  [toolCallEvaluator] 未找到工具 ${toolName} 的定义`);
            toolEvaluationResults.push({
              toolName: toolName,
              score: 0,
              reason: `未找到工具定义`,
            });
            continue;
          }

          // 构建单个工具调用的评估提示
          // 只传入当前工具调用和工具定义
          const singleToolCallForPrompt = JSON.stringify([actualToolCall], null, 2);
          const toolDefinitionForPrompt = JSON.stringify(toolDefinition, null, 2);

          // 构建包含工具定义的提示语
          // 在提示语开始处添加工具定义，让评估器知道工具的标准格式
          let prompt = `[Tool Definition - Standard Format]\n${toolDefinitionForPrompt}\n\n`;
          prompt += promptText
            .replace("{{question}}", question)
            .replace("{{expectedToolCalls}}", "[]") // 单个工具评估时不使用期望工具调用
            .replace("{{actualToolCalls}}", singleToolCallForPrompt);

          // 调用 DeepSeek API
          const result = await generateText({
            model: deepseek("deepseek-chat"),
            prompt: prompt,
            temperature: 0.3,
          });

          // 解析 JSON 响应
          let evaluationResult: { score?: number; reason?: string };
          try {
            const text = result.text.trim();
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              evaluationResult = JSON.parse(jsonMatch[0]);
            } else {
              evaluationResult = JSON.parse(text);
            }
          } catch (parseError) {
            const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
            console.error(`  ❌ [toolCallEvaluator] 解析工具 ${toolName} 评估结果失败: ${errorMessage}`);
            toolEvaluationResults.push({
              toolName: toolName,
              score: 0,
              reason: `解析评估结果失败: ${errorMessage}`,
            });
            continue;
          }

          // 从 JSON 中提取 score 和 reason
          const score = evaluationResult?.score ?? 0;
          const reason = evaluationResult?.reason ?? "无说明";

          toolEvaluationResults.push({
            toolName: toolName,
            score: score,
            reason: reason,
          });
        }

        // 计算平均得分
        const totalScore = toolEvaluationResults.reduce((sum, r) => sum + r.score, 0);
        const averageScore =
          toolEvaluationResults.length > 0 ? Math.round(totalScore / toolEvaluationResults.length) : 0;

        // 构建 comments，包含每个工具的得分和理由
        const commentParts = toolEvaluationResults.map(
          (r, idx) => `${idx + 1}. ${r.toolName}: ${r.score}/100 - ${r.reason}`
        );
        const comment = `平均得分: ${averageScore}/100\n\n各工具评估详情:\n${commentParts.join("\n")}`;

        const toolsSummary = toolEvaluationResults.map((r) => `${r.toolName}:${r.score}/100`).join(", ");
        console.log(`  📊 [阶段5] toolCallEvaluator: 平均得分 ${averageScore}/100 | ${toolsSummary}`);

        return {
          name: "tool_validation",
          value: averageScore,
          comment: comment,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`  ❌ [toolCallEvaluator] DeepSeek 评估失败: ${errorMessage}`);
        return {
          name: "tool_validation",
          value: 0,
          comment: `评估失败: ${errorMessage}`,
        };
      }
    } else {
      console.error(`  ❌ [toolCallEvaluator] DeepSeek API Key 未配置，未进行评估`);
      return {
        name: "tool_validation",
        value: 0,
        comment: "DeepSeek API Key 未配置，未进行评估",
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`  ❌ [toolCallEvaluator] 评估失败: ${errorMessage}`);
    return {
      name: "tool_validation",
      value: 0,
      comment: `评估失败: ${errorMessage}`,
    };
  }
};

// Item-Level Evaluator: 统计对话轮数
export const nTurnsEvaluator = async ({ input, output }: EvaluatorInput): Promise<EvaluatorResult> => {
  try {
    // 检查 output 是否为 {success: false, message: ...} 格式
    if (output && typeof output === "object" && "success" in output && output.success === false) {
      return {
        name: "n_turns",
        value: 0,
        comment: (output as { message?: string }).message || "output success 为 false，跳过评估",
      };
    }

    // 如果 output 是 {success: true, message: finalOutput} 格式，提取 message
    let sessionId: string | null = null;
    if (
      output &&
      typeof output === "object" &&
      "success" in output &&
      output.success === true &&
      "message" in output &&
      "sessionId" in output
    ) {
      sessionId = (output as { sessionId: string }).sessionId;
    } else {
      console.error(`  ❌ [nTurnsEvaluator] 未找到 session_id: output 格式不正确`);
      return {
        name: "n_turns",
        value: 0,
        comment: "未找到 session_id",
      };
    }

    // 获取多个 traces 的详情（优先从缓存读取）
    const traceDetailsList = sessionId ? sessionTracesCache.get(sessionId) : undefined;
    if (!traceDetailsList || traceDetailsList.length === 0) {
      console.error(`  ❌ [nTurnsEvaluator] 未找到 Mira trace (sessionId: ${sessionId})`);
      return {
        name: "n_turns",
        value: 0,
        comment: "未找到 Mira trace",
      };
    }

    // 合并所有 traces 的 observations
    const allObservations = mergeTracesObservations(traceDetailsList);

    // 统计对话轮数（用户消息数量）
    let userMessageCount = 0;

    if (Array.isArray(allObservations) && allObservations.length > 0) {
      // 查找所有 ai.streamText.doStream 节点并按时间排序，取最后一个
      const doStreamNodes = allObservations.filter((obs) => obs.name === "ai.streamText.doStream");

      if (doStreamNodes.length > 0) {
        const doStreamObsList = doStreamNodes.sort(
          (a, b) =>
            new Date(a.startTime as string | number).getTime() -
            new Date(b.startTime as string | number).getTime()
        );
        const doStreamObs = doStreamObsList[doStreamObsList.length - 1];

        try {
          // 从 doStreamObs.input 中解析对话历史
          if (doStreamObs.input) {
            const inputObj =
              typeof doStreamObs.input === "string" ? JSON.parse(doStreamObs.input) : doStreamObs.input;

            // 检查 input 是否包含 messages 数组（对话格式）
            let messages: Array<{ role?: string }> = [];
            if (Array.isArray(inputObj)) {
              messages = inputObj;
            } else if (inputObj.messages && Array.isArray(inputObj.messages)) {
              messages = inputObj.messages;
            }

            // 统计 role 为 'user' 的消息数量
            userMessageCount = messages.filter((msg) => msg.role === "user").length;
          }
        } catch (e) {
          const errorMessage = e instanceof Error ? e.message : String(e);
          console.error(`  ❌ [nTurnsEvaluator] 解析 doStream 节点失败: ${errorMessage}`);
        }
      }
    }

    console.log(`  📊 [阶段5] nTurnsEvaluator: ${userMessageCount} 轮`);

    return {
      name: "n_turns",
      value: userMessageCount,
      comment: `对话轮数: ${userMessageCount} 轮`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`  ❌ [nTurnsEvaluator] 评估失败: ${errorMessage}`);
    return {
      name: "n_turns",
      value: 0,
      comment: `评估失败: ${errorMessage}`,
    };
  }
};
