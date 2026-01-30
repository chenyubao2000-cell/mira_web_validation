/**
 * 通用类型定义
 */

export interface EnvConfig {
  env?: string;
  MIRA_API_URL: string;
  MIRA_SESSION_TOKEN: string;
  PROXY_URL?: string;
  LANGFUSE_SECRET_KEY: string;
  LANGFUSE_PUBLIC_KEY: string;
  LANGFUSE_BASE_URL: string;
  DEEPSEEK_API_KEY?: string;
}

export interface TaskOutput {
  sessionId: string | null;
  success: boolean;
  message: string;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  turn: number;
  toolCallId?: string;
  isToolExecutionResult?: boolean;
}

export interface ConfirmationMessage {
  toolCallId: string;
  messageId: string;
  messageCreatedAt: string;
  textContent: string;
}

export interface SendRequestResponse {
  message?: string;
  toolCallId?: string;
  messageId?: string;
  messageCreatedAt?: string;
  askForConfirmationTool?: boolean;
}

export interface EvaluatorResult {
  name: string;
  value: number;
  comment: string;
}

export interface TraceObservation {
  id?: string;
  name?: string;
  type?: string;
  startTime?: string | number;
  endTime?: string | number;
  timestamp?: string | number;
  timeToFirstToken?: number;
  usage?: {
    input?: number;
    output?: number;
  };
  calculatedTotalCost?: number;
  cost?: number;
  input?: unknown;
}

export interface TraceDetails {
  id: string;
  startTime?: string | number;
  endTime?: string | number;
  timestamp?: string | number;
  createdAt?: string | number;
  totalCost?: number;
  calculatedTotalCost?: number;
  cost?: number;
  level?: string;
  observations?: TraceObservation[];
}

export interface DatasetItem {
  id?: string;
  datasetItemId?: string;
  input: {
    question?: string;
    text?: string;
    files?: string | string[];
  };
  expectedOutput?: string;
  metadata?: unknown;
}

export interface EvaluatorInput {
  input: DatasetItem["input"];
  output: TaskOutput | string;
  expectedOutput?: string;
  metadata?: unknown;
}

export interface RunLevelEvaluatorInput {
  itemResults: Array<{
    datasetRunId?: string;
    evaluations?: EvaluatorResult[];
  }>;
}
