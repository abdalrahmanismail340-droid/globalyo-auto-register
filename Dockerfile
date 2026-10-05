# Playwright image already ships Chromium + OS deps
FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY register.js fwd-proxy.js ./

# one registration run per container start; use Railway cron for repeats
CMD ["node", "register.js"]
