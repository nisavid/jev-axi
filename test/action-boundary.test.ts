import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { parse } from "yaml";

const dirs: string[] = [];
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "jev-action-boundary-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const action = parse(readFileSync(resolve(__dirname, "..", "action.yml"), "utf8"));
const nodeStep = action.runs.steps.find((s: { id?: string }) => s.id === "node");
const runStep = action.runs.steps.find((s: { id?: string }) => s.id === "run");
function shellCommand(step: { shell: string }) {
  // Match the two literal alternatives, without evaluating GitHub expressions.
  const match = step.shell.match(/^\$\{\{ runner.os == 'Windows' && '([^']+)' \|\| '([^']+)' \}\}$/);
  expect(match).not.toBeNull();
  expect(match![1]).toBe("C:/PROGRA~1/Git/bin/bash.exe --noprofile --norc -p -e -o pipefail {0}");
  expect(match![2]).toBe("/bin/bash --noprofile --norc -p -e -o pipefail {0}");
  // The runner splits custom shell commands at the first space, even in quotes.
  return match![process.platform === "win32" ? 1 : 2].split(" ");
}
function clearedEnvironment(step: { env: Record<string, string> }) {
  return Object.fromEntries(Object.entries(step.env).filter(([, value]) => value === ""));
}

it("ignores inherited Bash functions and startup hooks before introducing Action secrets", () => {
  const dir = tempDir();
  const script = join(dir, "run.sh");
  const marker = join(dir, "executed");
  const startup = join(dir, "startup.sh");
  writeFileSync(startup, 'printf startup > "$MARKER"\n');
  writeFileSync(join(dir, "bash"), '#!/bin/sh\nprintf path-shell > "$MARKER"\n');
  chmodSync(join(dir, "bash"), 0o755);
  writeFileSync(script, '[[ -z "$(declare -F node)" ]]\n"$JEV_NODE" -e \'process.stdout.write("selected-node")\'\n');
  const [shell, ...args] = shellCommand(runStep);
  const result = spawnSync(shell, args.map((arg: string) => arg === "{0}" ? script : arg), { encoding: "utf8", env: {
    ...process.env, PATH: dir + delimiter + process.env.PATH, MARKER: marker,
    BASH_ENV: startup, NODE_OPTIONS: "--import=untrusted", OPENSSL_CONF: "/untrusted/openssl.cnf",
    OPENSSL_MODULES: "/untrusted/modules", NODE_TLS_REJECT_UNAUTHORIZED: "0",
    "BASH_FUNC_node%%": '() { printf "inherited-node"; }',
    ...clearedEnvironment(runStep), JEV_NODE: process.execPath,
  } });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stdout).toBe("selected-node");
  expect(existsSync(marker)).toBe(false);
  for (const step of [nodeStep, runStep]) {
    shellCommand(step);
    for (const name of ["NODE_OPTIONS", "NODE_PATH", "BASH_ENV", "ENV", "LD_PRELOAD", "LD_AUDIT", "LD_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH", "DYLD_FALLBACK_LIBRARY_PATH", "DYLD_FRAMEWORK_PATH", "DYLD_FALLBACK_FRAMEWORK_PATH", "OPENSSL_CONF", "OPENSSL_MODULES", "NODE_TLS_REJECT_UNAUTHORIZED"]) {
      expect(step.env[name]).toBe("");
    }
    expect(step.env.NODE_EXTRA_CA_CERTS).toBeUndefined();
  }
});

it("selects a preinstalled absolute Node without changing the caller's PATH", () => {
  const dir = tempDir();
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const bin = join(dir, "node", process.versions.node, arch, ...(process.platform === "win32" ? [] : ["bin"]));
  mkdirSync(bin, { recursive: true });
  const node = join(bin, process.platform === "win32" ? "node.exe" : "node");
  if (process.platform === "win32") cpSync(process.execPath, node);
  else symlinkSync(process.execPath, node);
  const output = join(dir, "output");
  const pathFile = join(dir, "github-path");
  writeFileSync(output, "");
  writeFileSync(pathFile, "unchanged");
  const script = join(dir, "select.sh");
  writeFileSync(script, 'before="$PATH"\n' + nodeStep.run + '\n[[ "$PATH" == "$before" ]]\n');
  const [shell, ...args] = shellCommand(nodeStep);
  const result = spawnSync(shell, args.map((arg: string) => arg === "{0}" ? script : arg), { encoding: "utf8", env: {
    ...process.env, PATH: dir, GITHUB_ACTION_PATH: resolve(__dirname, ".."),
    GITHUB_OUTPUT: output, GITHUB_PATH: pathFile,
    JEV_RUNNER_TOOL_CACHE: dir, JEV_RUNNER_ARCH: arch === "arm64" ? "ARM64" : "X64",
    JEV_RUNNER_OS: process.platform === "win32" ? "Windows" : process.platform === "darwin" ? "macOS" : "Linux",
    ...clearedEnvironment(nodeStep),
  } });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(readFileSync(output, "utf8").replaceAll("\\", "/")).toBe(`node=${node.replaceAll("\\", "/")}\n`);
  expect(readFileSync(pathFile, "utf8")).toBe("unchanged");
  expect(runStep.run).toBe('"$JEV_NODE" "$GITHUB_ACTION_PATH/action/run.mjs"');
  expect(runStep.env.JEV_NODE).toBe("${{ steps.node.outputs.node }}");
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
