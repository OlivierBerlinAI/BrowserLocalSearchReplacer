# Static server only: no build step, no dependencies.
FROM node:22-alpine

WORKDIR /app
COPY package.json server.js ./
COPY public ./public

ENV PORT=8080 HOST=0.0.0.0 NODE_ENV=production
EXPOSE 8080
USER node

HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:8080/').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
