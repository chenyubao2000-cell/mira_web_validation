import { NextRequest, NextResponse } from "next/server";
import { LangfuseClient } from "@langfuse/client";
import { readFileSync } from "fs";
import { join } from "path";

// 从配置文件读取 Langfuse 密钥
function getLangfuseClient() {
  try {
    const configPath = join(process.cwd(), "lib", "runner", "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    const currentEnv = process.env.MIRA_ENV || config.currentEnv || "test";
    const envConfig = config[currentEnv] || config.test;

    const publicKey = process.env.LANGFUSE_PUBLIC_KEY || envConfig.LANGFUSE_PUBLIC_KEY;
    const secretKey = process.env.LANGFUSE_SECRET_KEY || envConfig.LANGFUSE_SECRET_KEY;
    const baseUrl = process.env.LANGFUSE_BASE_URL || envConfig.LANGFUSE_BASE_URL || "https://us.cloud.langfuse.com";

    if (!publicKey || !secretKey) {
      throw new Error("Langfuse keys not configured");
    }

    return new LangfuseClient({
      publicKey,
      secretKey,
      baseUrl,
    });
  } catch (error) {
    console.error("Failed to initialize Langfuse client:", error);
    return null;
  }
}

// POST: 从 Langfuse 获取实验的评价结果
export async function POST(request: NextRequest) {
  try {
    const { datasetRunUrl } = await request.json();

    if (!datasetRunUrl) {
      return NextResponse.json(
        { error: "datasetRunUrl is required" },
        { status: 400 }
      );
    }

    const langfuse = getLangfuseClient();
    if (!langfuse) {
      return NextResponse.json(
        { error: "Langfuse client not initialized" },
        { status: 500 }
      );
    }

    // 从 URL 中提取 dataset run ID
    // URL 格式通常是: https://cloud.langfuse.com/project/xxx/datasets/xxx/runs/xxx
    const urlMatch = datasetRunUrl.match(/\/runs\/([^\/]+)/);
    if (!urlMatch) {
      return NextResponse.json(
        { error: "Invalid datasetRunUrl format" },
        { status: 400 }
      );
    }

    const runId = urlMatch[1];

    try {
      // 尝试通过 Langfuse API 获取 dataset run 的评价结果
      // 方法1: 通过 dataset run ID 获取所有 traces，然后提取评价结果
      // 注意：limit 最大为 100，需要分页获取
      const metrics: Record<string, number[]> = {};
      let page = 1;
      const limit = 100; // Langfuse API 限制最大 100
      let hasMore = true;

      // 分页获取所有 traces
      while (hasMore) {
        try {
          const traces = await langfuse.api.trace.list({ 
            datasetRunId: runId,
            limit,
            page,
          });

          if (!traces.data || traces.data.length === 0) {
            hasMore = false;
            break;
          }

          // 从 traces 中提取评价结果
          for (const trace of traces.data) {
            // 获取 trace 的详细信息（包含 evaluations）
            try {
              const traceDetail = await langfuse.api.trace.get(trace.id);
              
              // 从 traceDetail 中提取 evaluations
              // Langfuse 的评价结果可能在 trace.scores 或 trace.observations 中
              if ((traceDetail as any).scores && Array.isArray((traceDetail as any).scores)) {
                (traceDetail as any).scores.forEach((score: any) => {
                  if (score.name && typeof score.value === "number") {
                    if (!metrics[score.name]) {
                      metrics[score.name] = [];
                    }
                    metrics[score.name].push(score.value);
                  }
                });
              }
            } catch (traceError) {
              // 忽略单个 trace 的错误，继续处理其他 traces
              console.warn(`Failed to get trace ${trace.id}:`, traceError);
            }
          }

          // 如果返回的数据少于 limit，说明没有更多数据了
          if (traces.data.length < limit) {
            hasMore = false;
          } else {
            page++;
            // 限制最多获取 10 页（1000 条记录）
            if (page > 10) {
              hasMore = false;
            }
          }
        } catch (pageError) {
          console.error(`Failed to fetch page ${page}:`, pageError);
          hasMore = false;
        }
      }

      // 计算每个评价器的平均值
      const avgMetrics: Record<string, number> = {};
      Object.entries(metrics).forEach(([name, values]) => {
        if (values.length > 0) {
          avgMetrics[name] = values.reduce((a, b) => a + b, 0) / values.length;
        }
      });

      return NextResponse.json({
        metrics: avgMetrics,
        note: `从 ${Object.keys(metrics).length} 个评价器获取了数据`,
      });
    } catch (apiError) {
      console.error("Failed to fetch metrics from Langfuse API:", apiError);
      return NextResponse.json({
        metrics: {},
        error: apiError instanceof Error ? apiError.message : "Unknown error",
        note: "无法从 Langfuse API 获取评价结果，请稍后手动刷新",
      });
    }
  } catch (error) {
    console.error("Failed to fetch metrics:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch metrics" },
      { status: 500 }
    );
  }
}
