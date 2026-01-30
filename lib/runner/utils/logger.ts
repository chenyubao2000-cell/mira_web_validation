import { appendFileSync, mkdirSync, existsSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LogLevel = {
  DEBUG: "DEBUG",
  INFO: "INFO",
  WARN: "WARN",
  ERROR: "ERROR",
} as const;

type LogLevelType = (typeof LogLevel)[keyof typeof LogLevel];

const LOG_DIR = join(__dirname, "..", "logs");
// 同时写入 langfuse 目录（如果环境变量设置了 LANGFUSE_DIR）
const LANGFUSE_LOG_DIR = process.env.LANGFUSE_DIR 
  ? join(process.env.LANGFUSE_DIR, "logs")
  : "D:\\code\\langfuse\\logs"; // 默认路径
const MAX_LOG_SIZE = 10 * 1024 * 1024;

if (!existsSync(LOG_DIR)) {
  mkdirSync(LOG_DIR, { recursive: true });
}

// 确保 langfuse logs 目录存在
if (LANGFUSE_LOG_DIR && LANGFUSE_LOG_DIR !== LOG_DIR) {
  try {
    if (!existsSync(LANGFUSE_LOG_DIR)) {
      mkdirSync(LANGFUSE_LOG_DIR, { recursive: true });
    }
  } catch (err) {
    // 如果无法创建 langfuse 目录，忽略错误
  }
}

function getDateString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function getTimestamp(): string {
  const now = new Date();
  return `${getDateString()} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}.${String(now.getMilliseconds()).padStart(3, "0")}`;
}

function formatMessage(level: LogLevelType, message: string, ...args: unknown[]): string {
  const argsStr = args.length > 0 ? " " + args.map((a) => (typeof a === "object" ? JSON.stringify(a, null, 2) : String(a))).join(" ") : "";
  return `[${getTimestamp()}] [${level}] ${message}${argsStr}`;
}

function writeToFile(message: string): void {
  const LOG_FILE = join(LOG_DIR, `app-${getDateString()}.log`);
  const LANGFUSE_LOG_FILE = join(LANGFUSE_LOG_DIR, `app-${getDateString()}.log`);
  
  // 写入当前项目 logs 目录
  try {
    if (existsSync(LOG_FILE)) {
      const stats = statSync(LOG_FILE);
      if (stats.size > MAX_LOG_SIZE) {
        const newLogFile = join(LOG_DIR, `app-${getDateString()}-${Date.now()}.log`);
        appendFileSync(newLogFile, message + "\n", "utf8");
      } else {
        appendFileSync(LOG_FILE, message + "\n", "utf8");
      }
    } else {
      appendFileSync(LOG_FILE, message + "\n", "utf8");
    }
  } catch (err) {
    console.error("Failed to write log:", err);
  }
  
  // 同时写入 langfuse 目录
  try {
    if (existsSync(LANGFUSE_LOG_DIR)) {
      if (existsSync(LANGFUSE_LOG_FILE)) {
        const stats = statSync(LANGFUSE_LOG_FILE);
        if (stats.size > MAX_LOG_SIZE) {
          const newLogFile = join(LANGFUSE_LOG_DIR, `app-${getDateString()}-${Date.now()}.log`);
          appendFileSync(newLogFile, message + "\n", "utf8");
        } else {
          appendFileSync(LANGFUSE_LOG_FILE, message + "\n", "utf8");
        }
      } else {
        appendFileSync(LANGFUSE_LOG_FILE, message + "\n", "utf8");
      }
    }
  } catch (err) {
    // 如果无法写入 langfuse 目录，忽略错误
  }
}

class Logger {
  debug(message: string, ...args: unknown[]): void {
    const m = formatMessage(LogLevel.DEBUG, message, ...args);
    console.log(m);
    writeToFile(m);
  }
  info(message: string, ...args: unknown[]): void {
    const m = formatMessage(LogLevel.INFO, message, ...args);
    console.log(m);
    writeToFile(m);
  }
  warn(message: string, ...args: unknown[]): void {
    const m = formatMessage(LogLevel.WARN, message, ...args);
    console.warn(m);
    writeToFile(m);
  }
  error(message: string | Error, ...args: unknown[]): void {
    const messageStr = message instanceof Error ? message.message : message;
    const m = formatMessage(LogLevel.ERROR, messageStr, ...args);
    console.error(m);
    writeToFile(m);
  }
  log(message: string, ...args: unknown[]): void {
    this.info(message, ...args);
  }
}

const logger = new Logger();
export default logger;
export { Logger, LogLevel };
