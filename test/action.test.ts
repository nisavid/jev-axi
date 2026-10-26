import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
// @ts-expect-error plain ESM module without type declarations
import { countDiffFiles, renderReview, renderTriage, REVIEW_MARKER, trimJobLog } from "../action/lib.mjs";

const RUN = resolve(__dirname, "..", "action", "run.mjs");
const PRELOAD = resolve(__dirname, "fixtures", "action-preload.mjs");
const SENTINEL = resolve(__dirname, "fixtures", "action-sentinel.mjs");
const temporary: string[] = [];
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "jev-action-test-"));
  temporary.push(dir);
  return dir;
}
afterEach(() => { for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const review = (verdict: string, files: object[]) => ({ diff: "stdin", verdict, kind: "feature (0.8)", scope: "focused (0.1 of 0..2)", files, usage: "100in/10out" });

describe("action rendering", () => {
  it("renders flagged files, escapes table cells, and warns on credentials", () => {
    const md = renderReview(
      review("block", [
        { file: "src/a|b.ts", "+/-": "+3/-1", risk: 1.6, band: "act", flags: "secrets,high-risk" },
        { file: "README.md", "+/-": "+1/-0", risk: 0.1, band: "act", flags: "-" },
      ]),
    );
    expect(md.startsWith(REVIEW_MARKER)).toBe(true);
    expect(md).toContain("⛔ jev-axi review: block");
    expect(md).toContain("**Kind:** feature · **Scope:** focused · 1 flagged of 2 files");
    expect(md).toContain("| `src/a\\|b.ts` | +3/-1 | 1.6 | secrets, high-risk |");
    expect(md).toContain("[!CAUTION]");
    expect(md).toContain("<summary>All 2 files</summary>");
  });

  it("renders triage results, failures to triage, and clean logs", () => {
    const md = renderTriage([
      { name: "test", triage: { root_cause: { line: 12, p: 0.9, text: "Error: `boom`" }, category: "test (0.9, act)", flaky: "0.1", severity: "total", context: ["11: a", "12: Error: boom"] } },
      { name: "lint", error: "no key" },
      { name: "build", triage: { log: "stdin (last 20 of 20 lines)", verdict: "no failure detected" } },
    ]);
    expect(md).toContain("#### ❌ test");
    expect(md).toContain("**Likely cause** (line 12, p=0.9): `Error: 'boom'`");
    expect(md).toContain("Could not triage: no key");
    expect(md).toContain("#### ✅ build");
  });

  it("shows a root cause shared by several matrix jobs once", () => {
    const failure = (text: string) => ({ root_cause: { line: 9, p: 0.8, text }, category: "test", flaky: "0.1", severity: "partial", context: [] });
    const md = renderTriage([
      { name: "test (ubuntu-latest, 22) › Run pnpm test", triage: failure("FAIL test/a.test.ts > adds 12ms") },
      { name: "test (windows-latest, 22) › Run pnpm test", triage: failure("FAIL test/a.test.ts > adds 31ms") },
      { name: "lint", triage: failure("src/x.ts(3,1): error TS2304") },
    ]);
    expect(md).toContain("#### ❌ 2 jobs › Run pnpm test: test (ubuntu-latest, 22), test (windows-latest, 22)");
    expect(md).toContain("#### ❌ lint");
    expect(md.match(/Likely cause/g)).toHaveLength(2);
  });

  it("trims job logs to the last error and strips timestamps and groups", () => {
    const log = [
      "2026-09-17T13:04:27.2466084Z ##[group]Run pnpm test",
      "2026-09-17T13:04:27.2466084Z FAIL test/a.test.ts",
      "2026-09-17T13:04:28.0000000Z ##[error]Process completed with exit code 1.",
      "2026-09-17T13:04:29.0000000Z Post job cleanup.",
    ].join("\n");
    expect(trimJobLog(log)).toBe("FAIL test/a.test.ts\n##[error]Process completed with exit code 1.");
    expect(countDiffFiles("diff --git a/x b/x\n+1\ndiff --git a/y b/y\n")).toBe(2);
  });
});

/** Fake GitHub API: serves a PR diff and records comment writes. */
async function fakeGitHub(existingComment: boolean, jobs: object[] = []) {
  const writes: { method: string; url: string; body: string }[] = [];
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const url = req.url ?? "";
    if (req.method === "GET" && url === "/repos/o/r/pulls/7") {
      res.writeHead(200, { "content-type": "text/plain" }).end("diff --git a/x.js b/x.js\n--- a/x.js\n+++ b/x.js\n@@ -0,0 +1 @@\n+x\n");
    } else if (req.method === "GET" && url.startsWith("/repos/o/r/actions/runs/")) {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jobs }));
    } else if (req.method === "GET" && url.startsWith("/repos/o/r/actions/jobs/")) {
      res.writeHead(200, { "content-type": "text/plain" }).end("2026-09-17T13:04:27.2466084Z Error: job failed\n");
    } else if (req.method === "GET" && url.startsWith("/repos/o/r/issues/7/comments")) {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(existingComment ? [{ id: 99, body: `${REVIEW_MARKER}\nold` }] : []));
    } else {
      writes.push({ method: req.method!, url, body });
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ html_url: "https://github.com/o/r/pull/7#c" }));
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, writes, close: () => server.close() };
}

