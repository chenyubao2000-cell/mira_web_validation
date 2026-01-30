import https from "https";
import { HttpsProxyAgent } from "https-proxy-agent";
import { readFileSync, createReadStream } from "fs";
import { join, dirname, extname, basename } from "path";
import { fileURLToPath } from "url";
import FormData from "form-data";
import logger from "./utils/logger.js";
import type { EnvConfig, SendRequestResponse, ConfirmationMessage } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(__dirname, "config.json"), "utf-8")) as {
  currentEnv: string;
  test: EnvConfig;
  online: EnvConfig;
  [key: string]: unknown;
};

function getEnvConfig(env?: string): EnvConfig {
  const targetEnv = env || process.env.MIRA_ENV || config.currentEnv || "test";
  const envData = config[targetEnv] as EnvConfig | undefined;
  return envData ? { env: targetEnv, ...envData } : config.test;
}

const defaultConfig = getEnvConfig();

function generateRandomId(length = 16): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < length; i++) result += chars[Math.floor(Math.random() * chars.length)];
  return result;
}

function getProxyAgent(envData: EnvConfig | null = null): HttpsProxyAgent<string> | null {
  const proxy =
    (envData && envData.PROXY_URL) ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy;
  
  if (proxy && proxy !== "null" && proxy !== "") {
    try {
      const agentOptions = {
        rejectUnauthorized: false,
        timeout: 60000,
        keepAlive: true,
        checkServerIdentity: () => undefined,
      };
      
      try {
        return new HttpsProxyAgent(proxy, agentOptions);
      } catch (agentError) {
        try {
          return new HttpsProxyAgent(proxy, {
            rejectUnauthorized: false,
            timeout: 60000,
          });
        } catch (simpleError) {
          return new HttpsProxyAgent(proxy);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`  ❌ [getProxyAgent] 创建代理失败: ${errorMessage}`);
      return null;
    }
  }
  
  return null;
}

function buildHeaders(envData: EnvConfig, taskId: string | null = null): Record<string, string> {
  const apiUrl = envData.MIRA_API_URL;
  const sessionToken = envData.MIRA_SESSION_TOKEN;
  const referer = taskId ? `${apiUrl}/task/${taskId}` : `${apiUrl}/dashboard`;
  return {
    accept: "*/*",
    "accept-language": "zh-CN,zh;q=0.9",
    "cache-control": "no-cache",
    "content-type": "application/json",
    cookie: `NEXT_LOCALE=zh; user_invite_code=mira2025; __Secure-better-auth.session_token=${sessionToken}`,
    origin: apiUrl,
    pragma: "no-cache",
    referer,
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
  };
}

function getMediaType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const mime: Record<string, string> = {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".html": "text/html",
    ".py": "text/x-python",
    ".js": "text/javascript",
    ".ts": "text/typescript",
    ".java": "text/x-java-source",
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".json": "application/json",
    ".xml": "application/xml",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
  };
  return mime[ext] || "text/plain";
}

export function createTask(envData: EnvConfig | null = null): Promise<string | null> {
  const currentEnv = envData || defaultConfig;
  const apiUrl = currentEnv.MIRA_API_URL;
  const hostname = new URL(apiUrl).hostname;
  return new Promise((resolve) => {
    const data = { first_message: "你好" };
    const postData = JSON.stringify(data);
    const headers = buildHeaders(currentEnv);
    headers["content-length"] = Buffer.byteLength(postData).toString();
    const options: https.RequestOptions = {
      hostname,
      path: "/api/tasks",
      method: "POST",
      headers,
      timeout: 1800000,
      agent: getProxyAgent(currentEnv) || undefined,
    };
    const req = https.request(options, (res) => {
      let responseData = "";
      res.on("data", (chunk) => (responseData += chunk.toString()));
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = JSON.parse(responseData) as { id?: string };
            resolve(parsed.id || null);
          } catch (e) {
            logger.error(`  ❌ 创建 task 失败: 解析响应错误`);
            resolve(null);
          }
        } else {
          logger.error(`  ❌ 创建 task 失败: 状态码 ${res.statusCode}`);
          resolve(null);
        }
      });
    });
    req.on("error", (error) => {
      logger.error(`  ❌ 创建 task 失败: ${error.message}`);
      resolve(null);
    });
    req.on("timeout", () => {
      logger.error(`  ❌ 创建 task 失败: 请求超时`);
      req.destroy();
      resolve(null);
    });
    req.write(postData);
    req.end();
  });
}

