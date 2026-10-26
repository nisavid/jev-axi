import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Explicitly imported only by the test harness; production has no injection switch.
const { calls, fixture, installStatus, lateEnv } = JSON.parse(readFileSync(process.env.JEV_ACTION_TEST_CONFIG, "utf8"));
const spawnSync = cp.spawnSync;
cp.spawnSync = (cmd, args, options) => {
  appendFileSync(calls, JSON.stringify({ cmd, args, options }) + "\n");
  if (args[1] === "install") {
    const cli = join(options.cwd, "node_modules/jev-axi/dist/bin/jev-axi.js");
    mkdirSync(dirname(cli), { recursive: true });
    writeFileSync(cli, readFileSync(new URL("./action-cli.mjs", import.meta.url)));
    writeFileSync(join(dirname(cli), "fixture.json"), JSON.stringify(fixture));
    return { status: installStatus, stdout: "", stderr: "installation unavailable" };
  }
  return spawnSync(cmd, args, options);
};
Object.assign(process.env, lateEnv);
syncBuiltinESMExports();
