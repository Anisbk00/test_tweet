/**
 * Bun entry point that starts the Python FastAPI server.
 * This allows the service to be managed by `bun run dev` with hot reload.
 */

import { spawn } from "child_process";

const PORT = 3031;
const HOST = "0.0.0.0";

console.log(`[twikit-service] Starting Python FastAPI server on ${HOST}:${PORT}...`);

const pythonProcess = spawn("python3", [
  "-m", "uvicorn",
  "main:app",
  "--host", HOST,
  "--port", PORT.toString(),
  "--reload",
], {
  cwd: import.meta.dir,
  stdio: ["pipe", "pipe", "pipe"],
});

pythonProcess.stdout.on("data", (data: Buffer) => {
  const output = data.toString().trim();
  if (output) {
    console.log(`[twikit-service] ${output}`);
  }
});

pythonProcess.stderr.on("data", (data: Buffer) => {
  const output = data.toString().trim();
  if (output) {
    console.error(`[twikit-service] ${output}`);
  }
});

pythonProcess.on("error", (err: Error) => {
  console.error(`[twikit-service] Failed to start process: ${err.message}`);
  process.exit(1);
});

pythonProcess.on("close", (code: number | null) => {
  console.log(`[twikit-service] Process exited with code ${code}`);
  process.exit(code ?? 1);
});

// Handle graceful shutdown
const shutdown = () => {
  console.log("[twikit-service] Shutting down...");
  pythonProcess.kill("SIGTERM");
  setTimeout(() => {
    pythonProcess.kill("SIGKILL");
    process.exit(1);
  }, 5000);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
