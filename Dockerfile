# databag company OS: one image for any server, VM or laptop.
# AI: point DATABAG_AI_BASE_URL at an Ollama (see docker-compose.yml) or set OPENROUTER_API_KEY.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npx next build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production DATABAG_HOME=/data DATABAG_SMTP_HOST=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/package.json /app/next.config.ts ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/bin ./bin
COPY --from=build /app/shared ./shared
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 4100 2525
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:4100/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "4100", "-H", "0.0.0.0"]
