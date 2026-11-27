import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../..");
const BACKEND_LIB = path.join(REPO_ROOT, "backend/src/lib.rs");
const IPC_DIR = path.join(REPO_ROOT, "frontend/app/ipc");

function extractBackendCommands(libSource: string): Set<string> {
  const match = libSource.match(/tauri::generate_handler!\[([\s\S]*?)\]/);
  if (!match) {
    throw new Error("Could not locate tauri::generate_handler! in backend/src/lib.rs");
  }
  const body = match[1];
  const commands = new Set<string>();
  for (const line of body.split(/\r?\n/)) {
    const cleaned = line.split("//")[0].trim().replace(/,$/, "");
    if (!cleaned) continue;
    const parts = cleaned.split("::");
    const fnName = parts[parts.length - 1]?.trim();
    if (fnName) commands.add(fnName);
  }
  return commands;
}

function extractFrontendInvokes(ipcDir: string): Array<{ file: string; cmd: string }> {
  const files = fs.readdirSync(ipcDir).filter((f) => f.endsWith(".ts"));
  const invokes: Array<{ file: string; cmd: string }> = [];
  const regex = /\binvoke(?:<[^>]+>)?\(\s*["']([^"']+)["']/g;

  for (const file of files) {
    const src = fs.readFileSync(path.join(ipcDir, file), "utf8");
    let m: RegExpExecArray | null;
    while ((m = regex.exec(src)) !== null) {
      invokes.push({ file, cmd: m[1] });
    }
  }
  return invokes;
}

describe("Frontend-Backend IPC Contract", () => {
  it("every frontend invoke() command is registered in backend/src/lib.rs", () => {
    const backendSrc = fs.readFileSync(BACKEND_LIB, "utf8");
    const backendCommands = extractBackendCommands(backendSrc);
    const frontendInvokes = extractFrontendInvokes(IPC_DIR);

    expect(backendCommands.size).toBeGreaterThan(50);
    expect(frontendInvokes.length).toBeGreaterThan(50);

    const missing = frontendInvokes.filter((item) => !backendCommands.has(item.cmd));
    expect(missing).toEqual([]);
  });
});
