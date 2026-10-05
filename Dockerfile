# Playwright image already ships Chromium + OS deps
FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . ./

# one registration run per container start; use Railway cron for repeats
# default: Telegram bot service (always-on). Override CMD with "node register.js" for one-shot.
CMD ["node", "bot.js"]
