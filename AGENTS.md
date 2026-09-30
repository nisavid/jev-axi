# Maintained Jev fork

Read `docs/fork-maintenance.md` before changing supervision behavior, packaging,
automation, or upstream ancestry. It owns this fork's divergence and validation
requirements. `CONTRIBUTING.md` owns the upstream development conventions.

Use `onboarding-forks-for-agent-maintenance` when changing the fork contract,
`syncing-forks-with-upstream` for upstream integration, and
`checkpointing-and-publishing-git-work` for checkpoints and publication.

Keep behavior changes suitable for upstream review in separate commits from
fork policy and packaging. Submit nothing to `shiftynick/jev-axi` without Ivan's
approval of the concrete submission. Installing or switching a live hook also
requires a separate rollout decision.
