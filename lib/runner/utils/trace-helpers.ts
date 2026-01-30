import { langfuse } from "../config/index.js";
import type { TraceDetails } from "../types.js";

export async function findMiraTrace(
  sessionId: string | null,
  maxRetries = 18,
  waitSeconds = 10,
  turnCount = 0
): Promise<TraceDetails[] | null> {
  if (!sessionId) {
    console.error(`  ❌ [findMiraTrace] 未提供 sessionId`);
    return null;
  }
  let allSessionTraces: TraceDetails[] = [];
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    await new Promise((r) => setTimeout(r, waitSeconds * 1000));
    try {
      // 使用 Langfuse SDK 查询 traces
      const result = await langfuse.api.trace.list({ sessionId, name: "mira-agent", limit: 100 });
      const sessionTraces = ((result.data || []) as unknown as TraceDetails[]).sort(
        (a, b) =>
          new Date((b.timestamp || b.createdAt || 0) as string | number).getTime() -
          new Date((a.timestamp || a.createdAt || 0) as string | number).getTime()
      );
      const currentTraceCount = sessionTraces.length;
      if (sessionTraces.length > 0) {
        allSessionTraces = sessionTraces;
        // 如果提供了 turnCount 且 traces 数量等于 turnCount，检查所有 traces 是否完成
        if (turnCount > 0 && currentTraceCount === turnCount) {
          let allCompleted = true;
          for (let i = 0; i < currentTraceCount; i++) {
            const trace = allSessionTraces[i];
            const traceDetail = await waitForTraceCompletion(trace, "    ");
            
            if (!traceDetail) {
              allCompleted = false;
              break;
            } else {
              continue;
            }
          }
          
          if (allCompleted) {
            return allSessionTraces;
          } else {
            console.error(`  ❌ [findMiraTrace] 存在未完成的 trace，对话失败`);
            return null;
          }
        }
        if (turnCount > 0 && currentTraceCount < turnCount) {
          continue;
        }
        return sessionTraces;
      } else {
        if (attempt < maxRetries) {
          continue;
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`  ❌ [findMiraTrace] 查询失败: ${errorMessage}`);
    }
  }
  
  if (allSessionTraces.length > 0) {
    if (turnCount > 0 && allSessionTraces.length !== turnCount) {
      console.warn(`  ⚠️  [findMiraTrace] traces 数量不匹配: 找到 ${allSessionTraces.length} 个，期望 ${turnCount} 个`);
      return allSessionTraces;
    }
    return allSessionTraces;
  } else {
    console.error(`  ❌ [findMiraTrace] 多次重试后仍未找到 traces (sessionId: ${sessionId})`);
    return null;
  }
}

