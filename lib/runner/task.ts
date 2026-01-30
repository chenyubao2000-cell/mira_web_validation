import { createTask, sendRequest, uploadFile } from "./chat-api-task.js";
import { getEnvConfig } from "./utils/helpers.js";
import { currentEnv } from "./config/index.js";
import { inputSessionMap, sessionTracesCache } from "./utils/data-storage.js";
import { findMiraTrace, waitForTraceCompletion } from "./utils/trace-helpers.js";
import { isSessionEnded, shouldContinueConversation } from "./utils/conversation-helpers.js";
import logger from "./utils/logger.js";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import type { TaskOutput, ConversationMessage, ConfirmationMessage } from "./types.js";
import type { ExperimentTaskParams } from "@langfuse/client";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNNER_ROOT = join(__dirname);

/** 将 dataset 中的文件路径解析为绝对路径（相对于 runner 根目录） */
function resolveFilePath(filePath: string | undefined | null): string | null {
  if (!filePath || typeof filePath !== "string") return filePath || null;
  if (filePath.startsWith("/") || /^[A-Za-z]:/.test(filePath)) return filePath;
  return join(RUNNER_ROOT, filePath);
}

export const myTask = async (params: ExperimentTaskParams): Promise<TaskOutput> => {
  const item = params as any; // ExperimentTaskParams 包含所有需要的字段
  let taskId: string | null = null;
  try {
    const itemId = item.id || item.datasetItemId || "unknown";
    let currentMessage: string | null = null;
    let fileValue: string | string[] | undefined = undefined;
    const parsedInput = item.input;

    // 处理不同类型的 input
    if (parsedInput && typeof parsedInput === "object") {
      const inputObj = parsedInput as Record<string, unknown>;
      fileValue = inputObj.files as string | string[] | undefined;
      currentMessage = (inputObj.question || inputObj.text) as string | null;
    } else if (typeof parsedInput === "string") {
      currentMessage = parsedInput;
    }

    if (!currentMessage?.trim()) {
      logger.error(`❌ [Item ${itemId}] 问题为空，跳过`);
      return { sessionId: null, success: false, message: "问题为空" };
    }

    logger.info(
      `\n📋 [Item ${itemId}] 开始处理 | 问题: ${currentMessage.substring(0, 50)}${currentMessage.length > 50 ? "..." : ""}`
    );

    let filePaths: string[] = [];
    if (fileValue != null) {
      filePaths = Array.isArray(fileValue) ? fileValue : [fileValue];
      filePaths = filePaths.map(resolveFilePath).filter((p): p is string => p !== null);
      
      // 验证文件是否存在
      const missingFiles: string[] = [];
      for (const filePath of filePaths) {
        if (!existsSync(filePath)) {
          missingFiles.push(filePath);
        }
      }
      
      if (missingFiles.length > 0) {
        logger.warn(`  ⚠️  以下文件不存在，将跳过:`);
        missingFiles.forEach((f) => logger.warn(`    - ${f}`));
        logger.warn(`  提示: 请运行 'npm run setup-runner' 或手动从 langfuse/evaluators/datas/dataset 复制文件到 lib/runner/evaluators/datas/dataset`);
        // 过滤掉不存在的文件
        filePaths = filePaths.filter((p) => !missingFiles.includes(p));
      }
      
      logger.info(`  📎 文件: ${filePaths.length} 个${missingFiles.length > 0 ? ` (${missingFiles.length} 个文件缺失)` : ""}`);
    }

    const envData = getEnvConfig(currentEnv);
    taskId = await createTask(envData);
    if (!taskId) {
      logger.error("  ❌ 创建 task 失败");
      return { sessionId: null, success: false, message: "创建 task 失败" };
    }
    logger.info(`  ✅ Task 已创建: ${taskId}`);

    let turnCount = 0;
    const maxTurns = 4;
    let finalOutput: string = "";
    const conversationHistory: ConversationMessage[] = [];
    let uploadedFileUrls: string[] = [];

    while (turnCount < maxTurns) {
      turnCount++;
      logger.info(`  🔄 [Turn ${turnCount}/${maxTurns}] 发送消息`);

      // 第一轮上传文件
      const filePathsToSend = turnCount === 1 ? filePaths : [];
      
      if(turnCount>1){
        uploadedFileUrls=[];
      }

      for (const filePath of filePathsToSend) {
        const resp = await uploadFile(filePath, envData, taskId);
        if (resp === null) {
          logger.error("  ❌ 文件上传失败");
          return { sessionId: taskId, success: false, message: "上传文件失败" };
        }
        if (resp.success && Array.isArray(resp.files)) {
          for (const f of resp.files) {
            if (f.path) uploadedFileUrls.push(f.path);
          }
        }
      }

      const uploadedFilesText =
        uploadedFileUrls.length > 0
          ? uploadedFileUrls.map((p) => `[Uploaded File: ${p}]`).join("\n")
          : "";
      const messageToSend = uploadedFilesText ? `${currentMessage}\n\n${uploadedFilesText}` : currentMessage;

      const response = await sendRequest(taskId, messageToSend, envData);
      if (response === null) {
        logger.error("  ❌ 网络错误，停止对话");
        return { sessionId: taskId, success: false, message: "网络错误" };
      }

      // 阶段2: 对话内容
      logger.info(`  💬 [阶段2] 对话内容:`);
      logger.info(`    👤 用户: ${currentMessage.substring(0, 100)}${currentMessage.length > 100 ? "..." : ""}`);

      let responseText = "";
      let toolCallId: string | null = null;
      let messageId: string | null = null;
      let messageCreatedAt: string | null = null;
      let askForConfirmationTool = false;

      if (typeof response === "object" && response !== null) {
        responseText = (response as { message?: string }).message || "";
        toolCallId = (response as { toolCallId?: string }).toolCallId || null;
        messageId = (response as { messageId?: string }).messageId || null;
        messageCreatedAt = (response as { messageCreatedAt?: string }).messageCreatedAt || null;
        askForConfirmationTool = (response as { askForConfirmationTool?: boolean }).askForConfirmationTool || false;
        logger.info(`    🔧 收到工具调用响应`);
        
        // 记录对话历史
        conversationHistory.push({ 
          role: "user", 
          content: currentMessage,
          turn: turnCount 
        });
        
        if (!askForConfirmationTool) {
          conversationHistory.push({ 
            role: "assistant", 
            content: responseText,
            turn: turnCount
          });
        } else {
          conversationHistory.push({ 
            role: "assistant", 
            content: responseText,
            turn: turnCount,
            toolCallId: toolCallId ?? undefined
          });
        }

        logger.info(`    🤖 助手: ${responseText.substring(0, 100)}${responseText.length > 100 ? "..." : ""}`);

        if (toolCallId && messageId && messageCreatedAt) {
          turnCount++;
          logger.info(`  🔧 [Turn ${turnCount}/${maxTurns}] 发送工具调用确认`);
          const confirmationMessage: ConfirmationMessage = {
            toolCallId,
            messageId,
            messageCreatedAt,
            textContent: responseText,
          };
          
          logger.info(`  💬 [阶段2] 工具调用确认:`);
          logger.info(`    👤 用户: 确认执行`);
          
          const confirmationResponse = await sendRequest(taskId, confirmationMessage, envData);
          if (confirmationResponse === null) {
            logger.error("  ❌ 工具调用确认时网络错误");
            return { sessionId: taskId, success: false, message: "工具调用确认时网络错误" };
          }
          if (confirmationResponse) {
            await new Promise((r) => setTimeout(r, 5000));
            let confirmationResponseText = "";
            if (typeof confirmationResponse === "object" && confirmationResponse !== null) {
              confirmationResponseText = (confirmationResponse as { message?: string }).message || "";
            } else {
              confirmationResponseText = (confirmationResponse as string) || "";
            }
            
            if (confirmationResponseText && confirmationResponseText.trim().length > 0) {
              conversationHistory.push({ 
                role: "user", 
                content: "确认执行",
                turn: turnCount,
              });
              conversationHistory.push({ 
                role: "assistant", 
                content: confirmationResponseText,
                turn: turnCount,
                isToolExecutionResult: true
              });
              finalOutput = confirmationResponseText;
              
              logger.info(`  💬 [阶段2] 工具执行结果:`);
              logger.info(`    👤 用户: 确认执行`);
              logger.info(`    🤖 助手: ${confirmationResponseText.substring(0, 100)}${confirmationResponseText.length > 100 ? "..." : ""}`);
            }
          } else {
            logger.warn("  ⚠️  工具调用确认失败");
            break;
          }
        }
      } else {
        responseText = (response as string) || "";
        conversationHistory.push({ role: "user", content: currentMessage, turn: turnCount });
        conversationHistory.push({ role: "assistant", content: responseText, turn: turnCount });
        
        logger.info(`    🤖 助手: ${responseText.substring(0, 100)}${responseText.length > 100 ? "..." : ""}`);
      }

      if (!responseText?.trim()) {
        logger.warn("  ⚠️  无响应，停止对话");
        break;
      }
      finalOutput = responseText;

      // 阶段3: 检查会话是否结束
      logger.info(`  📊 [阶段3] 检查会话是否结束...`);
      const sessionStatus = await isSessionEnded(taskId, turnCount);
      let llmDecision = {
        taskCompleted: true,
        shouldContinue: false,
        nextMessage: "",
        reason: "会话已结束",
      };

      if (sessionStatus?.ended) {
        logger.info(`    ✅ [阶段3] 会话已结束: ${sessionStatus.reason}`);
        
        // 阶段4: 使用 LLM 判断是否还需要继续对话
        logger.info(`  🤖 [阶段4] LLM 判断是否继续对话...`);
        llmDecision = await shouldContinueConversation(currentMessage, conversationHistory, responseText);
        
        if (llmDecision.taskCompleted || !llmDecision.shouldContinue) {
          logger.info(`    ✅ [阶段4] 任务完成，停止对话 | 理由: ${llmDecision.reason}`);
          break;
        } else {
          logger.info(`    🔄 [阶段4] 需要继续对话 | 下一步: ${llmDecision.nextMessage.substring(0, 50)}... | 理由: ${llmDecision.reason}`);
          currentMessage = llmDecision.nextMessage;
          continue;
        }
      } else {
        logger.warn(`    ⚠️  [阶段3] 会话未正常结束: ${sessionStatus?.reason || "未知原因"}`);
        return { sessionId: taskId, success: false, message: "会话未正常结束" };
      }
    }

    if (turnCount >= maxTurns) {
      logger.warn(`  ⚠️  达到最大轮数限制 (${maxTurns})`);
      return { sessionId: taskId, success: false, message: "达到最大轮数限制，停止对话" };
    }

    logger.info(`  ✅ 对话完成 | 轮数: ${turnCount} | 响应长度: ${finalOutput.length} 字符`);

    // 存储 session_id
    inputSessionMap.set(JSON.stringify(parsedInput), taskId);

    // 缓存 traces
    const allTraces = await findMiraTrace(taskId, 1, 3, 0);
    if (allTraces?.length && allTraces.length > 0) {
      const traceDetailsList = [];
      for (let i = 0; i < allTraces.length; i++) {
        const trace = allTraces[i];
        const detail = await waitForTraceCompletion(trace, "    ");
        if (detail) {
          traceDetailsList.push(detail);
        } else {
          logger.warn(`  ⚠️  Trace ${i + 1}/${allTraces.length} 等待完成失败`);
        }
      }
      
      if (traceDetailsList.length > 0) {
        sessionTracesCache.set(taskId, traceDetailsList);
        const totalObservations = traceDetailsList.reduce((sum, td) => sum + (td.observations?.length || 0), 0);
        logger.info(`  📊 Traces 已缓存 | ${traceDetailsList.length} traces, ${totalObservations} observations`);
      } else {
        logger.warn(`  ⚠️  所有 traces 等待完成失败，无法缓存`);
      }
    } else {
      logger.warn(`  ⚠️  未找到 traces，无法缓存`);
    }

    return { sessionId: taskId, success: true, message: finalOutput };
  } catch (error) {
    const itemId = item?.id || item?.datasetItemId || "unknown";
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`  ❌ [Item ${itemId}] 处理失败: ${errorMessage}`);
    return { sessionId: taskId || null, success: false, message: "处理 item 时发生错误" };
  }
};