type Call = { cmd: string; args: string[]; options: { cwd: string; env: Record<string, string>; shell: boolean; input?: string } };
type Fixture = { response: object; diagnostic?: boolean };
function runAction(envOverrides: Record<string, string>, fixture = fakeJevAxi("ok"), installStatus = 0, cwd = tempDir(), lateEnv: Record<string, string> = {}): Promise<{ code: number; stdout: string; outputs: string; summary: string; calls: Call[] }> {
  const dir = tempDir();
  const outputs = join(dir, "outputs");
  const calls = join(dir, "calls.jsonl");
  const config = join(dir, "fixture-config.json");
  writeFileSync(outputs, "");
  // Test-only injection. Production has no environment flag or alternate runner.
  // Only npm installation is replaced; the installed stand-in runs as a real child.
  writeFileSync(config, JSON.stringify({ calls, fixture, installStatus, lateEnv }));
  const env = { PATH: process.env["PATH"] ?? "", SystemRoot: process.env["SystemRoot"] ?? "", GITHUB_REPOSITORY: "o/r", GITHUB_OUTPUT: outputs, GITHUB_STEP_SUMMARY: join(dir, "summary"), JEV_INPUT_GITHUB_TOKEN: "t", ...envOverrides, JEV_ACTION_TEST_CONFIG: config };
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, ["--import", pathToFileURL(PRELOAD).href, RUN], { env, cwd });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stdout += d));
    child.on("close", (code) => resolveRun({ code: code ?? 1, stdout, outputs: readFileSync(outputs, "utf8"),
      summary: existsSync(join(dir, "summary")) ? readFileSync(join(dir, "summary"), "utf8") : "",
      calls: existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [],
    }));
  });
}

/** A stand-in for `jev-axi diff - --json --full` that returns a fixed verdict. */
function fakeJevAxi(verdict: string): Fixture {
  const out = review(verdict, [{ file: "x.js", "+/-": "+1/-0", risk: 1, band: "act", flags: verdict === "ok" ? "-" : "secrets" }]);
  // Stray output before the JSON must not break parsing.
  return { response: out, diagnostic: true };
}