export async function waitForTraceCompletion(
  miraTrace: TraceDetails,
  logPrefix = "  "
): Promise<TraceDetails | null> {
  if (!miraTrace) {
    console.error(`${logPrefix}❌ [waitForTraceCompletion] miraTrace 为空`);
    return null;
  }
  let traceDetails: TraceDetails | null;
  try {
    traceDetails = (await langfuse.api.trace.get(miraTrace.id)) as TraceDetails | null;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`${logPrefix}❌ [waitForTraceCompletion] 无法获取 trace 详情 (traceId: ${miraTrace.id}): ${errorMessage}`);
    return null;
  }
  
  if (!traceDetails) {
    console.error(`${logPrefix}❌ [waitForTraceCompletion] 无法获取 trace 详情 (traceId: ${miraTrace.id})`);
    return null;
  }
  const maxAttempts = 60;
  const waitForNodeMaxAttempts = 30;
  const waitForCompletionMaxAttempts = 30;
  let nodeFoundAttempt = 0;
  let nodeFoundTime: number | null = null;
  const startTime = Date.now();
  let attempt = 1;

  while (attempt <= maxAttempts) {
    const streamTextNodes =
      traceDetails.observations?.filter((o) => o.name === "ai.streamText") || [];
    if (streamTextNodes.length === 0) {
      if (attempt >= waitForNodeMaxAttempts) {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        console.error(`${logPrefix}❌ [waitForTraceCompletion] 等待5分钟后仍没有 ai.streamText 节点 (traceId: ${miraTrace.id}, 已等待: ${elapsed}秒)`);
        return null;
      }
      await new Promise((r) => setTimeout(r, 10000));
      try {
        const updated = (await langfuse.api.trace.get(miraTrace.id)) as TraceDetails | null;
        if (updated) traceDetails = updated;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`${logPrefix}❌ [waitForTraceCompletion] 查询 trace 失败: ${errorMessage}`);
      }
      attempt++;
      continue;
    }
    
    if (nodeFoundAttempt === 0) {
      nodeFoundAttempt = attempt;
      nodeFoundTime = Date.now();
      const elapsed = Math.floor((nodeFoundTime - startTime) / 1000);
      console.log(`${logPrefix}✅ [waitForTraceCompletion] 找到 ai.streamText 节点 (traceId: ${miraTrace.id}, 节点数: ${streamTextNodes.length}, 等待时间: ${elapsed}秒)`);
    }
    
    const completedNodes = streamTextNodes.filter((o) => o.endTime != null);
    const incompleteNodes = streamTextNodes.filter((o) => o.endTime == null);
    
    if (nodeFoundAttempt > 0 && attempt - nodeFoundAttempt >= waitForCompletionMaxAttempts) {
      const elapsedSinceNodeFound = Math.floor((Date.now() - (nodeFoundTime || 0)) / 1000);
      const totalElapsed = Math.floor((Date.now() - startTime) / 1000);
      console.error(`${logPrefix}❌ [waitForTraceCompletion] 找到节点后等待5分钟仍未完成 (traceId: ${miraTrace.id}, 已完成: ${completedNodes.length}/${streamTextNodes.length}, 节点等待时间: ${elapsedSinceNodeFound}秒, 总等待时间: ${totalElapsed}秒)`);
      return null;
    }
    
    if (completedNodes.length > 0 && incompleteNodes.length > 0) {
      const elapsedSinceNodeFound = Math.floor((Date.now() - (nodeFoundTime || 0)) / 1000);
      console.log(`${logPrefix}⏳ [waitForTraceCompletion] 节点处理中 (traceId: ${miraTrace.id}, 已完成: ${completedNodes.length}/${streamTextNodes.length}, 节点等待时间: ${elapsedSinceNodeFound}秒)`);
    }
    
    const allCompleted = streamTextNodes.every((o) => o.endTime != null);
    if (allCompleted) {
      const elapsedSinceNodeFound = Math.floor((Date.now() - (nodeFoundTime || 0)) / 1000);
      const totalElapsed = Math.floor((Date.now() - startTime) / 1000);
      console.log(`${logPrefix}✅ [waitForTraceCompletion] 所有节点已完成 (traceId: ${miraTrace.id}, 节点数: ${streamTextNodes.length}, 节点等待时间: ${elapsedSinceNodeFound}秒, 总等待时间: ${totalElapsed}秒)`);
      return traceDetails;
    }
    await new Promise((r) => setTimeout(r, 10000));
    try {
      const updated = (await langfuse.api.trace.get(miraTrace.id)) as TraceDetails | null;
      if (updated) traceDetails = updated;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`${logPrefix}❌ [waitForTraceCompletion] 查询 trace 失败: ${errorMessage}`);
    }
    attempt++;
  }
  
  const totalElapsed = Math.floor((Date.now() - startTime) / 1000);
  const elapsedSinceNodeFound = nodeFoundTime ? Math.floor((Date.now() - nodeFoundTime) / 1000) : 0;
  console.error(`${logPrefix}❌ [waitForTraceCompletion] 超时: 达到最大等待时间 (10分钟) (traceId: ${miraTrace.id}, 总等待时间: ${totalElapsed}秒${nodeFoundTime ? `, 节点等待时间: ${elapsedSinceNodeFound}秒` : ""})`);
  return null;
}

// 辅助函数：合并多个 traces 的 observations（去重并按时间排序）
export function mergeTracesObservations(traceDetailsList: TraceDetails[]): TraceDetails["observations"] {
  const allObservations: TraceDetails["observations"] = [];
  const seenIds = new Set<string>();
  
  // 合并所有 traces 的 observations（去重）
  for (const traceDetails of traceDetailsList) {
    if (traceDetails.observations) {
      for (const obs of traceDetails.observations) {
        if (!seenIds.has(obs.id || "")) {
          seenIds.add(obs.id || "");
          allObservations.push(obs);
        }
      }
    }
  }
  
  // 按时间排序（确保指标计算的准确性）
  allObservations.sort((a, b) => {
    const timeA = (a.startTime || (a as { timestamp?: string | number }).timestamp || 0) as string | number;
    const timeB = (b.startTime || (b as { timestamp?: string | number }).timestamp || 0) as string | number;
    return new Date(timeA).getTime() - new Date(timeB).getTime();
  });
  
  return allObservations;
}
