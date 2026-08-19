# Security Policy

## Supported branch

Security fixes are applied to the default branch of this repository.

## Reporting a vulnerability

Do not open a public issue for a suspected credential exposure, authentication flaw, signal-ingestion bypass, Telegram allowlist bypass, or dependency vulnerability. Use GitHub’s private vulnerability-reporting feature for this repository, or contact the repository owner privately. Include reproduction steps, affected file paths, and impact, but never include live credentials in a report.

## Repository hygiene

Never commit populated `.env` files, API tokens, private keys, password-manager exports, database dumps, session cookies, generated static builds, local logs, or private ideation files. Use `.env.example` only as a variable-name template. Rotate a credential immediately if it is ever pasted into a commit, issue, pull request, log, or chat transcript.
