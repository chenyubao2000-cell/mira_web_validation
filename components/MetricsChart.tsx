"use client";

import { useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { EVALUATOR_OPTIONS } from "@/lib/options";
import type { ExperimentMetrics } from "@/lib/types";

interface MetricsChartProps {
  experiments: ExperimentMetrics[];
  selectedEvaluators: string[];
}

export default function MetricsChart({ experiments, selectedEvaluators }: MetricsChartProps) {
  // 当前选择的指标
  const [selectedMetric, setSelectedMetric] = useState<string>("");
  
  // 调试日志
  console.log("📊 MetricsChart - experiments:", experiments.length, experiments);
  console.log("📊 MetricsChart - selectedEvaluators:", selectedEvaluators);
  
  // 如果没有实验数据，显示空状态
  if (experiments.length === 0) {
    return (
      <div className="h-full flex items-center justify-center bg-white dark:bg-black rounded-xl border border-gray-200/50 dark:border-gray-800/50">
        <div className="text-center">
          <div className="text-4xl opacity-20 mb-3">📊</div>
          <p className="text-sm text-gray-500 dark:text-gray-500">暂无实验数据</p>
          <p className="text-xs text-gray-400 dark:text-gray-600 mt-1">运行实验后，评价指标将显示在这里</p>
        </div>
      </div>
    );
  }

  // 获取所有有数据的指标（从所有实验中收集）
  const availableMetrics = new Set<string>();
  experiments.forEach((exp) => {
    Object.entries(exp.metrics).forEach(([evalId, value]) => {
      // 只包含有实际数值的指标（排除 -1 和 null）
      if (value !== null && value !== undefined && value !== -1 && typeof value === "number") {
        availableMetrics.add(evalId);
      }
    });
  });

  // 如果没有选择指标，默认选择第一个有数据的指标
  const metricsToShow = selectedMetric || Array.from(availableMetrics)[0] || "";

  // 准备图表数据（只包含当前选择的指标）
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

    // 只添加当前选择的指标的值
    if (metricsToShow) {
      const value = exp.metrics[metricsToShow];
      // -1 表示未选择该评价器，设置为 null（不显示）
      // null 或 undefined 表示选择了但结果未生成，也设置为 null（不显示）
      // 只有数字值才会显示
      if (value === -1) {
        dataPoint[metricsToShow] = null; // 未选择，不显示
      } else if (value === null || value === undefined) {
        dataPoint[metricsToShow] = null; // 未生成，不显示
      } else {
        dataPoint[metricsToShow] = value; // 有值，显示
      }
    }

    return dataPoint;
  });

  console.log("📊 Chart data prepared:", chartData);

  // 过滤掉所有值都是 null 的数据点
  const validChartData = chartData.filter((point) => {
    if (!metricsToShow) return false;
    const value = point[metricsToShow];
    return value !== null && value !== undefined && typeof value === "number";
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
      const entry = payload[0];
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
        displayValue = originalExp?.metrics[metricsToShow] === -1 ? "未选择" : "未生成";
      } else {
        displayValue = value.toFixed(2);
      }
      return (
        <div className="bg-white dark:bg-gray-900 p-3 rounded-lg shadow-lg border border-gray-200 dark:border-gray-800">
          <p className="text-sm font-medium mb-1.5 text-gray-900 dark:text-gray-100">{label}</p>
          <p style={{ color: entry.color }} className="text-sm">
            {entry.name}: <span className="font-medium">{displayValue}</span>
          </p>
        </div>
      );
    }
    return null;
  };

  // 获取当前选择指标的显示名称和颜色
  const evaluatorOption = EVALUATOR_OPTIONS.find(opt => opt.id === metricsToShow);
  const displayName = evaluatorOption?.label || metricsToShow;
  const color = evaluatorColors[metricsToShow] || "#6b7280";

  return (
    <div className="h-full bg-white dark:bg-black rounded-xl border border-gray-200/50 dark:border-gray-800/50 flex flex-col">
      <div className="p-6 border-b border-gray-200/50 dark:border-gray-800/50">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">
          评价指标趋势
        </h3>
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
            选择指标
          </label>
          <select
            value={metricsToShow}
            onChange={(e) => setSelectedMetric(e.target.value)}
            className="w-full px-3 py-2.5 text-sm bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
          >
            {Array.from(availableMetrics).length === 0 ? (
              <option value="">暂无可用指标</option>
            ) : (
              Array.from(availableMetrics).map((evalId) => {
                const option = EVALUATOR_OPTIONS.find(opt => opt.id === evalId);
                return (
                  <option key={evalId} value={evalId}>
                    {option?.label || evalId}
                  </option>
                );
              })
            )}
          </select>
        </div>
      </div>
      
      {metricsToShow && validChartData.length > 0 ? (
        <div className="flex-1 min-h-0 p-6">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={validChartData} margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-gray-800" />
              <XAxis
                dataKey="name"
                stroke="#9ca3af"
                className="dark:stroke-gray-600"
                fontSize={11}
                tick={{ fill: '#6b7280' }}
              />
              <YAxis
                stroke="#9ca3af"
                className="dark:stroke-gray-600"
                fontSize={11}
                tick={{ fill: '#6b7280' }}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend />
              <Line
                type="monotone"
                dataKey={metricsToShow}
                stroke={color}
                strokeWidth={2.5}
                dot={{ r: 4 }}
                activeDot={{ r: 6 }}
                connectNulls={false}
                name={displayName}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : metricsToShow ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center">
            <div className="text-3xl opacity-20 mb-2">📊</div>
            <p className="text-sm text-gray-500 dark:text-gray-500">当前指标暂无数据</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center">
            <div className="text-3xl opacity-20 mb-2">📊</div>
            <p className="text-sm text-gray-500 dark:text-gray-500">请选择一个指标查看</p>
          </div>
        </div>
      )}
    </div>
  );
}
