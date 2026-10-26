import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM module without type declarations
import { countDiffFiles, renderReview, renderTriage, REVIEW_MARKER, trimJobLog } from "../action/lib.mjs";

const RUN = resolve(__dirname, "..", "action", "run.mjs");

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
async function fakeGitHub(existingComment: boolean) {
  const writes: { method: string; url: string; body: string }[] = [];
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const url = req.url ?? "";
    if (req.method === "GET" && url === "/repos/o/r/pulls/7") {
      res.writeHead(200, { "content-type": "text/plain" }).end("diff --git a/x.js b/x.js\n--- a/x.js\n+++ b/x.js\n@@ -0,0 +1 @@\n+x\n");
    } else if (req.method === "GET" && url.startsWith("/repos/o/r/issues/7/comments")) {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(existingComment ? [{ id: 99, body: `${REVIEW_MARKER}\nold` }] : []));
    } else if (url.startsWith("/repos/o/r/actions/runs/8/jobs")) {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({jobs:[{id:9,name:"build",conclusion:"failure",steps:[]}]}));
    } else if (url === "/repos/o/r/actions/jobs/9/logs") {
      res.writeHead(200, { "content-type": "text/plain" }).end("Error: boom\n");
    } else {
      writes.push({ method: req.method!, url, body });
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ html_url: "https://github.com/o/r/pull/7#c" }));
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, writes, close: () => server.close() };
}

function runAction(envOverrides: Record<string, string>, fake?: string, fetchStub?: string): Promise<{ code: number; stdout: string; outputs: string }> {
  const dir = mkdtempSync(join(tmpdir(), "jev-action-"));
  cpSync(resolve(RUN, ".."), join(dir, "action"), { recursive: true });
  cpSync(resolve(RUN, "..", "..", "package.json"), join(dir, "package.json"));
  const runtime = join(dir, "action", "runtime", "jev-axi.mjs");
  if (fake) writeFileSync(runtime, readFileSync(JSON.parse(fake)[1], "utf8"));
  if (fetchStub) writeFileSync(runtime, fetchStub + readFileSync(runtime, "utf8").replace(/^#!.*\n/, ""));
  const outputs = join(dir, "outputs");
  writeFileSync(outputs, "");
  const env = { PATH: process.env["PATH"] ?? "", SystemRoot: process.env["SystemRoot"] ?? "", GITHUB_REPOSITORY: "o/r", GITHUB_OUTPUT: outputs, GITHUB_STEP_SUMMARY: join(dir, "summary"), JEV_INPUT_GITHUB_TOKEN: "t", ...envOverrides };
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [join(dir, "action", "run.mjs")], { env });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stdout += d));
    child.on("exit", (code) => resolveRun({ code: code ?? 1, stdout, outputs: readFileSync(outputs, "utf8") }));
  });
}

/** A stand-in for `jev-axi diff - --json --full` that returns a fixed verdict. */
function fakeJevAxi(verdict: string): string {
  const script = join(mkdtempSync(join(tmpdir(), "jev-fake-")), "jev.mjs");
  const out = review(verdict, [{ file: "x.js", "+/-": "+1/-0", risk: 1, band: "act", flags: verdict === "ok" ? "-" : "secrets" }]);
  // Stray output before the JSON must not break parsing.
  writeFileSync(script, `process.stdin.resume(); process.stdin.on("end", () => { console.log("npm warn something"); console.log(${JSON.stringify(JSON.stringify(out, null, 2))}); });`);
  return JSON.stringify([process.execPath, script]);
}

describe("action run", () => {
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
      const r = await runAction({ GITHUB_API_URL: gh.url, JEV_INPUT_API_KEY: "k", JEV_INPUT_PR_NUMBER: "7" }, fakeJevAxi("ok"));
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
  });
});