export function uploadFile(
  filePath: string,
  envData: EnvConfig | null = null,
  taskId: string | null = null
): Promise<{ success: boolean; files?: Array<{ path?: string }> } | null> {
  const currentEnv = envData || defaultConfig;
  const apiUrl = currentEnv.MIRA_API_URL;
  const hostname = new URL(apiUrl).hostname;
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append("files", createReadStream(filePath), {
      filename: basename(filePath),
      contentType: getMediaType(filePath),
    });
    let uploadPath = "/api/files/upload";
    if (taskId) uploadPath += `?taskId=${encodeURIComponent(taskId)}`;
    const headers = buildHeaders(currentEnv);
    delete headers["content-type"];
    Object.assign(headers, formData.getHeaders());
    const options: https.RequestOptions = {
      hostname,
      path: uploadPath,
      method: "POST",
      headers,
      timeout: 60000,
      agent: getProxyAgent(currentEnv) || undefined,
    };
    const req = https.request(options, (res) => {
      let responseData = "";
      res.on("data", (chunk) => (responseData += chunk.toString()));
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(responseData) as { success: boolean; files?: Array<{ path?: string }> });
          } catch (e) {
            logger.error(`  ❌ 文件上传失败: 解析响应错误`);
            resolve(null);
          }
        } else {
          logger.error(`  ❌ 文件上传失败: 状态码 ${res.statusCode}`);
          reject(new Error(`上传失败: ${res.statusCode}`));
        }
      });
    });
    req.on("error", (error) => {
      logger.error(`  ❌ 文件上传失败: ${error.message}`);
      reject(error);
    });
    req.on("timeout", () => {
      logger.error(`  ❌ 文件上传失败: 请求超时`);
      req.destroy();
      reject(new Error("请求超时"));
    });
    formData.pipe(req);
  });
}

