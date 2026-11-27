# Contributing

Thanks for helping make jev-axi better. It is small on purpose, so most
contributions are one of three kinds.

## Setup

```sh
pnpm install --frozen-lockfile
pnpm verify
```

`pnpm verify` is the local and CI verification command: type-checking (`lint`),
tests, generated skill validation, build, then a built CLI version smoke test.
CI uses pnpm 10 with Node.js 22 and 24 on Linux, Windows, and macOS.

### Test prerequisites

Tests use fake APIs, so verification runs offline after dependencies are
installed and needs no API key or external services. The action integration
tests in `test/action.test.ts` start a mock GitHub HTTP API on `127.0.0.1`, so
the runner must permit loopback listening. If the host denies local listeners,
use a runner that permits that capability. Skipped or blocked checks do not
count as passing verification.

### Live checks

Run live checks deliberately; they require an API key and network access and may
incur API charges:

```sh
export TYPESAFE_API_KEY=...
pnpm dev -- check "Is this urgent?" --text "ASAP"
pnpm eval
```

See [the evaluation guide](bench/README.md) for case selection and comparisons.

## Improving questions

The most valuable changes are better questions. Every built-in recipe's
questions and thresholds live in `src/recipes/questions.ts`. When you change
one, run the command live on a few real inputs and paste before/after output
in the pull request. Wording matters a lot: a rewrite can move a probability
from 0.2 to 0.7 on the same input.

Rules of thumb from the TypeSafe docs:

- One narrow judgment per question. Split anything that weighs several factors.
- The question id is not sent to the model; put the full meaning in `instructions`.
- Point at parts of the state with backticked paths like `` `F001.patch` ``.
- Use structured `criteria` with `true`/`false` examples when the boundary is subtle.
- Output tokens are free, so add speculative questions rather than making a second call.

## Adding a command

Follow the [AXI principles](https://github.com/kunchenguid/axi): TOON output,
3 to 4 fields per row, definitive empty states, structured errors on stdout,
unknown flags rejected with the valid list, and next-step hints. Add the
command to `src/commands/table.ts` so the home view and generated skill pick
it up, then run `pnpm build:skill`. Add a test that drives it through `main()`
with the fake API in `test/`.

## Pull requests

- Keep each PR to one change.
- Install dependencies with `pnpm install --frozen-lockfile`, then run `pnpm verify`;
  CI runs the same command.
- Never commit an API key. `.env` is gitignored; keep it that way.

## Fork candidates

This fork builds private candidates and has no npm release workflow. Follow
[Build and qualification](docs/fork-maintenance.md#build-and-qualification) to
validate and package a selected commit. A registry release or live-hook switch
requires the separate decision described there.

Keep fork maintenance changes separate from a proposed upstream contribution.
Submit upstream only after Ivan approves the concrete submission.
