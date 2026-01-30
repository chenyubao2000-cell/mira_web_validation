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

// GET: 获取所有实验数据
export async function GET() {
  try {
    await ensureDataDir();
    
    if (!existsSync(EXPERIMENTS_FILE)) {
      return NextResponse.json({ experiments: [] });
    }

    const content = await readFile(EXPERIMENTS_FILE, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    const experiments = lines.map((line) => JSON.parse(line));

    return NextResponse.json({ experiments });
  } catch (error) {
    console.error("Failed to read experiments:", error);
    return NextResponse.json(
      { error: "Failed to read experiments" },
      { status: 500 }
    );
  }
}

// POST: 添加新的实验数据
export async function POST(request: NextRequest) {
  try {
    await ensureDataDir();
    
    const experiment = await request.json();
    
    // 追加到 jsonl 文件
    const line = JSON.stringify(experiment) + "\n";
    await writeFile(EXPERIMENTS_FILE, line, { flag: "a" });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to save experiment:", error);
    return NextResponse.json(
      { error: "Failed to save experiment" },
      { status: 500 }
    );
  }
}