describe("revision-bound runtime", () => {
  it("passes only the API key and explicit runtime settings to the fixed CLI", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jev-boundary-"));
    const capture = join(dir, "env.json");
    const log = join(dir, "log");
    const script = join(dir, "fake.mjs");
    writeFileSync(log, "Error: boom\n");
    writeFileSync(script, `import fs from "node:fs";fs.writeFileSync(${JSON.stringify(capture)},JSON.stringify({env:process.env,args:process.argv.slice(2)})); console.log(JSON.stringify({root_cause:{text:"Error: boom",line:1,p:1},context:[]}));`);
    const r = await runAction({ JEV_INPUT_API_KEY: "k", JEV_INPUT_MODE: "triage", JEV_INPUT_LOG_FILE: log, JEV_INPUT_MODEL: "jev-preview", JEV_AXI_BIN: "invalid override", TYPESAFE_BASE_URL: "https://attacker.invalid", GH_TOKEN: "secret", GITHUB_TOKEN: "secret", UNRELATED_SECRET: "secret", NODE_OPTIONS: "--no-warnings", NODE_PATH: dir, npm_config_registry: "https://attacker.invalid", PATH: "" }, JSON.stringify([process.execPath, script]));
    expect(r.code, r.stdout).toBe(0);
    expect(r.outputs).toContain("root-cause=Error: boom");
    const call = JSON.parse(readFileSync(capture, "utf8"));
    // Compare with an equally restricted native Node child: Windows and macOS
    // add system variables during startup even when spawn receives an explicit env.
    const baseline = spawnSync(process.execPath, ["-e", "console.log(JSON.stringify(process.env))"], {
      encoding: "utf8", shell: false,
      env: { SystemRoot: process.env.SystemRoot ?? "", TYPESAFE_API_KEY: "k", NO_UPDATE_NOTIFIER: "1" },
    });
    expect(baseline.status).toBe(0);
    expect(call.env).toEqual(JSON.parse(baseline.stdout));
    for (const name of ["JEV_INPUT_GITHUB_TOKEN", "JEV_INPUT_API_KEY", "GH_TOKEN", "GITHUB_TOKEN", "UNRELATED_SECRET", "NODE_OPTIONS", "NODE_PATH", "npm_config_registry", "TYPESAFE_BASE_URL", "JEV_AXI_BIN"]) {
      expect(call.env).not.toHaveProperty(name);
    }
    expect(call.args).toEqual(["triage", "-", "--json", "--model", "jev-preview"]);
  });
  it.each(["latest", "file:/tmp/evil", "https://attacker.invalid/cli.tgz", "0.7.2 --package evil"])("rejects version %s in both modes", async (version) => {
    for (const mode of ["review", "triage"]) {
      const r = await runAction({ JEV_INPUT_API_KEY: "k", JEV_INPUT_MODE: mode, JEV_INPUT_VERSION: version });
      expect(r.code).toBe(1);
      expect(r.stdout).toContain("select another Action ref");
      expect(r.outputs).toBe("");
    }
  });
  it.each(["review", "triage", "workflow-run"])("executes the real standalone bundle for %s", async (mode) => {
    const gh = await fakeGitHub(false);
    const dir = mkdtempSync(join(tmpdir(), "jev-bundle-"));
    const log = join(dir, "log");
    writeFileSync(log, "Error: boom\n");
    const stub = `globalThis.fetch = async (url, init) => {
      if (new URL(url).origin !== "https://api.typesafe.ai") throw Error("Unexpected endpoint");
      if (new Headers(init.headers).get("Authorization") !== "Bearer k") throw Error("Missing API key");
      const body=JSON.parse(init.body);
      const answers=Object.fromEntries(Object.entries(body.questions).map(([id,q])=> {
        if(q.type==="noul") return [id,{type:"noul",noul:id==="has_error"?0.99:0.01}];
        if(q.type==="choice"){const keys=Object.keys(q.criteria);return [id,{type:"choice",choice:keys[0],probabilities:Object.fromEntries(keys.map((k,i)=>[k,i===0?1:0])),confidence:1}];}
        return [id,{type:"score",score:0,legend:Object.fromEntries(q.criteria.map((v,i)=>[String(i),v])),probabilities:Object.fromEntries(q.criteria.map((v,i)=>[String(i),i===0?1:0])),confidence:1}];
      }));
      return new Response(JSON.stringify({model:"jev-test",answers,usage:{input_tokens:100,output_tokens:10}}),{headers:{"content-type":"application/json"}});
    };\n`;
    try {
      const r = await runAction({ GITHUB_API_URL: gh.url, JEV_INPUT_API_KEY: "k", JEV_INPUT_MODE: mode === "review" ? "review" : "triage", JEV_INPUT_RUN_ID: "8", JEV_INPUT_PR_NUMBER: "7", JEV_INPUT_LOG_FILE: mode === "workflow-run" ? "" : log, JEV_INPUT_VERSION: "0.7.2", JEV_INPUT_COMMENT: "false", PATH: "", TYPESAFE_BASE_URL: "https://attacker.invalid", HOME: dir, XDG_CONFIG_HOME: dir, XDG_CACHE_HOME: dir, XDG_STATE_HOME: dir }, undefined, stub);
      expect(r.code, r.stdout).toBe(0);
      expect(r.outputs).toContain(mode === "review" ? "verdict=ok" : "root-cause=Error: boom");
    } finally { gh.close(); }
  });
});
