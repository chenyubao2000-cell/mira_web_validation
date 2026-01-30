import { writeFile, readFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "../../../..");
const DATA_DIR = join(PROJECT_ROOT, "data");
const EXPERIMENTS_FILE = join(DATA_DIR, "experiments.jsonl");

// 确保数据目录存在
async function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
  }
}

// 注意：这个接口应该与 lib/types.ts 中的 ExperimentMetrics 保持一致
// 但为了保持 runner 目录的独立性，这里也定义一份
export interface ExperimentMetrics {
  experimentId: string;
  timestamp: number;
  dataset: string;
  environment: string;
  evaluators: string[];
  maxConcurrency: number;
  metrics: Record<string, number | null>;
  datasetRunUrl?: string;
}

/**
 * 保存实验数据到 experiments.jsonl 文件
 */
export async function saveExperimentMetrics(metrics: ExperimentMetrics): Promise<void> {
  try {
    await ensureDataDir();
    
    // 追加到 jsonl 文件
    const line = JSON.stringify(metrics) + "\n";
    await writeFile(EXPERIMENTS_FILE, line, { flag: "a" });
    
    console.log(`✅ 实验数据已保存到: ${EXPERIMENTS_FILE}`);
  } catch (error) {
    console.error(`❌ 保存实验数据失败:`, error);
    throw error;
  }
}

/**
 * 读取所有实验数据
 */
export async function loadExperimentMetrics(): Promise<ExperimentMetrics[]> {
  try {
    await ensureDataDir();
    
    if (!existsSync(EXPERIMENTS_FILE)) {
      return [];
    }

    const content = await readFile(EXPERIMENTS_FILE, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    return lines.map((line) => JSON.parse(line));
  } catch (error) {
    console.error(`❌ 读取实验数据失败:`, error);
    return [];
  }
}
