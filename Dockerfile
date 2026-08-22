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

FROM ghcr.io/astral-sh/uv:python3.11-bookworm-slim AS runtime

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
