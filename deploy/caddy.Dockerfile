# Caddy: HTTPS for every domain, plus the operations app as static files. Build context: ops/
FROM node:22-slim AS ops
WORKDIR /srv/ops
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_API_BASE_URL
ARG VITE_WEB_STORE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL VITE_WEB_STORE_URL=$VITE_WEB_STORE_URL VITE_API_KEY=
RUN npx vite build

FROM caddy:2
COPY --from=ops /srv/ops/dist /srv/ops
COPY --from=config Caddyfile /etc/caddy/Caddyfile
