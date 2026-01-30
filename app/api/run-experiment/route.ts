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
        
        const send = (data: { type: string; data?: unknown; error?: string }) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
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

          child.stdout?.on("data", (chunk: Buffer) => {
            const text = chunk.toString();
            send({ type: "log", data: text });
          });

          child.stderr?.on("data", (chunk: Buffer) => {
            const text = chunk.toString();
            send({ type: "error", data: text });
          });

          child.on("close", (code) => {
            if (code === 0) {
              send({ type: "success", data: "实验完成，结果已写入 Langfuse。" });
            } else {
              send({ type: "error", error: `进程退出码: ${code}` });
            }
            controller.close();
          });

          child.on("error", (err) => {
            send({ type: "error", error: err.message });
            controller.close();
          });
        } catch (error) {
          send({ type: "error", error: error instanceof Error ? error.message : "Unknown error" });
          controller.close();
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
