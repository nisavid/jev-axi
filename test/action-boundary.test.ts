import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { parse } from "yaml";

const dirs: string[] = [];
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "jev-action-boundary-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it("ignores inherited Bash functions and startup hooks before introducing Action secrets", () => {
  const action = parse(readFileSync(resolve(__dirname, "..", "action.yml"), "utf8"));
  const step = action.runs.steps.find((s: { id?: string }) => s.id === "run");
  const script = join(tempDir(), "run.sh");
  writeFileSync(script, 'node -e \'process.stdout.write("selected-node")\'\n');
  const [shell, ...args] = step.shell.split(" ");
  const result = spawnSync(shell, args.map((arg: string) => arg === "{0}" ? script : arg), { encoding: "utf8", env: {
    ...process.env, BASH_ENV: "/untrusted/startup", NODE_OPTIONS: "--import=untrusted",
    "BASH_FUNC_node%%": '() { printf "inherited-node"; }', ...step.env,
  } });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stdout).toBe("selected-node");
  for (const name of ["NODE_OPTIONS", "NODE_PATH", "BASH_ENV", "ENV", "LD_PRELOAD", "LD_AUDIT", "LD_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH", "DYLD_FALLBACK_LIBRARY_PATH", "DYLD_FRAMEWORK_PATH", "DYLD_FALLBACK_FRAMEWORK_PATH"]) {
    expect(step.env[name]).toBe("");
  }
});

it("ignores an executable inherited JEV_AXI_BIN while retaining bundled triage output", () => {
  const dir = tempDir();
  cpSync(resolve(__dirname, "..", "action"), join(dir, "action"), { recursive: true });
  cpSync(resolve(__dirname, "..", "package.json"), join(dir, "package.json"));
  // Replace only an isolated test copy, with fixed source and no code interpolation.
  writeFileSync(join(dir, "action/runtime/jev-axi.mjs"), 'process.stdin.resume(); process.stdin.on("end", () => console.log(JSON.stringify({root_cause:{text:"Error: boom",line:1,p:1},context:[]})));');
  const marker = join(dir, "executed");
  const log = join(dir, "job.log");
  const outputs = join(dir, "outputs");
  writeFileSync(log, "Error: boom\n");
  writeFileSync(outputs, "");
  const result = spawnSync(process.execPath, [join(dir, "action/run.mjs")], { encoding: "utf8", env: {
    SystemRoot: process.env.SystemRoot ?? "", GITHUB_OUTPUT: outputs,
    JEV_INPUT_API_KEY: "synthetic-key", JEV_INPUT_MODE: "triage", JEV_INPUT_LOG_FILE: log,
    JEV_INPUT_COMMENT: "false", JEV_AXI_BIN: JSON.stringify([process.execPath, resolve(__dirname, "fixtures/action-sentinel.mjs"), marker]),
  } });
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(readFileSync(outputs, "utf8")).toContain("root-cause=Error: boom");
  expect(existsSync(marker)).toBe(false);
});
