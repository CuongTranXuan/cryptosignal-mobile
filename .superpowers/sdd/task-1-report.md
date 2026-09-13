# Task 1 Report: PatternShape contract

## What I implemented

I created the shared `PatternShape` fixture at `packages/schema/pattern-shape.fixture.json`.

For the web app, I scaffolded `apps/web` with `package.json`, `tsconfig.json`, `vitest.config.ts`, the contract implementation in `lib/pattern-shape.ts`, and a focused test in `tests/pattern-shape.test.ts`. The Zod contract exports `INTERVALS`, `Interval`, `PatternShapeSchema`, `PatternShape`, `parsePatternShape`, `CandleSchema`, `Candle`, `AnalyzeRequestSchema`, and `AnalyzeRequest`.

For the copilot app, I scaffolded `apps/copilot` with `pyproject.toml`, `src/cryptosignal_copilot/__init__.py`, `src/cryptosignal_copilot/schema.py`, and `tests/test_schema.py`. The Pydantic side exports `INTERVALS`, `Interval`, `PatternShape`, `PatternShapeModel`, `parse_pattern_shape`, `Candle`, `AnalyzeRequest`, `AnalyzeResult`, and `ExtendRange`.

## TDD evidence

### RED

`cd apps/web && pnpm install && pnpm test` initially failed because `apps/web/lib/pattern-shape.ts` did not exist.

`cd apps/copilot && python3 -m venv .venv && .venv/bin/pip install -e ".[dev]" && .venv/bin/pytest tests/test_schema.py -v` initially failed because the editable install could not find `src/`.

### GREEN

After adding the Zod contract, `cd apps/web && pnpm test` passed with 3 tests.

After adding the Python package and fixing the missing `INTERVALS` export, `cd apps/copilot && python3 -m venv .venv && .venv/bin/pip install -e ".[dev]" && .venv/bin/pytest tests/test_schema.py -v` passed.

## Files changed

- `packages/schema/pattern-shape.fixture.json`
- `apps/web/package.json`
- `apps/web/tsconfig.json`
- `apps/web/vitest.config.ts`
- `apps/web/lib/pattern-shape.ts`
- `apps/web/tests/pattern-shape.test.ts`
- `apps/copilot/pyproject.toml`
- `apps/copilot/src/cryptosignal_copilot/__init__.py`
- `apps/copilot/src/cryptosignal_copilot/schema.py`
- `apps/copilot/tests/test_schema.py`

## Self-review

The contracts are strict about extra keys and geometry, and the shared fixture parses in both runtimes. The test coverage is focused on the contract boundary the brief asked for, including rejection of forbidden order-like keys and invalid shape geometry.

## Concerns

The Python dependency set in the brief is heavy, so the first editable install takes time. Functionally, the contract implementation is aligned with the requested shape and the focused tests are green.

## Cleanup Results
- Status: completed
- Commit: 45021e2e (`chore: stop tracking copilot virtualenv`)
- Verification: `git ls-files apps/copilot/.venv | wc -l` = 0
- Tests: `cd apps/copilot && .venv/bin/pytest tests/test_schema.py -v` passed; `cd apps/web && pnpm test` passed

## Follow-up cleanup

I tightened the web contract by making `PointSchema`, `CandleSchema`, and `AnalyzeRequestSchema` strict, while keeping `PatternShapeSchema` strict as well. I also added a focused regression test that verifies unknown keys on a nested point and on a candle now throw.

I updated `.gitignore` to ignore `apps/copilot/src/cryptosignal_copilot.egg-info/`, `**/__pycache__/`, and `**/*.pyc`, then removed the already-tracked Python build artifacts from the index without deleting local files.

### Verification

- `cd apps/web && pnpm test` passed
- `cd apps/copilot && .venv/bin/pytest tests/test_schema.py -v` passed
