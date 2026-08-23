# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS node-build

WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-bookworm-slim AS node-production

WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --prod

FROM ghcr.io/astral-sh/uv:python3.11-bookworm-slim AS python-build

WORKDIR /app/engines/freqtrade
ENV UV_COMPILE_BYTECODE=1
ENV UV_LINK_MODE=copy
COPY engines/freqtrade/pyproject.toml engines/freqtrade/uv.lock ./
RUN uv sync --no-dev --frozen --no-install-project
COPY engines/freqtrade ./
RUN uv sync --no-dev --frozen --no-install-project

FROM node:22-bookworm-slim AS node-runtime

FROM ghcr.io/astral.sh/uv:python3.11-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV PATH="/app/engines/freqtrade/.venv/bin:${PATH}"

# Keep the Python base used for the venv, then layer in the Node 22 runtime.
COPY --from=node-runtime /usr/local/ /usr/local/
RUN groupadd --system cryptosignal && useradd --system --gid cryptosignal --create-home cryptosignal

COPY package.json pnpm-lock.yaml .npmrc ./
COPY --from=node-production /app/node_modules ./node_modules
COPY --from=node-build /app/dist ./dist
COPY --from=node-build /app/engines/freqtrade ./engines/freqtrade
COPY --from=python-build /app/engines/freqtrade/.venv ./engines/freqtrade/.venv

USER cryptosignal
EXPOSE 3000
CMD ["node", "dist/server/_core/index.js"]

# A deterministic test image. It keeps the pnpm development dependencies from
# node-build and adds the locked Freqtrade virtual environment so the complete
# validation suite can run through Docker rather than the operator host.
FROM python-build AS python-test

WORKDIR /app/engines/freqtrade
RUN uv sync --all-groups --frozen --no-install-project

FROM ghcr.io/astral-sh/uv:python3.11-bookworm-slim AS test-runner

WORKDIR /app
ENV NODE_ENV=test
ENV PATH="/app/engines/freqtrade/.venv/bin:${PATH}"

COPY --from=node-runtime /usr/local/ /usr/local/
COPY --from=node-build /app /app
COPY --from=python-test /app/engines/freqtrade/.venv ./engines/freqtrade/.venv
