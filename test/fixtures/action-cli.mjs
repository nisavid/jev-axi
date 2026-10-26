import { readFileSync } from "node:fs";

const { response, diagnostic } = JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8"));
process.stdin.resume();
process.stdin.on("end", () => {
  if (diagnostic) console.log("diagnostic output");
  console.log(JSON.stringify(response));
});
