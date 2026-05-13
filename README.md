/volume1/Web/
│
├── building/
│   │
│   ├── node_modules/ (190 элементов)
│   │
│   ├── docker-project/
│   │   ├── nginx/
│   │   │   └── nginx.conf (конфиг прокси)
│   │   ├── node/
│   │   │   ├── Dockerfile (инструкция сборки)
│   │   │   └── package.json (зависимости для докера)
│   │   └── docker-compose.yml (оркестрация)
│   │
│   ├── public/
│   │   ├── css/
│   │   │   └── style.css (стили)
│   │   ├── js/
│   │   │   ├── background-animation.js (анимация фона)
│   │   │   ├── config.js (единый файл конфигурации)
│   │   │   ├── cookie-consent.js (модуль уведомления о cookie)
│   │   │   ├── main.js (основная логика)
│   │   │   ├── navigation.js (единый шаблон навигации, футера и модалок)
│   │   │   └── three.min.js (лёгкий граф)
│   │   ├── contacts.html
│   │   ├── index.html
│   │   └── services.html
│   │
│   ├── ssl/
│   │   ├── cert.pem (сертификат)
│   │   └── privkey.pem (приватный ключ)
│   │
│   ├── .env (данные ADMIN_PASSWORD, PORT, SESSION_SECRET, ADMIN_TOKEN)
│   ├── LICENSE (лицензия)
│   ├── blocked_ips.json (заблокированные боты)
│   ├── construction.db (база данных)
│   ├── package.json (зависимости)
│   ├── README.md (структура)
│   └── server.js (серверная часть)
│
└── docker-project/ (УПРАВЛЕНИЕ)
    ├── node/
    │   ├── Dockerfile (как собрать образ)
    │   └── package.json (зависимости для контейнера)
    ├── nginx/
    │   └── nginx.conf (конфиг прокси)
    └── docker-compose.yml (пускатель)

                           ↓ ↓ ↓ ↓ ↓ ↓ ↓ ↓ ↓ ↓
                    ╔══════════════════════════════════════╗
                    ║                                      ║
                    ║                                      ║
                    ║   Как файлы попадают в контейнер?    ║
                    ║                                      ║
                    ║ ВАРИАНТ А (МОНТИРОВАНИЕ МОЙ ВАРИАНТ) ║
                    ║   ┌─────────────────────────────┐    ║
                    ║   │ /volume1/Web/building/      │    ║
                    ║   │         ↓ (mount)           │    ║
                    ║   │ Контейнер /app/             │    ║
                    ║   └─────────────────────────────┘    ║
                    ║                                      ║
                    ║   ВАРИАНТ Б (КОПИРОВАНИЕ)            ║
                    ║   ┌─────────────────────────────┐    ║
                    ║   │ /volume1/Web/building/      │    ║
                    ║   │         ↓ (COPY)            │    ║
                    ║   │ Контейнер /app/             │    ║
                    ║   └─────────────────────────────┘    ║
                    ╚══════════════════════════════════════╝