import { expect, it } from "vitest";

it("deliberately fails the Ubuntu/Node 22 pull request check", () => {
  expect([process.env.GITHUB_EVENT_NAME, process.env.RUNNER_OS, process.versions.node.split(".")[0]])
    .not.toEqual(["pull_request", "Linux", "22"]);
});
