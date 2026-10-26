import { fetchLatestVersion } from "axi-sdk-js";
import { describe, expect, it, vi } from "vitest";

describe("patched dependency registry paths", () => {
  it.each([
    ["jev-axi", "jev-axi"],
    ["@scope/name", "@scope%2fname"],
    ["@scope/name/extra", "@scope%2fname%2fextra"],
    ["@scope//name/extra", "@scope%2f%2fname%2fextra"],
  ])("keeps %s in one registry path segment", async (name, encoded) => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ version: "1.2.3" }), { headers: { "content-type": "application/json" } }));
    const npmView = vi.fn(async () => { throw new Error("unexpected npm fallback"); });
    expect(await fetchLatestVersion(name, { fetchImpl, npmView })).toBe("1.2.3");
    expect(fetchImpl).toHaveBeenCalledWith(`https://registry.npmjs.org/${encoded}/latest`, expect.any(Object));
    expect(npmView).not.toHaveBeenCalled();
  });
});