describe("action run", () => {
  it("ignores inherited Bash functions and startup hooks before introducing action secrets", () => {
    const action = parse(readFileSync(resolve(__dirname, "..", "action.yml"), "utf8"));
    const step = action.runs.steps.find((s: { id?: string }) => s.id === "run");
    const script = join(tempDir(), "run.sh");
    writeFileSync(script, 'node -e \'process.stdout.write("selected-node")\'\n');
    const [shell, ...args] = step.shell.split(" ");
    const r = spawnSync(shell, args.map((arg: string) => arg === "{0}" ? script : arg), { encoding: "utf8", env: {
      ...process.env, BASH_ENV: "/untrusted/startup", NODE_OPTIONS: "--import=untrusted",
      "BASH_FUNC_node%%": '() { printf "inherited-node"; }', ...step.env,
    } });
    expect(r.error).toBeUndefined();
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("selected-node");
    for (const name of ["NODE_OPTIONS", "NODE_PATH", "LD_PRELOAD", "LD_AUDIT", "LD_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH", "DYLD_FALLBACK_LIBRARY_PATH", "DYLD_FRAMEWORK_PATH", "DYLD_FALLBACK_FRAMEWORK_PATH"]) {
      expect(step.env[name]).toBe("");
    }
  });

  it("reviews a pull request, updates its existing comment, and fails on a credential", async () => {
    const gh = await fakeGitHub(true);
    try {
      const r = await runAction({ GITHUB_API_URL: gh.url, JEV_INPUT_API_KEY: "k", JEV_INPUT_PR_NUMBER: "7" }, fakeJevAxi("block"));
      expect(r.code).toBe(1);
      expect(r.outputs).toContain("verdict=block");
      expect(r.outputs).toContain("flagged=1");
      expect(gh.writes).toHaveLength(1);
      expect(gh.writes[0]!.method).toBe("PATCH");
      expect(gh.writes[0]!.url).toBe("/repos/o/r/issues/comments/99");
    } finally {
      gh.close();
    }
  });

  it("creates a comment when none exists and passes on ok", async () => {
    const gh = await fakeGitHub(false);
    try {
      const r = await runAction({ GITHUB_API_URL: gh.url, JEV_INPUT_API_KEY: "k", JEV_INPUT_PR_NUMBER: "7" });
      expect(r.code).toBe(0);
      expect(gh.writes.map((w) => `${w.method} ${w.url}`)).toEqual(["POST /repos/o/r/issues/7/comments"]);
    } finally {
      gh.close();
    }
  });

  it("skips without failing when there is no api key", async () => {
    const r = await runAction({ JEV_INPUT_API_KEY: "" });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("No api-key: skipped");
    expect(r.calls).toEqual([]);
  });

  it.each(["not JSON", "executable"])("ignores an inherited executable override (%s) in local-log triage", async (override) => {
    const dir = tempDir();
    const marker = join(dir, "executed");
    const selector = override === "executable" ? JSON.stringify([process.execPath, SENTINEL, marker]) : override;
    const log = join(dir, "job.log");
    writeFileSync(log, "Error: boom\n");
    const triage = { root_cause: { line: 1, p: 0.9, text: "Error: boom" }, category: "test", flaky: "0.1", severity: "total", context: [] };
    const fixture = { response: triage };
    const r = await runAction({ JEV_AXI_BIN: selector, JEV_INPUT_API_KEY: "k", JEV_INPUT_MODE: "triage", JEV_INPUT_LOG_FILE: log }, fixture);
    expect(r.code).toBe(0);
    expect(r.outputs).toContain("root-cause=Error: boom");
    expect(existsSync(marker)).toBe(false);
    expect(r.calls[1]!.args.slice(1)).toEqual(["triage", "-", "--json"]);
    expect(r.calls[1]!.options.input).toBe("Error: boom\n");
  });

  it("keeps installation credential-free and isolates the CLI from inherited configuration", async () => {
    const gh = await fakeGitHub(false);
    const cwd = tempDir();
    const malicious = join(cwd, ".npmrc");
    writeFileSync(malicious, "registry=http://untrusted.invalid\nnode-options=--import=untrusted\n");
    try {
      const model = 'model & echo unexpected';
      const r = await runAction({ GITHUB_API_URL: gh.url, JEV_INPUT_API_KEY: "k", JEV_INPUT_PR_NUMBER: "7", JEV_INPUT_VERSION: "^0.7.0", JEV_INPUT_MODEL: model,
        JEV_INPUT_GITHUB_TOKEN: "github-secret", UNRELATED_SECRET: "other-secret", PATH: cwd, NODE_PATH: cwd, npm_config_node_options: "--import=untrusted", NPM_CONFIG_REGISTRY: "http://untrusted.invalid", NPM_CONFIG_USERCONFIG: malicious,
      }, fakeJevAxi("ok"), 0, cwd, { NODE_OPTIONS: "--import=untrusted" });
      expect(r.code).toBe(0);
      expect(r.calls).toHaveLength(2);
      const [install, cli] = r.calls as [Call, Call];
      expect(install.cmd).toBe(realpathSync(process.execPath));
      expect(install.args).toContain("jev-axi@^0.7.0");
      expect(install.args).toContain("--ignore-scripts");
      expect(install.args).toContain("--registry=https://registry.npmjs.org/");
      expect(install.args).toContain(`--prefix=${install.options.cwd}`);
      expect(install.options.cwd).not.toBe(cwd);
      expect(install.options.env.TYPESAFE_API_KEY).toBeUndefined();
      expect(cli.cmd).toBe(realpathSync(process.execPath));
      expect(cli.args.slice(1)).toEqual(["diff", "-", "--full", "--json", "--model", model]);
      expect(cli.options.input).toContain("diff --git");
      expect(cli.options.env.TYPESAFE_API_KEY).toBe("k");
      for (const call of r.calls) {
        expect(call.options.shell).toBe(false);
        expect(call.options.env.HOME).toBe(install.options.cwd);
        expect(call.options.env.PATH).not.toContain(cwd);
        for (const name of ["JEV_AXI_BIN", "JEV_INPUT_API_KEY", "JEV_INPUT_GITHUB_TOKEN", "GITHUB_OUTPUT", "UNRELATED_SECRET", "NODE_OPTIONS", "NODE_PATH", "npm_config_node_options", "NPM_CONFIG_REGISTRY", "NPM_CONFIG_USERCONFIG"]) {
          expect(call.options.env[name]).toBeUndefined();
        }
      }
      expect(existsSync(install.options.cwd)).toBe(false);
    } finally { gh.close(); }
  });

  it("reuses one runtime for fetched job logs", async () => {
    const gh = await fakeGitHub(false, [{ id: 1, name: "test", conclusion: "failure" }, { id: 2, name: "build", conclusion: "failure" }]);
    const triage = { root_cause: { line: 1, p: 0.9, text: "Error: job failed" }, category: "test", flaky: "0.1", severity: "total", context: [] };
    try {
      const r = await runAction({ GITHUB_API_URL: gh.url, JEV_INPUT_API_KEY: "k", JEV_INPUT_MODE: "triage", JEV_INPUT_RUN_ID: "42" }, { response: triage });
      expect(r.code).toBe(0);
      expect(r.calls).toHaveLength(3);
      expect(r.calls[0]!.args.at(-1)).toBe("jev-axi@0.7.2");
      expect(r.calls.slice(1).map((call) => call.options.input)).toEqual(["Error: job failed\n", "Error: job failed\n"]);
      expect(r.outputs).toContain("root-cause=Error: job failed");
    } finally { gh.close(); }
  });

  it("reports install failures and removes the temporary runtime", async () => {
    const gh = await fakeGitHub(false);
    try {
      const r = await runAction({ GITHUB_API_URL: gh.url, JEV_INPUT_API_KEY: "k", JEV_INPUT_PR_NUMBER: "7" }, fakeJevAxi("ok"), 1);
      expect(r.code).toBe(1);
      expect(r.stdout).toContain("Could not install jev-axi");
      expect(r.calls).toHaveLength(1);
      expect(existsSync(r.calls[0]!.options.cwd)).toBe(false);
      expect(gh.writes).toHaveLength(0);
    } finally { gh.close(); }
  });

  it.each(["npm:other-package", "file:/tmp/cli", "https://untrusted.invalid/cli", "../cli"])("rejects non-version package selection %s", async (version) => {
    const gh = await fakeGitHub(false);
    try {
      const r = await runAction({ GITHUB_API_URL: gh.url, JEV_INPUT_API_KEY: "k", JEV_INPUT_PR_NUMBER: "7", JEV_INPUT_VERSION: version });
      expect(r.code).toBe(1);
      expect(r.stdout).toContain("version must be a public jev-axi npm version");
      expect(r.calls).toEqual([]);
    } finally { gh.close(); }
  });
});
