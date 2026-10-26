import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";

/** Install without credentials, then run only the selected CLI with its API key. */
export function createRuntime(version) {
  // The input denotes a public npm version/range/tag, never an alias, URL, or path.
  if (!version || /[/\\:@\x00-\x1f]/.test(version)) throw new Error("version must be a public jev-axi npm version, range, or tag");
  const node = realpathSync(process.execPath);
  const nodeDir = dirname(node);
  // setup-node distributions ship npm beside Node (Windows) or under ../lib (Unix).
  const npm = [join(nodeDir, "node_modules/npm/bin/npm-cli.js"), resolve(nodeDir, "../lib/node_modules/npm/bin/npm-cli.js")].find(existsSync);
  if (!npm) throw new Error("The Action needs Node with its bundled npm; run actions/setup-node first");
  const dir = mkdtempSync(join(tmpdir(), "jev-action-runtime-"));
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  // Do not inherit executable selectors, Node loaders, npm config, GitHub tokens,
  // or workspace/user config. The only secret passed to the CLI is its API key.
  const env = {
    PATH: nodeDir,
    HOME: dir,
    USERPROFILE: dir,
    APPDATA: dir,
    LOCALAPPDATA: dir,
    TMPDIR: dir,
    TMP: dir,
    TEMP: dir,
    CI: "true",
    NO_UPDATE_NOTIFIER: "1",
  };
  if (process.platform === "win32") {
    env.SystemRoot = process.env.SystemRoot;
    env.PATH += delimiter + join(env.SystemRoot, "System32");
  }
  const options = { cwd: dir, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: false };
  try {
    const userConfig = join(dir, "user.npmrc");
    const globalConfig = join(dir, "global.npmrc");
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "jev-action-runtime", private: true }));
    writeFileSync(userConfig, "");
    writeFileSync(globalConfig, "");
    const installed = spawnSync(node, [npm, "install", `--prefix=${dir}`, "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false",
      "--registry=https://registry.npmjs.org/", `--userconfig=${userConfig}`, `--globalconfig=${globalConfig}`,
      `--cache=${join(dir, "npm-cache")}`, "--", `jev-axi@${version}`], options);
    if (installed.status !== 0) throw new Error(`Could not install jev-axi: ${failure(installed)}`);
    const cli = join(dir, "node_modules/jev-axi/dist/bin/jev-axi.js");
    // Require the expected package entry point, rather than a PATH-resolved bin.
    if (!existsSync(cli)) throw new Error("Installed jev-axi has no dist/bin/jev-axi.js entry point");
    return {
      cleanup,
      run(args, stdin, apiKey, model) {
        const result = spawnSync(node, [cli, ...args, "--json", ...(model ? ["--model", model] : [])], {
          ...options, input: stdin, env: { ...env, TYPESAFE_API_KEY: apiKey },
        });
        const out = (result.stdout ?? "").trim();
        if (result.status === 0) {
          // Tolerate diagnostic output before the JSON document.
          const start = out.startsWith("{") ? 0 : out.indexOf("\n{") + 1;
          try {
            return JSON.parse(out.slice(start));
          } catch {
            // Report the CLI failure below.
          }
        }
        throw new Error(failure(result));
      },
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}

function failure(result) {
  return ((result.stdout ?? "").trim() || result.stderr || result.error?.message || `exit ${result.status}`).split("\n").slice(0, 3).join(" ");
}
