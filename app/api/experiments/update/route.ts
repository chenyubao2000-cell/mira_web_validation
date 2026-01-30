import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

const DATA_DIR = join(process.cwd(), "data");
const EXPERIMENTS_FILE = join(DATA_DIR, "experiments.jsonl");

// 确保数据目录存在
async function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
  }
}

// POST: 更新实验的评价结果
export async function POST(request: NextRequest) {
  try {
    await ensureDataDir();
    
    if (!existsSync(EXPERIMENTS_FILE)) {
      return NextResponse.json(
        { error: "Experiments file not found" },
        { status: 404 }
      );
    }

    const { experimentId, metrics } = await request.json();

    if (!experimentId || !metrics) {
      return NextResponse.json(
        { error: "experimentId and metrics are required" },
        { status: 400 }
      );
    }

    // 读取所有实验数据
    const content = await readFile(EXPERIMENTS_FILE, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    const experiments = lines.map((line) => JSON.parse(line));

    // 更新指定的实验
    const updated = experiments.map((exp: any) => {
      if (exp.experimentId === experimentId) {
        return {
          ...exp,
          metrics: { ...exp.metrics, ...metrics },
        };
      }
      return exp;
    });

    // 写回文件
    const newContent = updated.map((exp: any) => JSON.stringify(exp)).join("\n") + "\n";
    await writeFile(EXPERIMENTS_FILE, newContent, "utf-8");

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to update experiment:", error);
    return NextResponse.json(
      { error: "Failed to update experiment" },
      { status: 500 }
    );
  }
}
