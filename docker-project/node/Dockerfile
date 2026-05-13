FROM node:18-alpine

WORKDIR /app

# Копируем package.json и устанавливаем зависимости
COPY package*.json ./
RUN npm install --production

# Копируем остальные файлы
COPY server.js .
COPY public ./public
COPY ssl ./ssl
COPY construction.db ./construction.db
COPY blocked_ips.json ./blocked_ips.json
COPY .env ./.env

EXPOSE 52211

CMD ["node", "server.js"]
