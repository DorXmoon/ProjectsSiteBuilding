FROM node:18-alpine

WORKDIR /app

# Зависимости
COPY package*.json ./
RUN npm install --production

# Код и статика (БД и blocked_ips монтируются через volume, .env через env_file)
COPY server.js .
COPY public ./public

EXPOSE 3000

CMD ["node", "server.js"]
