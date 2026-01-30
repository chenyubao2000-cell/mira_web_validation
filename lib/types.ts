/**
 * 实验指标数据类型
 */

export interface ExperimentMetrics {
  experimentId: string;
  timestamp: number;
  dataset: string;
  environment: string;
  evaluators: string[];
  maxConcurrency: number;
  metrics: Record<string, number | null>; // 评价器名称 -> 值，null 表示未选择该评价器
  datasetRunUrl?: string;
}

export interface ChartDataPoint {
  experimentId: string;
  timestamp: number;
  [evaluatorName: string]: number | null | string;
}
