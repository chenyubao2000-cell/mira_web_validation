"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { EVALUATOR_OPTIONS } from "@/lib/options";
import type { ExperimentMetrics } from "@/lib/types";

interface MetricsChartProps {
  experiments: ExperimentMetrics[];
  selectedEvaluators: string[];
}

export default function MetricsChart({ experiments, selectedEvaluators }: MetricsChartProps) {
  // 调试日志
  console.log("📊 MetricsChart - experiments:", experiments.length, experiments);
  console.log("📊 MetricsChart - selectedEvaluators:", selectedEvaluators);
  
  // 如果没有实验数据，显示空状态
  if (experiments.length === 0) {
    return (
      <div className="h-full flex items-center justify-center bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm rounded-2xl border border-white/20 dark:border-slate-700/50">
        <div className="text-center">
          <div className="text-6xl opacity-30 mb-4">📊</div>
          <p className="text-gray-500 dark:text-gray-400">暂无实验数据</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">运行实验后，评价指标将显示在这里</p>
        </div>
      </div>
    );
  }

  // 准备图表数据
  const chartData = experiments.map((exp) => {
    const dataPoint: Record<string, number | null | string> = {
      experimentId: exp.experimentId,
      timestamp: exp.timestamp,
      name: new Date(exp.timestamp).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }),
    };

    // 添加所有评价器的值
    selectedEvaluators.forEach((evalId) => {
      const value = exp.metrics[evalId];
      // -1 表示未选择该评价器，设置为 null（不显示）
      // null 或 undefined 表示选择了但结果未生成，也设置为 null（不显示）
      // 只有数字值才会显示
      if (value === -1) {
        dataPoint[evalId] = null; // 未选择，不显示
      } else if (value === null || value === undefined) {
        dataPoint[evalId] = null; // 未生成，不显示
      } else {
        dataPoint[evalId] = value; // 有值，显示
      }
    });

    return dataPoint;
  });

  console.log("📊 Chart data prepared:", chartData);

  // 过滤掉所有值都是 null 的数据点（至少需要一个有效值）
  const validChartData = chartData.filter((point) => {
    return selectedEvaluators.some((evalId) => {
      const value = point[evalId];
      return value !== null && value !== undefined && typeof value === "number";
    });
  });

  console.log("📊 Valid chart data:", validChartData.length, validChartData);

  // 评价器颜色映射
  const evaluatorColors: Record<string, string> = {
    completedEvaluator: "#3b82f6", // blue
    sessionCostEvaluator: "#10b981", // green
    gaiaEvaluator: "#8b5cf6", // purple
    databaseStatusEvaluator: "#f59e0b", // amber
    toolCallEvaluator: "#ef4444", // red
    timeToFirstTokenEvaluator: "#06b6d4", // cyan
    timeToLastTokenEvaluator: "#14b8a6", // teal
    outputTokensPerSecEvaluator: "#ec4899", // pink
    tokensEvaluator: "#6366f1", // indigo
    sessionDurationEvaluator: "#84cc16", // lime
    nTurnsEvaluator: "#f97316", // orange
  };

  // 自定义 Tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white dark:bg-slate-800 p-3 rounded-lg shadow-lg border border-gray-200 dark:border-slate-700">
          <p className="font-semibold mb-2">{label}</p>
          {payload.map((entry: any, index: number) => {
            const value = entry.value;
            let displayValue: string;
            if (value === null || value === undefined) {
              // 检查原始数据中是否为 -1（未选择）
              const originalExp = experiments.find(exp => 
                new Date(exp.timestamp).toLocaleString("zh-CN", {
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                }) === label
              );
              displayValue = originalExp?.metrics[entry.name] === -1 ? "未选择" : "未生成";
            } else {
              displayValue = value.toFixed(2);
            }
            return (
              <p key={index} style={{ color: entry.color }} className="text-sm">
                {entry.name}: <span className="font-medium">{displayValue}</span>
              </p>
            );
          })}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="h-full bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-white/20 dark:border-slate-700/50">
      <div className="mb-4">
        <h3 className="text-lg font-bold text-gray-700 dark:text-gray-300 flex items-center gap-2">
          <span>📈</span>
          评价指标趋势
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          显示所有实验的评价指标变化趋势
        </p>
      </div>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={validChartData.length > 0 ? validChartData : chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-slate-700" />
          <XAxis
            dataKey="name"
            stroke="#6b7280"
            className="dark:stroke-slate-400"
            fontSize={12}
          />
          <YAxis
            stroke="#6b7280"
            className="dark:stroke-slate-400"
            fontSize={12}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend />
          {selectedEvaluators.map((evalId) => {
            const color = evaluatorColors[evalId] || "#6b7280";
            // 获取评价器的显示名称
            const evaluatorOption = EVALUATOR_OPTIONS.find(opt => opt.id === evalId);
            const displayName = evaluatorOption?.label || evalId;
            
            // 检查这个评价器是否有任何有效数据
            const hasData = validChartData.some((point) => {
              const value = point[evalId];
              return value !== null && value !== undefined && typeof value === "number";
            });
            
            // 如果没有数据，不显示这条线
            if (!hasData) {
              return null;
            }
            
            return (
              <Line
                key={evalId}
                type="monotone"
                dataKey={evalId}
                stroke={color}
                strokeWidth={2}
                dot={{ r: 4 }}
                activeDot={{ r: 6 }}
                connectNulls={false}
                name={displayName}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
