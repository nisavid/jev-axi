# Maintaining this Jev fork

This fork records a PostToolUse `escalate` verdict without adding a note to the
agent's context. The agent decides when it needs input. Assessments, scores,
verdict precedence, `steer` notes, Stop behavior, and the safety veto remain part
of Jev's contract.

## Source and destinations

- Maintained fork: [nisavid/jev-axi](https://github.com/nisavid/jev-axi), remote
  `origin`.
- Direct upstream: [shiftynick/jev-axi](https://github.com/shiftynick/jev-axi),
  remote `upstream`.
- Upstream baseline: `044fae73a05d5699c4b5c47073f1ffc29d9aa82d` (0.7.2).
- Correction branch: `nisavid/quiet-needs-human`. Keep the primary checkout on
  `main` and work in a sibling worktree.
- Git identity: `Ivan D Vasin <ivan@nisavid.io>`; GitHub identity: `nisavid`.

Verify the live remote endpoints and intended full refs before every
publication or synchronization. Publish task checkpoints to the fork through
`checkpointing-and-publishing-git-work`. Upstream submissions wait for Ivan's
approval of their final content.

## Intentional differences

| Contract | Source | Preservation check |
| --- | --- | --- |
| PostToolUse escalation is recorded silently | `src/commands/hook.ts` | Pure and mixed high `needs_human` results retain `escalate` and produce no note; explanation reports `action: none` |
| Setup and hook guidance describe that behavior | `README.md`, `src/commands/meta.ts`, `src/commands/hook.ts`, `skills/jev-axi/references/repo-setup.md` | Regenerate command references and run `pnpm check:skill` |
| Candidate packages remain private | `package.json` | `private` is true; the fork has no public registry publishing configuration |
| Fork automation performs no release or model-backed review publication | `.github/workflows/` | No inherited npm-release, major-tag, Jev review, or Jev triage workflow; ordinary CI remains |

Keep the upstream package and executable name `jev-axi`, its MIT license and
attribution, and the upstream version in the behavior change. Identify a fork
candidate by its full source commit and archive digest; `jev-axi --version`
alone does not identify a candidate. A public package name or release channel
requires a separate decision.

## Build and qualification

Start from the selected clean commit, install with `pnpm install
--frozen-lockfile`, and run:

```sh
pnpm test
pnpm lint
pnpm check:skill
pnpm build
git diff --check
```

Edit canonical help text before `pnpm build:skill`. Keep `dist/`, dependencies,
fixture state, transcripts, and generated candidate archives out of Git.

Bind each candidate manifest to the source and upstream commits, clean tree,
lockfile digest, Node and package-manager versions, installed dependencies,
validation results, complete built-file inventory, and archive digest. A
package archive does not include its installed dependency tree; adoption must
bind both that tree and the Node runtime.

Qualification observes the built CLI's output and decision records, then the
built candidate in fresh native Claude and Codex sessions. A supplied input
must permit task completion; a missing input must prompt for that input before
the dependent result is written. Require an actual assessment and recorded
verdict: a skipped hook or unreadable transcript is not successful suppression.
Record injected judgments as fixture evidence, not evidence of model accuracy.
Retained Stop, steering, precedence, and safety behavior need their own
regression evidence. Record unsupported harness paths as unqualified.

Installing, replacing, or enabling a live hook requires approval of the
qualified artifact and rollout plan. Retain the previous verified runtime and
configuration before a switch; verify the selected artifact and the observed
hook behavior afterward. Rollback restores that retained runtime and
configuration, followed by the same identity and behavior checks.

## Upstream updates and retirement

Use `syncing-forks-with-upstream` to bind both endpoints, full refs, and fetched
commits. Preserve upstream commit identity: fast-forward when possible,
otherwise merge through `checkpointing-and-publishing-git-work`. Do not rewrite
the fork by replay, squash, or force-sync without a separate decision.

Review the full upstream delta against the differences above. Resolve conflicts
with the owning conflict workflow, regenerate affected references, and rerun
the checks and native qualification affected by the update. Confirm that
publishing or model-backed automation has not returned before enabling any
fork workflow. Updating source does not approve installation.

Keep fork-only maintenance commits out of a proposed upstream contribution.
When upstream supplies the desired behavior, compare its contract and qualify
the replacement. Present removal of the local patch and any fork retirement as
a decision; preserve the last verified candidate until migration is accepted.
