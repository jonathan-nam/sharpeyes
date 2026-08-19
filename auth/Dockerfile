# syntax=docker/dockerfile:1
FROM node:22-slim AS build
WORKDIR /app

RUN corepack enable

# Deps first, on the lockfile alone, so editing a source file does not reinstall.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
RUN pnpm run build

# Drops the devDependencies the build needed. `pnpm prune` will not do this on a
# store-linked install; a second frozen install with --prod resolves the same lockfile.
RUN pnpm install --frozen-lockfile --prod

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./

# node's own unprivileged user, already in the base image.
USER node

EXPOSE 3001
CMD ["node", "dist/server.js"]