export function sendRequest(
  taskId: string,
  message: string | ConfirmationMessage = "你好",
  envData: EnvConfig | null = null
): Promise<string | SendRequestResponse | null> {
  const currentEnv = envData || defaultConfig;
  const apiUrl = currentEnv.MIRA_API_URL;
  const hostname = new URL(apiUrl).hostname;

  return new Promise((resolve) => {
    logger.info("    ⏳ [阶段1] 等待响应中...");
    let waitTime = 0;
    let charCount = 0;
    let lastUpdateTime = Date.now();
    const progressInterval = setInterval(() => {
      waitTime += 5;
      if (charCount > 0) {
        // 如果已经开始接收数据，显示接收状态
        process.stdout.write(`\r    ⏳ [阶段1] 接收中... ${charCount} 字符 | ${waitTime}秒 `);
      } else {
        // 如果还没开始接收数据，显示等待状态
        process.stdout.write(`\r    ⏳ [阶段1] 等待响应中... ${waitTime}秒 `);
      }
    }, 5000);

    let data: Record<string, unknown>;
    if (typeof message === "object" && message !== null && "toolCallId" in message) {
      const msg = message as ConfirmationMessage;
      data = {
        trigger: "submit-message",
        id: taskId,
        message: {
          id: msg.messageId,
          metadata: { createdAt: msg.messageCreatedAt },
          role: "assistant",
          parts: [
            { type: "step-start" },
            { type: "text", text: msg.textContent || "", state: "done" },
            {
              type: "tool-confirm",
              toolCallId: msg.toolCallId,
              state: "output-available",
              input: { message: msg.textContent || "" },
              output: "Yes, confirmed.",
            },
          ],
        },
        messageId: msg.messageId,
      };
    } else {
      const parts =
        message && typeof message === "string" && message.trim()
          ? [{ type: "text", text: message }]
          : [{ type: "text", text: "你好" }];
      data = {
        model: "anthropic/claude-sonnet-4.5",
        webSearch: false,
        trigger: "submit-message",
        id: taskId,
        message: { parts, id: generateRandomId(), role: "user" },
      };
    }

    const postData = JSON.stringify(data);
    const headers = buildHeaders(currentEnv, taskId);
    headers["content-length"] = Buffer.byteLength(postData).toString();

    const options: https.RequestOptions = {
      hostname,
      path: "/api/task",
      method: "POST",
      headers,
      timeout: 1800000,
      agent: getProxyAgent(currentEnv) || undefined,
    };

    const req = https.request(options, (res) => {
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
        clearInterval(progressInterval);
        
        // 处理流式响应（SSE），提取 text-delta 和工具调用信息
        let fullMessage = "";
        let buffer = "";
        let charCount = 0;
        let finishReason: string | null = null;
        let askForConfirmationTool = false;
        let toolCallId: string | null = null;
        let messageId: string | null = null;
        let messageCreatedAt: string | null = null;
        let hasReceivedData = false;
        let dataTimeout: NodeJS.Timeout | null = null;
        let charUpdateStartTime: number | null = null;
        let charUpdateInterval: NodeJS.Timeout | null = null;

        const resetDataTimeout = () => {
          if (dataTimeout) clearTimeout(dataTimeout);
          dataTimeout = setTimeout(() => {
            if (!hasReceivedData) {
              logger.warn(`  ⚠️  30秒内未收到任何数据`);
            }
          }, 30000);
        };
        
        resetDataTimeout();
        
        // 添加实时字符接收显示（每秒更新一次）
        charUpdateInterval = setInterval(() => {
          if (charCount > 0 && charUpdateStartTime) {
            const elapsed = Math.floor((Date.now() - charUpdateStartTime) / 1000);
            const charsPerSec = elapsed > 0 ? Math.floor(charCount / elapsed) : 0;
            process.stdout.write(`\r    ⏳ [阶段1] 接收中... ${charCount} 字符 (${charsPerSec} 字符/秒) | ${waitTime}秒 `);
          }
        }, 1000);

        res.on("data", (chunk) => {
          hasReceivedData = true;
          if (dataTimeout) clearTimeout(dataTimeout);
          
          if (!charUpdateStartTime) {
            charUpdateStartTime = Date.now();
          }
          
          charCount += chunk.length;
          
          buffer += chunk.toString("utf-8");
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.trim() === "") continue; // 跳过空行
            
            if (line.startsWith("data: ")) {
              try {
                const jsonStr = line.substring(6);
                if (jsonStr !== "[DONE]") {
                  const data = JSON.parse(jsonStr) as {
                    type?: string;
                    messageId?: string;
                    messageMetadata?: { createdAt?: string };
                    delta?: string;
                    toolName?: string;
                    toolCallId?: string;
                    finishReason?: string;
                    input?: { message?: string; summary?: string; artifacts?: Array<{ path?: string }> };
                  };
                  
                  // 只处理重要的事件类型，不打印日志
                  if (data.type === "start") {
                    // 保存 messageId 和 createdAt
                    messageId = data.messageId || null;
                    messageCreatedAt = data.messageMetadata?.createdAt || null;
                  } else if (data.type === "text-delta") {
                    // 合并 text-delta 内容，不打印日志
                    fullMessage += data.delta || "";
                  } else if (data.type === "tool-input-available" && data.toolName === "confirm") {
                    askForConfirmationTool = true;
                    toolCallId = data.toolCallId || null;
                    fullMessage += (data.input && data.input.message) ? data.input.message : "";
                  } else if (data.type === "tool-input-available" && data.toolName === "complete") {
                    // 处理 complete 工具的输出
                    if (data.input) {
                      // 提取 summary（字符串）
                      if (data.input.summary) {
                        fullMessage += data.input.summary;
                      }
                      // 处理 artifacts 数组
                      if (data.input.artifacts && Array.isArray(data.input.artifacts)) {
                        data.input.artifacts.forEach((artifact) => {
                          if (artifact.path) {
                            fullMessage += `\n[文件: ${artifact.path}]`;
                          }
                        });
                      }
                    }
                  } else if (data.type === "finish") {
                    finishReason = data.finishReason || null;
                  }
                }
              } catch (e) {
                // 流式数据中的 JSON 解析错误，通常可以忽略，但记录日志
                const errorMessage = e instanceof Error ? e.message : String(e);
                console.error(`  ⚠️  [sendRequest] JSON 解析错误: ${errorMessage}`);
              }
            }
          }
        });

        res.on("end", () => {
          if (dataTimeout) clearTimeout(dataTimeout);
          if (charUpdateInterval) clearInterval(charUpdateInterval);
          process.stdout.write("\n"); // 清除进度提示
          
          // 处理 buffer 中剩余数据
          if (buffer.trim() && buffer.startsWith("data: ")) {
            try {
              const jsonStr = buffer.substring(6);
              if (jsonStr !== "[DONE]") {
                const data = JSON.parse(jsonStr) as { type?: string; delta?: string };
                if (data.type === "text-delta") {
                  fullMessage += data.delta || "";
                }
              }
            } catch (e) {
              // Buffer 中剩余数据的解析错误，通常可以忽略，但记录日志
              const errorMessage = e instanceof Error ? e.message : String(e);
              console.error(`  ⚠️  [sendRequest] Buffer 解析错误: ${errorMessage}`);
            }
          }
          
          logger.info(`    ✅ [阶段1] 响应接收完成 (${fullMessage.length} 字符)`);
          
          // 返回响应
          if (askForConfirmationTool) {
            const result = {
              message: fullMessage.trim(),
              toolCallId: toolCallId || undefined,
              messageId: messageId || undefined,
              messageCreatedAt: messageCreatedAt || undefined,
            };
            resolve(result);
          } else if (fullMessage.trim().length === 0) {
            resolve("");
          } else {
            resolve(fullMessage);
          }
        });

        res.on("error", (error) => {
          if (dataTimeout) clearTimeout(dataTimeout);
          if (charUpdateInterval) clearInterval(charUpdateInterval);
          process.stdout.write("\n"); // 清除进度提示
          logger.error(`    ❌ [阶段1] 响应流错误: ${error.message}`);
          resolve(null);
        });
      } else {
        let errorData = "";
        res.on("data", (chunk) => {
          errorData += chunk.toString();
        });
        res.on("end", () => {
          clearInterval(progressInterval);
          process.stdout.write("\n"); // 清除进度提示
          logger.error(`    ❌ [阶段1] 请求失败: 状态码 ${res.statusCode}`);
          resolve(null);
        });
      }
    });

    req.on("error", (error) => {
      clearInterval(progressInterval);
      process.stdout.write("\n");
      logger.error(`    ❌ [阶段1] 请求错误: ${error.message}`);
      resolve(null);
    });
    req.on("timeout", () => {
      clearInterval(progressInterval);
      process.stdout.write("\n");
      logger.error(`    ❌ [阶段1] 请求超时`);
      req.destroy();
      resolve(null);
    });
    req.write(postData);
    req.end();
  });
}
