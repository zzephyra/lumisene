FROM node:22-bookworm-slim AS development

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN corepack prepare pnpm@10.17.1 --activate && pnpm install --frozen-lockfile

COPY . .
EXPOSE 5173
CMD ["pnpm", "dev"]

FROM development AS build
RUN pnpm build

# Serve compiled assets; Vite remains available in the development target.
FROM nginx:stable-alpine AS production
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 5173
