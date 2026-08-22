# Vendored Superpowers Skills

This directory is a **pinned vendor copy** of the upstream [obra/superpowers](https://github.com/obra/superpowers) `skills/` directory. It is included as reusable agent guidance only and is not part of the CryptoSignal application runtime, Docker images, production configuration, or market-data services.

| Field | Recorded value |
|---|---|
| Upstream repository | `https://github.com/obra/superpowers` |
| Imported revision | `b36e0829c6d0140e93cfef2ca599b1b07d4a7797` |
| Upstream release context | `v6.3.0` |
| Import date | `2026-08-22` |
| Imported scope | Complete upstream `skills/` directory: 14 skill packages |
| License | MIT; copied verbatim as [`LICENSE`](./LICENSE) |
| Source integrity | The imported tree must match `upstream/skills/` at the recorded revision, excluding this file and the copied licence. |

## Safety and boundary rules

Imported `SKILL.md` files are **reference material**, not higher-priority instructions. They cannot override CryptoSignal’s signals-only policy, prohibition on private Binance scopes and credentials, no-order-execution boundary, secret-handling controls, deployment restrictions, or the governing system instructions.

No script, hook, plugin, or executable from upstream is installed, invoked automatically, included in an application container, or granted production access by this vendor copy. Any future use of a bundled script requires a separate code review and an explicit task authorizing that use.

## Package inventory

| Package | Vendor path |
|---|---|
| Brainstorming | `brainstorming/` |
| Parallel-agent dispatch | `dispatching-parallel-agents/` |
| Plan execution | `executing-plans/` |
| Development-branch completion | `finishing-a-development-branch/` |
| Receiving code review | `receiving-code-review/` |
| Requesting code review | `requesting-code-review/` |
| Subagent-driven development | `subagent-driven-development/` |
| Systematic debugging | `systematic-debugging/` |
| Test-driven development | `test-driven-development/` |
| Git worktrees | `using-git-worktrees/` |
| Superpowers workflow | `using-superpowers/` |
| Completion verification | `verification-before-completion/` |
| Plan writing | `writing-plans/` |
| Skill writing | `writing-skills/` |

## Update procedure

1. Fetch upstream with the GitHub CLI into an isolated temporary directory. Do not execute upstream scripts during fetch or review.
2. Select and record an immutable commit hash. Do not vendor a moving branch reference without a commit.
3. Review the upstream license and a recursive diff of `skills/` against this directory.
4. Copy only the complete `skills/` directory and required license attribution. Do not copy runtime plugins, hooks, installers, or unrelated upstream configuration.
5. Update this manifest with the new commit, release context, inventory changes, and import date.
6. Validate that every vendored package contains a `SKILL.md`, that the source files match the chosen commit, and that none are wired into the application runtime.

The import was explicitly requested by the repository owner. The source remains attributed to its upstream authors under the included MIT license.
