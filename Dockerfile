FROM node:22-bookworm-slim AS build

WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

RUN corepack enable && groupadd --system cryptosignal && useradd --system --gid cryptosignal --create-home cryptosignal
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist

USER cryptosignal
EXPOSE 3000
CMD ["node", "dist/index.js"]
