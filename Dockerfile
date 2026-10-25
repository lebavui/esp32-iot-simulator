FROM node:20-alpine

WORKDIR /app
COPY --chown=node:node . .

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    PROXY_BLOCK_PRIVATE=1

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/__proxy/ping || exit 1

CMD ["node", "server.js"]
