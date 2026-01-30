"use client";

import { useState, useRef, useEffect } from "react";
import { DATASET_OPTIONS, EVALUATOR_OPTIONS } from "@/lib/options";
import MetricsChart from "@/components/MetricsChart";
import type { ExperimentMetrics } from "@/lib/types";

interface LogTab {
  id: string;
  name: string;
  logs: string[];
  status: "running" | "success" | "error" | "idle";
  startTime: number;
}

export default function EvaluationPage() {
  const [dataset, setDataset] = useState<string>("Ask");
  const [miraEnv, setMiraEnv] = useState<string>("test");
  const [evaluators, setEvaluators] = useState<string[]>([]);
  const [maxConcurrency, setMaxConcurrency] = useState<number>(5);
  const [currentLogs, setCurrentLogs] = useState<string[]>([]);
  const [isLogCollapsed, setIsLogCollapsed] = useState<boolean>(false);
  const [currentExperimentId, setCurrentExperimentId] = useState<string | null>(null);
  const [experiments, setExperiments] = useState<ExperimentMetrics[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  const toggleEvaluator = (id: string) => {
    setEvaluators((prev) =>
      prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id]
    );
  };

  const scrollToBottom = () => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [currentLogs]);

  // 从服务器加载历史实验数据
  useEffect(() => {
    const loadExperiments = async () => {
      try {
        const res = await fetch("/api/experiments");
        if (res.ok) {
          const data = await res.json();
          const loadedExperiments = data.experiments || [];
          setExperiments(loadedExperiments);
          console.log(`✅ 加载了 ${loadedExperiments.length} 个实验记录`);
        } else {
          console.error("❌ 加载实验数据失败:", await res.text());
        }
      } catch (e) {
        console.error("❌ 加载实验数据异常:", e);
      }
    };
    loadExperiments();
  }, []);

  // 保存实验数据到服务器（jsonl 文件）
  const saveExperiment = async (metrics: ExperimentMetrics) => {
    try {
      const res = await fetch("/api/experiments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(metrics),
      });

      if (res.ok) {
        // 更新本地状态
        setExperiments((prev) => [...prev, metrics]);
        console.log("✅ 实验数据已保存:", metrics);
      } else {
        console.error("❌ 保存实验数据失败:", await res.text());
      }
    } catch (e) {
      console.error("❌ 保存实验数据异常:", e);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // 创建新的实验
    const experimentId = `exp-${Date.now()}`;
    const timestamp = Date.now();
    setCurrentExperimentId(experimentId);
    setCurrentLogs([]);
    setIsLogCollapsed(false);
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/run-experiment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataset,
          miraEnv,
          evaluators,
          maxConcurrency: Number(maxConcurrency) || 5,
        }),
      });

      if (!res.ok) {
        throw new Error(`请求失败 ${res.status}`);
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error("无法读取响应流");
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              
              // 更新当前日志
              if (data.type === "log" && data.data) {
                setCurrentLogs((prev) => [...prev, data.data]);
              } else if (data.type === "error") {
                setCurrentLogs((prev) => [...prev, `[ERROR] ${data.data || data.error}`]);
              } else if (data.type === "metrics" && data.metrics) {
                // 收到评价结果数据，更新当前实验
                console.log("📊 收到评价结果:", data.metrics);
                setExperiments((prev) =>
                  prev.map((exp) => {
                    if (exp.experimentId === currentExperimentId) {
                      const updatedMetrics: Record<string, number | null> = { ...exp.metrics };
                      // 更新实际评价结果
                      Object.entries(data.metrics as Record<string, number>).forEach(([name, value]) => {
                        updatedMetrics[name] = value;
                      });
                      return { ...exp, metrics: updatedMetrics };
                    }
                    return exp;
                  })
                );
              } else if (data.type === "success") {
                // 实验完成，保存实验记录
                const datasetRunUrl = data.datasetRunUrl || data.data?.toString().match(/https?:\/\/[^\s]+/)?.[0];
                
                // 如果 success 消息中已经包含了 metrics，使用它们
                const receivedMetrics = data.metrics as Record<string, number> | undefined;
                
                const metrics: Record<string, number | null> = {};
                EVALUATOR_OPTIONS.forEach((evalOpt) => {
                  // 如果收到了实际评价结果，使用实际值
                  if (receivedMetrics && receivedMetrics[evalOpt.id] !== undefined) {
                    metrics[evalOpt.id] = receivedMetrics[evalOpt.id];
                  } else if (evaluators.includes(evalOpt.id)) {
                    // 如果选择了该评价器但还没有结果，设置为 null
                    metrics[evalOpt.id] = null;
                  } else {
                    // 如果未选择，设置为特殊标志 -1
                    metrics[evalOpt.id] = -1;
                  }
                });

                const experimentMetrics: ExperimentMetrics = {
                  experimentId,
                  timestamp,
                  dataset,
                  environment: miraEnv,
                  evaluators,
                  maxConcurrency,
                  metrics,
                  datasetRunUrl,
                };

                await saveExperiment(experimentMetrics);
                
                // 如果还没有收到评价结果，尝试从 Langfuse API 获取
                if (datasetRunUrl && !receivedMetrics) {
                  setTimeout(async () => {
                    try {
                      const metricsRes = await fetch("/api/fetch-metrics", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ datasetRunUrl }),
                      });
                      
                      if (metricsRes.ok) {
                        const metricsData = await metricsRes.json();
                        if (metricsData.metrics && Object.keys(metricsData.metrics).length > 0) {
                          // 更新实验数据
                          const updatedMetrics: ExperimentMetrics = {
                            ...experimentMetrics,
                            metrics: { ...experimentMetrics.metrics, ...metricsData.metrics },
                          };
                          
                          // 更新到服务器
                          const updateRes = await fetch("/api/experiments/update", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ experimentId, metrics: updatedMetrics.metrics }),
                          });
                          
                          if (updateRes.ok) {
                            // 更新本地状态
                            setExperiments((prev) =>
                              prev.map((exp) =>
                                exp.experimentId === experimentId ? updatedMetrics : exp
                              )
                            );
                          }
                        }
                      }
                    } catch (e) {
                      console.error("Failed to fetch metrics:", e);
                    }
                  }, 5000); // 等待 5 秒让 Langfuse 处理完成
                }
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        }
      }

      setIsSubmitting(false);
      setCurrentExperimentId(null);
    } catch (err) {
      setCurrentLogs((prev) => [
        ...prev,
        `[ERROR] ${err instanceof Error ? err.message : "网络错误"}`,
      ]);
      setIsSubmitting(false);
      setCurrentExperimentId(null);
    }
  };

  // 获取所有已选择的评价器（包括历史实验中选择的）
  const allSelectedEvaluators = Array.from(
    new Set([
      ...evaluators,
      ...experiments.flatMap((exp) => exp.evaluators),
    ])
  );

  // 调试日志
  console.log("🔍 Page state - experiments:", experiments.length, experiments);
  console.log("🔍 Page state - allSelectedEvaluators:", allSelectedEvaluators);

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-black">
      {/* 顶部标题栏 - 吸顶 */}
      <header className="sticky top-0 z-50 bg-white/80 dark:bg-black/80 backdrop-blur-xl border-b border-gray-200/50 dark:border-gray-800/50">
        <div className="px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
              <span className="text-white text-lg font-semibold">M</span>
            </div>
            <div>
              <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                Mira Evaluation
              </h1>
              <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">
                配置数据集、评价器与并发数后运行评估实验
              </p>
            </div>
          </div>
          <div className="text-sm text-gray-500 dark:text-gray-500">
            共 {experiments.length} 个实验记录
          </div>
        </div>
      </header>

      {/* 主内容区域 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧表单区域 - 苹果风格 */}
        <main className="w-80 border-r border-gray-200/50 dark:border-gray-800/50 bg-gray-50/50 dark:bg-gray-950/50 overflow-y-auto">
          <form onSubmit={handleSubmit} className="p-6 space-y-0">
            {/* 数据集 */}
            <div className="py-4 border-b border-gray-200/50 dark:border-gray-800/50">
              <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-3">
                数据集
              </label>
              <select
                value={dataset}
                onChange={(e) => setDataset(e.target.value)}
                disabled={isSubmitting}
                className="w-full px-3 py-2.5 text-sm bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {DATASET_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* 环境 */}
            <div className="py-4 border-b border-gray-200/50 dark:border-gray-800/50">
              <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-3">
                环境
              </label>
              <select
                value={miraEnv}
                onChange={(e) => setMiraEnv(e.target.value)}
                disabled={isSubmitting}
                className="w-full px-3 py-2.5 text-sm bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                <option value="test">测试环境 (test)</option>
                <option value="online">生产环境 (online)</option>
              </select>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-500">
                选择 Mira API 环境，对应 config.json 中的 test/online 配置
              </p>
            </div>

            {/* 评价器 */}
            <div className="py-4 border-b border-gray-200/50 dark:border-gray-800/50">
              <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-3">
                评价器（可多选）
              </label>
              <div className="space-y-1 max-h-64 overflow-y-auto custom-scrollbar">
                {EVALUATOR_OPTIONS.map((opt) => (
                  <label 
                    key={opt.id} 
                    className={`flex items-center gap-3 cursor-pointer px-3 py-2 rounded-lg transition-colors ${
                      evaluators.includes(opt.id)
                        ? "bg-blue-50 dark:bg-blue-950/30"
                        : "hover:bg-gray-100 dark:hover:bg-gray-900/50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={evaluators.includes(opt.id)}
                      onChange={() => toggleEvaluator(opt.id)}
                      disabled={isSubmitting}
                      className="w-4 h-4 rounded border-gray-300 dark:border-gray-700 text-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-0 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* 并发数 */}
            <div className="py-4 border-b border-gray-200/50 dark:border-gray-800/50">
              <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-3">
                并发数
              </label>
              <input
                type="number"
                min={1}
                max={20}
                value={maxConcurrency}
                onChange={(e) => setMaxConcurrency(Number(e.target.value) || 5)}
                disabled={isSubmitting}
                className="w-full px-3 py-2.5 text-sm bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              />
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-500">
                对应 testMira-with-tools.js 中的 maxConcurrency
              </p>
            </div>

            {/* 提交按钮 */}
            <div className="pt-6">
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white text-sm font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSubmitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    运行中…
                  </span>
                ) : (
                  "运行实验"
                )}
              </button>
            </div>
          </form>
        </main>

        {/* 中间日志面板（可折叠） */}
        <aside className={`${isLogCollapsed ? "w-12" : "w-96"} border-r border-gray-200/50 dark:border-gray-800/50 bg-white dark:bg-black flex flex-col transition-all duration-300`}>
        {!isLogCollapsed && (
          <>
            <div className="border-b border-gray-200/50 dark:border-gray-800/50 px-6 py-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                  运行日志
                </h2>
                <button
                  onClick={() => setIsLogCollapsed(true)}
                  className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors"
                  title="收起"
                >
                  <svg className="w-4 h-4 text-gray-500 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 font-mono text-xs bg-white dark:bg-black custom-scrollbar">
              {currentLogs.length === 0 ? (
                <div className="text-gray-400 dark:text-gray-500 text-center mt-8 flex flex-col items-center gap-2">
                  <div className="text-3xl opacity-30">📝</div>
                  <div className="text-xs">暂无日志</div>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {currentLogs.map((log, index) => (
                    <div
                      key={index}
                      className={`px-2 py-1.5 rounded transition-colors ${
                        log.includes("[ERROR]") || log.includes("❌")
                          ? "text-red-600 dark:text-red-400"
                          : log.includes("[WARN]") || log.includes("⚠️")
                          ? "text-yellow-600 dark:text-yellow-400"
                          : log.includes("✅")
                          ? "text-green-600 dark:text-green-400"
                          : "text-gray-600 dark:text-gray-400"
                      }`}
                    >
                      {log}
                    </div>
                  ))}
                  <div ref={logEndRef} />
                </div>
              )}
            </div>
          </>
        )}
        {isLogCollapsed && (
          <button
            onClick={() => setIsLogCollapsed(false)}
            className="w-full h-full flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors"
            title="展开日志"
          >
            <svg className="w-4 h-4 text-gray-500 dark:text-gray-500 transform -rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}
        </aside>

        {/* 右侧图表面板 */}
        <aside className="flex-1 overflow-y-auto bg-gray-50/50 dark:bg-gray-950/50">
        <div className="h-full p-6">
          <div className="mb-4 flex items-center justify-end">
            <button
              onClick={() => {
                // 添加测试数据用于调试
                const testData: ExperimentMetrics = {
                  experimentId: `test-${Date.now()}`,
                  timestamp: Date.now(),
                  dataset: "Ask",
                  environment: "test",
                  evaluators: ["completedEvaluator", "sessionCostEvaluator"],
                  maxConcurrency: 5,
                  metrics: {
                    completedEvaluator: 0.95,
                    sessionCostEvaluator: 0.12,
                    gaiaEvaluator: -1,
                    databaseStatusEvaluator: -1,
                    toolCallEvaluator: -1,
                    timeToFirstTokenEvaluator: -1,
                    timeToLastTokenEvaluator: -1,
                    outputTokensPerSecEvaluator: -1,
                    tokensEvaluator: -1,
                    sessionDurationEvaluator: -1,
                    nTurnsEvaluator: -1,
                  },
                };
                saveExperiment(testData);
              }}
              className="px-3 py-1.5 text-xs bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-700 transition-colors"
            >
              + 添加测试数据
            </button>
          </div>
          <div className="h-[calc(100vh-12rem)]">
            <MetricsChart 
              experiments={experiments} 
              selectedEvaluators={allSelectedEvaluators.length > 0 ? allSelectedEvaluators : EVALUATOR_OPTIONS.map(e => e.id)} 
            />
          </div>
        </div>
        </aside>
      </div>
    </div>
  );
}
