"use client";

import { useState, useRef, useEffect } from "react";
import { DATASET_OPTIONS, EVALUATOR_OPTIONS } from "@/lib/options";

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
  const [logTabs, setLogTabs] = useState<LogTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
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
  }, [logTabs]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // 创建新的日志 tab
    const timestamp = new Date().toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const tabId = `log-${Date.now()}`;
    const newTab: LogTab = {
      id: tabId,
      name: timestamp,
      logs: [],
      status: "running",
      startTime: Date.now(),
    };

    setLogTabs((prev) => [...prev, newTab]);
    setActiveTabId(tabId);
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
              
              setLogTabs((prev) => {
                const updated = prev.map((tab) => {
                  if (tab.id === tabId) {
                    const newLogs = [...tab.logs];
                    if (data.type === "log" && data.data) {
                      newLogs.push(data.data);
                    } else if (data.type === "error") {
                      newLogs.push(`[ERROR] ${data.data || data.error}`);
                    }
                    
                    let status = tab.status;
                    if (data.type === "success") {
                      status = "success";
                    } else if (data.type === "error") {
                      status = "error";
                    }
                    
                    return { ...tab, logs: newLogs, status };
                  }
                  return tab;
                });
                return updated;
              });
            } catch (e) {
              // 忽略解析错误
            }
          }
        }
      }

      setIsSubmitting(false);
    } catch (err) {
      setLogTabs((prev) => {
        return prev.map((tab) => {
          if (tab.id === tabId) {
            return {
              ...tab,
              status: "error",
              logs: [...tab.logs, `[ERROR] ${err instanceof Error ? err.message : "网络错误"}`],
            };
          }
          return tab;
        });
      });
      setIsSubmitting(false);
    }
  };

  const activeTab = logTabs.find((tab) => tab.id === activeTabId);
  const activeLogs = activeTab?.logs || [];

  return (
    <div className="flex h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
      {/* 左侧表单区域 */}
      <main className="flex-1 min-h-screen p-6 md:p-10 max-w-2xl overflow-y-auto">
        <div className="mb-8 animate-fadeIn">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-500/30 transform hover:rotate-12 transition-transform duration-300">
              <span className="text-white text-xl font-bold">M</span>
            </div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 dark:from-blue-400 dark:via-indigo-400 dark:to-purple-400 bg-clip-text text-transparent">
              Mira Evaluation
            </h1>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 ml-14">
            配置数据集、评价器与并发数后运行评估实验
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* 数据集：单选 */}
          <div className="bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm rounded-2xl p-5 shadow-lg border border-white/20 dark:border-slate-700/50 hover:shadow-xl transition-all duration-300 animate-fadeIn">
            <label className="block text-sm font-semibold mb-3 text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <span className="text-blue-500">📊</span>
              数据集
            </label>
            <select
              value={dataset}
              onChange={(e) => setDataset(e.target.value)}
              disabled={isSubmitting}
              className="w-full rounded-xl border-2 border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3 text-sm font-medium transition-all duration-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed hover:border-blue-300 dark:hover:border-blue-600"
            >
              {DATASET_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* 环境：单选 */}
          <div className="bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm rounded-2xl p-5 shadow-lg border border-white/20 dark:border-slate-700/50 hover:shadow-xl transition-all duration-300 animate-fadeIn" style={{ animationDelay: '0.1s' }}>
            <label className="block text-sm font-semibold mb-3 text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <span className="text-indigo-500">🌍</span>
              环境
            </label>
            <select
              value={miraEnv}
              onChange={(e) => setMiraEnv(e.target.value)}
              disabled={isSubmitting}
              className="w-full rounded-xl border-2 border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3 text-sm font-medium transition-all duration-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed hover:border-indigo-300 dark:hover:border-indigo-600"
            >
              <option value="test">测试环境 (test)</option>
              <option value="online">生产环境 (online)</option>
            </select>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">选择 Mira API 环境，对应 config.json 中的 test/online 配置</p>
          </div>

          {/* 评价器：多选 */}
          <div className="bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm rounded-2xl p-5 shadow-lg border border-white/20 dark:border-slate-700/50 hover:shadow-xl transition-all duration-300 animate-fadeIn" style={{ animationDelay: '0.2s' }}>
            <label className="block text-sm font-semibold mb-3 text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <span className="text-purple-500">⚙️</span>
              评价器（可多选）
            </label>
            <div className="rounded-xl border-2 border-gray-200 dark:border-slate-700 bg-white/50 dark:bg-slate-900/50 p-4 space-y-2 max-h-64 overflow-y-auto custom-scrollbar">
              {EVALUATOR_OPTIONS.map((opt) => (
                <label 
                  key={opt.id} 
                  className={`flex items-center gap-3 cursor-pointer p-2 rounded-lg transition-all duration-200 ${
                    evaluators.includes(opt.id)
                      ? "bg-blue-50 dark:bg-blue-900/20 border-2 border-blue-300 dark:border-blue-700"
                      : "hover:bg-gray-50 dark:hover:bg-slate-800/50 border-2 border-transparent"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={evaluators.includes(opt.id)}
                    onChange={() => toggleEvaluator(opt.id)}
                    disabled={isSubmitting}
                    className="w-4 h-4 rounded border-2 border-gray-300 dark:border-slate-600 text-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* 并发数：数字输入 */}
          <div className="bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm rounded-2xl p-5 shadow-lg border border-white/20 dark:border-slate-700/50 hover:shadow-xl transition-all duration-300 animate-fadeIn" style={{ animationDelay: '0.3s' }}>
            <label className="block text-sm font-semibold mb-3 text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <span className="text-green-500">🚀</span>
              并发数
            </label>
            <input
              type="number"
              min={1}
              max={20}
              value={maxConcurrency}
              onChange={(e) => setMaxConcurrency(Number(e.target.value) || 5)}
              disabled={isSubmitting}
              className="w-full rounded-xl border-2 border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3 text-sm font-medium transition-all duration-200 focus:ring-2 focus:ring-green-500 focus:border-green-500 disabled:opacity-50 disabled:cursor-not-allowed hover:border-green-300 dark:hover:border-green-600"
            />
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">对应 testMira-with-tools.js 中的 maxConcurrency</p>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 text-white py-4 font-semibold text-lg shadow-lg shadow-blue-500/50 hover:shadow-xl hover:shadow-blue-500/60 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 transform hover:scale-[1.02] active:scale-[0.98] relative overflow-hidden group"
          >
            <span className="relative z-10 flex items-center justify-center gap-2">
              {isSubmitting ? (
                <>
                  <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  运行中…
                </>
              ) : (
                <>
                  <span>▶</span>
                  运行实验
                </>
              )}
            </span>
            <div className="absolute inset-0 bg-gradient-to-r from-blue-700 via-indigo-700 to-purple-700 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
          </button>
        </form>
      </main>

      {/* 右侧日志面板 */}
      <aside className="w-96 border-l-2 border-gray-200/50 dark:border-slate-700/50 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm flex flex-col shadow-2xl">
        <div className="border-b-2 border-gray-200/50 dark:border-slate-700/50 p-5 bg-gradient-to-r from-slate-50 to-blue-50 dark:from-slate-800 dark:to-slate-900">
          <h2 className="text-xl font-bold mb-4 bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-400 dark:to-indigo-400 bg-clip-text text-transparent flex items-center gap-2">
            <span>📋</span>
            运行日志
          </h2>
          {logTabs.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar">
              {logTabs.map((tab) => {
                const statusColors = {
                  running: "bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-500/30",
                  success: "bg-gradient-to-r from-green-500 to-green-600 text-white shadow-lg shadow-green-500/30",
                  error: "bg-gradient-to-r from-red-500 to-red-600 text-white shadow-lg shadow-red-500/30",
                  idle: "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300",
                };
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTabId(tab.id)}
                    className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all duration-200 transform hover:scale-105 ${
                      activeTabId === tab.id
                        ? "ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-slate-800 scale-105"
                        : "hover:opacity-80"
                    } ${statusColors[tab.status]}`}
                  >
                    {tab.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 font-mono text-xs bg-gradient-to-b from-white/50 to-slate-50/50 dark:from-slate-900/50 dark:to-slate-800/50 custom-scrollbar">
          {activeLogs.length === 0 ? (
            <div className="text-gray-400 dark:text-gray-500 text-center mt-8 flex flex-col items-center gap-2">
              <div className="text-4xl opacity-50">📝</div>
              <div className="text-sm">暂无日志</div>
            </div>
          ) : (
            <div className="space-y-1">
              {activeLogs.map((log, index) => (
                <div
                  key={index}
                  className={`p-2 rounded-lg transition-all duration-200 hover:bg-white/50 dark:hover:bg-slate-800/50 ${
                    log.includes("[ERROR]") || log.includes("❌")
                      ? "text-red-600 dark:text-red-400 bg-red-50/50 dark:bg-red-900/10"
                      : log.includes("[WARN]") || log.includes("⚠️")
                      ? "text-yellow-600 dark:text-yellow-400 bg-yellow-50/50 dark:bg-yellow-900/10"
                      : log.includes("✅")
                      ? "text-green-600 dark:text-green-400 bg-green-50/50 dark:bg-green-900/10"
                      : "text-gray-700 dark:text-gray-300"
                  }`}
                >
                  {log}
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
