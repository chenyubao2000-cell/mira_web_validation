import { NextRequest } from "next/server";
import { spawn } from "child_process";
import path from "path";

// 获取项目根目录
const projectRoot = process.cwd();
const RUNNER_SCRIPT = path.join(projectRoot, "lib", "runner", "run-experiment.ts");

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { dataset = "Ask", evaluators = [], maxConcurrency = 5, miraEnv } = body;

    const evaluatorsStr = Array.isArray(evaluators) ? evaluators.join(",") : String(evaluators);

    // 创建流式响应
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let isClosed = false;
        
        const send = (data: { type: string; data?: unknown; error?: string; datasetRunUrl?: string; metrics?: Record<string, number> }) => {
          if (isClosed) {
            return; // Controller 已关闭，不再发送数据
          }
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          } catch (error) {
            // Controller 可能已关闭，忽略错误
            console.warn("Failed to send data, controller may be closed:", error);
            isClosed = true;
          }
        };

        const closeController = () => {
          if (!isClosed) {
            isClosed = true;
            try {
              controller.close();
            } catch (error) {
              // 忽略关闭错误
            }
          }
        };

        try {
          const child = spawn(
            "npx",
            ["tsx", RUNNER_SCRIPT],
            {
              cwd: projectRoot,
              env: {
                ...process.env,
                EVAL_DATASET: String(dataset),
                EVAL_EVALUATORS: evaluatorsStr,
                EVAL_MAX_CONCURRENCY: String(Math.max(1, Math.min(20, Number(maxConcurrency) || 5))),
                ...(miraEnv && { MIRA_ENV: String(miraEnv) }),
              },
              stdio: ["ignore", "pipe", "pipe"],
              shell: process.platform === "win32",
            }
          );

          let datasetRunUrl: string | null = null;
          let evaluationMetrics: Record<string, number> | null = null;
          let logBuffer = "";

          child.stdout?.on("data", (chunk: Buffer) => {
            if (isClosed) return; // 如果已关闭，不再处理数据
            
            const text = chunk.toString();
            logBuffer += text;
            send({ type: "log", data: text });
            
            // 尝试从日志中提取 datasetRunUrl
            // 格式: "✅ 实验完成 | 结果: https://..."
            const urlMatch = text.match(/结果:\s*(https?:\/\/[^\s\n]+)/);
            if (urlMatch) {
              datasetRunUrl = urlMatch[1];
            }
            
            // 尝试从日志中提取评价结果 JSON
            // 格式: [METRICS_JSON_START]{...}[METRICS_JSON_END]
            const metricsMatch = logBuffer.match(/\[METRICS_JSON_START\](.+?)\[METRICS_JSON_END\]/s);
            if (metricsMatch) {
              try {
                evaluationMetrics = JSON.parse(metricsMatch[1]);
                send({ type: "metrics", metrics: evaluationMetrics });
              } catch (e) {
                console.error("Failed to parse metrics JSON:", e);
              }
            }
          });

          child.stderr?.on("data", (chunk: Buffer) => {
            if (isClosed) return; // 如果已关闭，不再处理数据
            const text = chunk.toString();
            send({ type: "error", data: text });
          });

          child.on("close", (code) => {
            if (isClosed) return; // 如果已关闭，不再处理
            
            if (code === 0) {
              send({ 
                type: "success", 
                data: "实验完成，结果已写入 Langfuse。",
                datasetRunUrl: datasetRunUrl || undefined,
                metrics: evaluationMetrics || undefined
              });
            } else {
              send({ type: "error", error: `进程退出码: ${code}` });
            }
            
            // 延迟关闭，确保所有数据都已发送
            setTimeout(() => {
              closeController();
            }, 100);
          });

          child.on("error", (err) => {
            if (isClosed) return; // 如果已关闭，不再处理
            send({ type: "error", error: err.message });
            closeController();
          });
        } catch (error) {
          if (!isClosed) {
            send({ type: "error", error: error instanceof Error ? error.message : "Unknown error" });
            closeController();
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
