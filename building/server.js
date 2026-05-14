require('dotenv').config();

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const xss = require('xss');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const https = require('https');

const app = express();
// trust proxy ДО любых middleware, иначе req.ip = адрес прокси/loopback,
// а не реальный клиент → банлист, rate-limit и логи писали кашу.
// В Docker с Nginx значение 1 не всегда срабатывает (зависит от цепочки X-Forwarded-For),
// поэтому доверяем всем приватным сетям + loopback. Безопасно: Node наружу не торчит,
// внутрь docker-сети может попасть только Nginx, который и проставляет реальный IP клиента.
app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']);
const PORT = process.env.PORT || 52211;

// compression — раньше не было, html/css/js летели несжатыми
let compression = null;
try { compression = require('compression'); } catch (e) { /* optional */ }

function getLocalIp() {
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return 'localhost';
}

// ========== МИДЛВАРЫ ==========
if (compression) app.use(compression());
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());
// express.static перенесён ВНИЗ — после блокировки сканеров и
// rate-limit'а. Иначе сканер бил по статике, минуя security-цепочку.

// ========== HELMET ==========
app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: false,
        directives: {
            defaultSrc: ["'self'", "https:", "data:"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            scriptSrcAttr: ["'unsafe-inline'"],
            scriptSrcElem: ["'self'", "'unsafe-inline'"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'"],
            // Яндекс.Карты iframe — в Helmet 8 дефолты CSP стали строже,
            // даже defaultSrc:'self' блокирует iframe yandex.ru. Явно разрешаем.
            frameSrc: ["'self'", "https://yandex.ru", "https://*.yandex.ru", "https://yandex.com", "https://*.yandex.com", "https://yandex.com.tr", "https://*.yandex.net"],
            childSrc: ["'self'", "https://yandex.ru", "https://*.yandex.ru", "https://yandex.com", "https://*.yandex.com"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: null,
        },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    // X-Frame-Options блокирует встраивание чужих iframe → отключаем для yandex
    frameguard: false,
}));

// ========== ЗАЩИТА ОТ DDoS ==========
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    message: { error: 'Слишком много запросов. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false,
});
// app.use(globalLimiter) — перенесён после security-middleware ниже,
// чтобы сначала отрезать сканеров, а только потом считать лимит.

// ========== БЛОКИРОВКА СКАНЕРОВ ==========
const blockedPatterns = [
    '.env', 'wp-config', 'phpunit', 'cgi-bin', '.git', 'stripe', 'credentials',
    'config.yml', 'docker-compose', 'info.php', 'phpinfo', 'eval-stdin',
    'actuator', 'swagger', 'vendor', 'composer', 'laravel', 'artisan',
    'server-status', 'xmlrpc.php', 'wp-admin', 'wp-login', 'backup',
    'config.json', 'settings.json', '.aws', 'passwd', 'shadow'
];

// ========== ФАЙЛОВОЕ ЛОГИРОВАНИЕ ==========
// Принцип: логируем ТОЛЬКО ИНЦИДЕНТЫ, не каждый клик.
// Категории: security (атаки), callbacks (заявки), admin (вход в админку),
//            errors (ошибки сервера). НЕТ access-лога — это работа Nginx.
//
// PII (ФЗ-152): IP считаем персональными данными → law basis = «законный
// интерес» (ст. 6 ч.1 п.7) для security/admin. Callbacks — есть согласие
// от пользователя через форму.
//
// Защита от лог-бомб: User-Agent обрезаем до 200 символов, длинные поля — до 500.
// Ротация: при размере >5MB файл переименовывается в .1 (хранится 1 старая копия).
const LOG_DIR = path.join(__dirname, 'logs');
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch(e) { /* exists */ }

const MAX_LOG_BYTES = 5 * 1024 * 1024; // 5MB
const _logSizeCache = new Map(); // category -> { size, lastCheck }

function clipStr(s, max) {
    if (s == null) return '';
    s = String(s);
    return s.length > max ? s.slice(0, max) + '…' : s;
}

function sanitizePayload(p) {
    const out = {};
    for (const k of Object.keys(p)) {
        if (k === 'ua') out[k] = clipStr(p[k], 200);
        else if (typeof p[k] === 'string') out[k] = clipStr(p[k], 500);
        else out[k] = p[k];
    }
    return out;
}

function rotateIfNeeded(file) {
    fs.stat(file, (err, st) => {
        if (err || st.size < MAX_LOG_BYTES) return;
        fs.rename(file, file + '.1', () => { /* atomic; current удалится при следующем appendFile */ });
    });
}

function logToFile(category, payload) {
    const safe = sanitizePayload(payload);
    const line = JSON.stringify({ ts: new Date().toISOString(), ...safe }) + '\n';
    const file = path.join(LOG_DIR, `${category}.log`);
    fs.appendFile(file, line, () => {
        // Проверять размер на каждый append дорого. Делаем debounced проверку.
        const now = Date.now();
        const cache = _logSizeCache.get(category) || { lastCheck: 0 };
        if (now - cache.lastCheck > 60_000) { // раз в минуту
            cache.lastCheck = now;
            _logSizeCache.set(category, cache);
            rotateIfNeeded(file);
        }
    });
}

// ========== ПОСТОЯННАЯ БЛОКИРОВКА АТАКУЮЩИХ IP (НАВСЕГДА) ==========
const BLOCKED_IPS_FILE = path.join(__dirname, 'blocked_ips.json');

let blockedIPs = new Set();
try {
    if (fs.existsSync(BLOCKED_IPS_FILE)) {
        const data = JSON.parse(fs.readFileSync(BLOCKED_IPS_FILE, 'utf8'));
        blockedIPs = new Set(data);
        console.log(`🚫 Загружено ${blockedIPs.size} заблокированных IP из файла`);
    }
} catch(e) { console.log('⚠️ Нет файла с заблокированными IP'); }

// Async + debounced — раньше fs.writeFileSync делался прямо в request-path
// при флуде сканеров → event loop стопорился, файл рисковал биться.
let _saveBlockedTimer = null;
function saveBlockedIPs() {
    if (_saveBlockedTimer) return;
    _saveBlockedTimer = setTimeout(() => {
        _saveBlockedTimer = null;
        const tmp = BLOCKED_IPS_FILE + '.tmp';
        fs.writeFile(tmp, JSON.stringify([...blockedIPs]), 'utf8', (err) => {
            if (err) return console.error('blocked_ips write fail:', err);
            fs.rename(tmp, BLOCKED_IPS_FILE, () => {});
        });
    }, 500);
}

// Счётчик подозрительных запросов (НЕ СБРАСЫВАЕТСЯ, ПОКА НЕ ЗАБЛОКИРУЕТ)
const ipHits = new Map();

// Функция записи атаки в базу данных
function logAttackToDB(ip, url, method, userAgent, reason) {
    const stmt = db.prepare(`INSERT INTO blocked_ips_log (ip_address, url, method, user_agent, reason) VALUES (?, ?, ?, ?, ?)`);
    stmt.run(ip, url, method, userAgent, reason || 'подозрительный запрос', function(err) {
        if (err) {
            console.error('❌ Ошибка записи в БД:', err);
        } else {
            console.log(`📝 Атака записана в БД #${this.lastID}: ${ip} - ${method} ${url}`);
        }
    });
    stmt.finalize();
}

// Скомпилировано один раз — раньше пересоздавался массив + .some(includes)
// на каждый request, включая статику.
const SCANNER_RE = new RegExp(
    '(' + blockedPatterns.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')',
    'i'
);
function isScannerRequest(url) { return SCANNER_RE.test(url); }

const BLOCKED_UA_RE = /(nikto|sqlmap|nmap|masscan|zgrab|httpx|python-requests|\bcurl\b|\bwget\b|go-http-client|\bjava\b)/i;

// MAIN MIDDLEWARE ДЛЯ БЛОКИРОВКИ (БЕЗ СБРОСА СЧЁТЧИКА)
app.use((req, res, next) => {
    const ip = req.ip;
    const url = req.url.toLowerCase();
    const method = req.method;
    const ua = req.headers['user-agent'] || '';

    // 1. Проверка на перманентно заблокированные IP (НАВСЕГДА!)
    if (blockedIPs.has(ip)) {
        console.log(`🚫 ПЕРМАНЕНТНО ЗАБЛОКИРОВАН: ${ip} - ${method} ${url}`);
        logToFile('security', { event: 'permanent_block_hit', ip, method, url, ua });
        return res.status(403).send('Access Denied - Your IP has been permanently blocked');
    }

    // 2. Проверка на сканеры (по подозрительным путям)
    if (isScannerRequest(url)) {
        // Увеличиваем счётчик (НИКОГДА НЕ СБРАСЫВАЕТСЯ)
        const hits = (ipHits.get(ip) || 0) + 1;
        ipHits.set(ip, hits);

        console.log(`⚠️ ПОДОЗРИТЕЛЬНЫЙ IP: ${ip} (попытка #${hits}) - ${method} ${url}`);
        logToFile('security', { event: 'scanner_attempt', ip, hits, method, url, ua });
        logAttackToDB(ip, url, method, ua);

        // После 3 попыток — блокируем НАВСЕГДА (счётчик больше не обнуляется)
        if (hits >= 3) {
            blockedIPs.add(ip);
            saveBlockedIPs();
            console.log(`🔒 IP ${ip} ЗАБЛОКИРОВАН НАВСЕГДА (3 подозрительные попытки)`);
            logToFile('security', { event: 'permanent_block_added', reason: 'scanner_3hits', ip, method, url, ua });
            logAttackToDB(ip, url, method, ua, 'заблокирован навсегда');
            return res.status(403).send('Access Denied - Your IP has been permanently blocked');
        }

        return res.status(403).send('Access Denied');
    }

    // 3. Блокировка по опасным методам
    const dangerousMethods = ['TRACE', 'TRACK', 'DELETE', 'PUT', 'CONNECT', 'PATCH'];
    if (dangerousMethods.includes(method)) {
        const hits = (ipHits.get(ip) || 0) + 1;
        ipHits.set(ip, hits);
        console.log(`🚫 БЛОКИРОВАН МЕТОД: ${method} от ${ip} (попытка #${hits})`);
        logToFile('security', { event: 'dangerous_method', ip, hits, method, url, ua });
        logAttackToDB(ip, url, method, ua, 'опасный метод');

        if (hits >= 3) {
            blockedIPs.add(ip);
            saveBlockedIPs();
            console.log(`🔒 IP ${ip} ЗАБЛОКИРОВАН НАВСЕГДА (3 опасных метода)`);
            logToFile('security', { event: 'permanent_block_added', reason: 'methods_3hits', ip, method, url, ua });
        }
        return res.status(405).send('Method Not Allowed');
    }

    // 4. Блокировка по User-Agent (боты) — компилируется один раз сверху
    if (BLOCKED_UA_RE.test(ua)) {
        const hits = (ipHits.get(ip) || 0) + 1;
        ipHits.set(ip, hits);
        console.log(`🚫 БЛОКИРОВАН БОТ: ${ua} от ${ip} (попытка #${hits})`);
        logToFile('security', { event: 'bad_user_agent', ip, hits, method, url, ua });
        logAttackToDB(ip, url, method, ua, 'бот/сканер');

        if (hits >= 3) {
            blockedIPs.add(ip);
            saveBlockedIPs();
            console.log(`🔒 IP ${ip} ЗАБЛОКИРОВАН НАВСЕГДА (бот)`);
            logToFile('security', { event: 'permanent_block_added', reason: 'bot_3hits', ip, method, url, ua });
        }
        return res.status(403).send('Access Denied');
    }

    // Обычные запросы НЕ логируем (это спам диску + DDoS-усилитель).
    // Если нужен общий журнал доступа — он есть в nginx/access.log на хосте.
    next();
});

// ========== ГЛОБАЛЬНЫЙ RATE-LIMIT (после блокировки сканеров) ==========
// Скипаем статику — иначе ассеты сжирали бы 200/15min лимит обычного юзера.
const STATIC_RE = /\.(?:css|js|svg|png|jpe?g|gif|ico|webp|woff2?|map)$/i;
app.use((req, res, next) => {
    if (STATIC_RE.test(req.path)) return next();
    return globalLimiter(req, res, next);
});

// ========== СТАТИКА (после security-цепочки) ==========
// Бекап-папки (_BACKUP_*) — наружу не светим.
app.use((req, res, next) => {
    if (/\/_BACKUP_/i.test(req.path)) return res.status(404).send('Not found');
    next();
});
app.use(express.static('public', {
    maxAge: '7d',
    etag: true,
    setHeaders(res, filePath) {
        if (/\.html$/i.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
    }
}));

// ========== АДМИНКА ==========
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
    console.error('❌ ОШИБКА: ADMIN_PASSWORD не задан в .env файле!');
    process.exit(1);
}

const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { error: 'Слишком много попыток входа. Подождите 15 минут.' }
});

const adminSecret = crypto.randomBytes(16).toString('hex');

app.get(`/admin-${adminSecret}`, (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`
        <!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"><title>Админка</title>
        <style>
            body{background:#0a0a0a;color:#e0e0e0;display:flex;justify-content:center;align-items:center;height:100vh;font-family:monospace}
            .login-box{background:rgba(255,255,255,0.05);padding:40px;border-radius:20px;border:1px solid #c4511b;width:300px}
            input{width:100%;padding:12px;margin:10px 0;background:#1a1a1a;border:1px solid #c4511b;color:white;border-radius:10px}
            button{width:100%;padding:12px;background:#c4511b;border:none;color:white;border-radius:10px;cursor:pointer;font-weight:bold}
            h1{color:#c4511b;text-align:center}
        </style>
        </head>
        <body>
            <div class="login-box">
                <h1>🔐 Вход в админку</h1>
                <form method="POST" action="/admin-${adminSecret}/login">
                    <input type="password" name="password" placeholder="Введите пароль" required>
                    <button type="submit">Войти</button>
                </form>
            </div>
        </body>
        </html>
    `);
});

app.post(`/admin-${adminSecret}/login`, adminLimiter, express.urlencoded({ extended: true }), (req, res) => {
    if (req.body.password === ADMIN_PASSWORD) {
        res.cookie('admin_auth', adminSecret, { httpOnly: true, maxAge: 3600000, path: '/', sameSite: 'lax' });
        logToFile('admin', { event: 'login_success', ip: req.ip, ua: req.headers['user-agent'] || '' });
        res.redirect(`/admin-${adminSecret}/dashboard`);
    } else {
        logToFile('admin', { event: 'login_fail', ip: req.ip, ua: req.headers['user-agent'] || '' });
        res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Ошибка</title></head><body style="background:#0a0a0a;color:#e0e0e0;text-align:center;padding:50px;"><h1 style="color:#c4511b">❌ Неверный пароль</h1><a href="/admin-${adminSecret}" style="color:#c4511b">← Вернуться</a></body></html>`);
    }
});

app.get(`/admin-${adminSecret}/dashboard`, (req, res) => {
    const auth = req.cookies ? req.cookies.admin_auth : null;
    if (auth !== adminSecret) return res.redirect(`/admin-${adminSecret}`);
    
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    
    db.all("SELECT * FROM callbacks ORDER BY created_at DESC", [], (err, rows) => {
        const grouped = {};
        rows.forEach(row => {
            const date = new Date(row.created_at);
            const day = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
            if (!grouped[day]) grouped[day] = [];
            grouped[day].push(row);
        });
        
        let html = `<!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"><title>Админ-панель</title>
        <style>
            *{margin:0;padding:0;box-sizing:border-box}
            body{background:#0a0a0a;color:#e0e0e0;font-family:'Segoe UI',monospace;padding:20px}
            .container{max-width:1400px;margin:0 auto}
            h1{color:#c4511b;margin-bottom:10px}
            .stats{display:flex;gap:20px;margin:20px 0;flex-wrap:wrap}
            .stat-card{background:#2d2d2d;border-radius:8px;padding:20px;border:1px solid #c4511b}
            .stat-card .number{font-size:36px;font-weight:bold;color:#c4511b}
            .logout-btn{background:#c4511b;border:none;padding:10px 20px;border-radius:8px;margin-bottom:20px;cursor:pointer}
            .logout-btn a{color:white;text-decoration:none}
            .day-group{margin-bottom:30px;background:#2d2d2d;border-radius:8px;overflow:hidden}
            .day-header{background:#c4511b;color:#fff;padding:15px 20px;font-weight:bold}
            .table-wrapper{overflow-x:auto;-webkit-overflow-scrolling:touch}
            table{width:100%;border-collapse:collapse;min-width:600px}
            th,td{padding:12px;text-align:left;border-bottom:1px solid #4a4a4a}
            th{background:#4a4a4a;color:#c4511b}
            tr:hover{background:#3a3a3a}
            /* ====== ПАНЕЛЬ ЛОГОВ ====== */
            .logs-panel{background:#1a1a1a;border:1px solid #c4511b;border-radius:8px;margin-bottom:30px;overflow:hidden;height:50vh;display:flex;flex-direction:column}
            .logs-head{display:flex;align-items:center;background:#2d2d2d;padding:10px 14px;gap:6px;border-bottom:1px solid #4a4a4a;flex-wrap:wrap}
            .logs-head .title{font-weight:bold;color:#c4511b;margin-right:auto}
            .logs-tab{background:#1a1a1a;color:#aaa;border:1px solid #4a4a4a;padding:6px 12px;border-radius:6px;cursor:pointer;font-family:inherit;font-size:13px}
            .logs-tab.active{background:#c4511b;color:#fff;border-color:#c4511b}
            .logs-refresh{font-size:12px;color:#7a8a96;margin-left:8px}
            .logs-body{flex:1;overflow:auto;font-family:'Consolas','Courier New',monospace;font-size:12.5px;padding:10px 14px;background:#0e0e0e}
            .log-line{padding:4px 6px;border-bottom:1px dashed #2a2a2a;line-height:1.4;word-break:break-all}
            .log-line .ts{color:#7a8a96;margin-right:8px}
            .log-line .ip{color:#4fc3f7;font-weight:bold}
            .log-line .ev{color:#ffb74d;margin:0 6px}
            .log-line.security{color:#ff7373}
            .log-line.admin{color:#b39ddb}
            .log-line.callbacks{color:#81c784}
            .log-line.access{color:#cfd8dc}
            @media(max-width:768px){
                body{padding:10px}
                .stats{flex-direction:column}
                .stat-card{width:100%}
                th,td{padding:8px;font-size:12px}
                .logs-panel{height:45vh}
            }
        </style>
        </head>
        <body>
            <div class="container">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap">
                    <h1>📋 Заявки с сайта</h1>
                    <button class="logout-btn"><a href="/admin-${adminSecret}/logout">🚪 Выйти</a></button>
                </div>
                <div class="stats">
                    <div class="stat-card"><div class="number">${rows.length}</div><div>Всего заявок</div></div>
                    <div class="stat-card"><div class="number">${Object.keys(grouped).length}</div><div>Дней с заявками</div></div>
                </div>

                <!-- ====== ПАНЕЛЬ ЛОГОВ ====== -->
                <div class="logs-panel">
                    <div class="logs-head">
                        <span class="title">📜 Логи в реальном времени</span>
                        <button class="logs-tab active" data-cat="security">Безопасность</button>
                        <button class="logs-tab" data-cat="callbacks">Заявки</button>
                        <button class="logs-tab" data-cat="admin">Админка</button>
                        <button class="logs-tab" data-cat="errors">Ошибки</button>
                        <span class="logs-refresh">обновляется каждые 5с</span>
                    </div>
                    <div class="logs-body" id="logsBody">Загрузка...</div>
                </div>
                <script>
                (function(){
                    var current='security', body=document.getElementById('logsBody');
                    function escapeHtml(s){return String(s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
                    function render(cat,lines){
                        if(!lines.length){body.innerHTML='<div style="color:#7a8a96;padding:20px">Логов ещё нет</div>';return;}
                        body.innerHTML=lines.map(function(l){
                            var ts=l.ts?new Date(l.ts).toLocaleString('ru-RU'):'';
                            var ev=l.event||'';
                            var ip=l.ip||'';
                            var rest=Object.keys(l).filter(function(k){return['ts','event','ip','ua'].indexOf(k)<0;}).map(function(k){return k+'='+(typeof l[k]==='object'?JSON.stringify(l[k]):l[k]);}).join(' ');
                            return '<div class="log-line '+cat+'"><span class="ts">'+escapeHtml(ts)+'</span>'+
                                   (ip?'<span class="ip">'+escapeHtml(ip)+'</span>':'')+
                                   (ev?'<span class="ev">['+escapeHtml(ev)+']</span>':'')+
                                   '<span>'+escapeHtml(rest)+'</span></div>';
                        }).join('');
                    }
                    function load(){
                        fetch('/admin-${adminSecret}/api/logs?category='+current+'&limit=200',{credentials:'same-origin'})
                          .then(function(r){return r.json();})
                          .then(function(d){render(current,d.lines||[]);})
                          .catch(function(){body.innerHTML='<div style="color:#ff7373;padding:20px">Ошибка загрузки логов</div>';});
                    }
                    document.querySelectorAll('.logs-tab').forEach(function(t){
                        t.addEventListener('click',function(){
                            document.querySelectorAll('.logs-tab').forEach(function(x){x.classList.remove('active');});
                            t.classList.add('active');
                            current=t.dataset.cat;
                            load();
                        });
                    });
                    load();
                    setInterval(load,5000);
                })();
                </script>`;
        
        for (const [day, dayRows] of Object.entries(grouped)) {
            html += `<div class="day-group">
                <div class="day-header">📅 ${day} (${dayRows.length} заявок)</div>
                <div class="table-wrapper">
                    <table>
                        <thead>
                            <tr>
                                <th class="id-col">ID</th>
                                <th>Имя</th>
                                <th>Телефон</th>
                                <th>Услуга</th>
                                <th class="ip-col">IP адрес</th>
                                <th class="date-col">Дата и время</th>
                            </tr>
                        </thead>
                        <tbody>`;
            
            dayRows.forEach(row => {
                const displayDate = new Date(row.created_at);
                const dateStr = displayDate.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
                const timeStr = displayDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                const safeName = xss(row.name || '');
                const safeInfo = xss(row.info || '-');
                html += `
                    <tr>
                        <td class="id-col">${row.id}</td>
                        <td>${safeName}</td>
                        <td>${row.phone}</td>
                        <td>${safeInfo}</td>
                        <td class="ip-col">${row.ip_address || '-'}</td>
                        <td class="date-col">${dateStr} ${timeStr}</td>
                    </tr>`;
            });
            
            html += `
                        </tbody>
                    </table>
                </div>
            </div>`;
        }
        
        // Добавляем таблицу с атаками
        db.all("SELECT * FROM blocked_ips_log ORDER BY id DESC LIMIT 100", [], (err, attackRows) => {
            if (!err && attackRows && attackRows.length > 0) {
                html += `<div class="day-group">
                    <div class="day-header">⚠️ ЗАБЛОКИРОВАННЫЕ АТАКИ (последние 100)</div>
                    <div class="table-wrapper">
                        <table>
                            <thead>
                                <tr>
                                    <th>ID</th>
                                    <th>IP адрес</th>
                                    <th>Метод</th>
                                    <th>URL</th>
                                    <th>Дата и время</th>
                                </tr>
                            </thead>
                            <tbody>`;
                attackRows.forEach(attack => {
                    const attackDate = new Date(attack.created_at);
                    const dateStr = attackDate.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
                    const timeStr = attackDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    html += `<tr>
                        <td>${attack.id}</td>
                        <td>${attack.ip_address}</td>
                        <td>${attack.method || '-'}</td>
                        <td style="word-break:break-all;">${attack.url || '-'}</td>
                        <td>${dateStr} ${timeStr}</td>
                    </tr>`;
                });
                html += `</tbody></table></div></div>`;
            }
            html += `</div></body></html>`;
            res.send(html);
        });
        return;
    });
});

app.get(`/admin-${adminSecret}/logout`, (req, res) => {
    res.clearCookie('admin_auth');
    res.redirect(`/admin-${adminSecret}`);
});

// API для чтения логов (используется в дашборде, обновление в реальном времени)
const ALLOWED_LOG_CATEGORIES = new Set(['security', 'callbacks', 'admin', 'errors']);
app.get(`/admin-${adminSecret}/api/logs`, (req, res) => {
    if ((req.cookies && req.cookies.admin_auth) !== adminSecret) return res.status(403).json({ error: 'forbidden' });
    const category = String(req.query.category || 'access');
    if (!ALLOWED_LOG_CATEGORIES.has(category)) return res.status(400).json({ error: 'bad category' });
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);

    const file = path.join(LOG_DIR, `${category}.log`);
    fs.stat(file, (err, st) => {
        if (err) return res.json({ lines: [] });
        // Читаем последние 512KB файла — даже при больших логах ответ быстрый.
        const READ_BYTES = 512 * 1024;
        const start = Math.max(0, st.size - READ_BYTES);
        const chunks = [];
        fs.createReadStream(file, { start, end: st.size })
            .on('data', c => chunks.push(c))
            .on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                const lines = text.split('\n').filter(Boolean);
                // Если начали с середины строки — отбрасываем первую (может быть «битой»).
                if (start > 0 && lines.length > 0) lines.shift();
                const tail = lines.slice(-limit).reverse(); // новые сверху
                const parsed = tail.map(l => { try { return JSON.parse(l); } catch { return { raw: l }; } });
                res.json({ lines: parsed });
            })
            .on('error', e => res.status(500).json({ error: String(e) }));
    });
});

// ========== БАЗА ДАННЫХ ==========
const db = new sqlite3.Database(path.join(__dirname, 'construction.db'));

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS callbacks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        info TEXT,
        ip_address TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS cookie_consents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        consent_type TEXT,
        analytics INTEGER DEFAULT 0,
        marketing INTEGER DEFAULT 0,
        ip_address TEXT,
        user_agent TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    // Таблица для логов атак (уже должна быть, но на всякий случай)
    db.run(`CREATE TABLE IF NOT EXISTS blocked_ips_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip_address TEXT NOT NULL,
        url TEXT,
        method TEXT,
        user_agent TEXT,
        reason TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    console.log('✅ База данных инициализирована');
});

// Раньше regex выкашивал апострофы, дефисы и обратные слэши —
// ломались имена «О'Коннор», «Анна-Мария». Параметризованные запросы
// + xss() уже защищают от инъекций, дополнительная фильтрация лишняя.
function sanitizeInput(input) {
    if (!input) return '';
    return xss(String(input)).trim();
}

// ========== API ==========
const formLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    message: { success: false, error: 'Вы отправили слишком много заявок. Подождите час.' }
});

// Хоистим prepared statement один раз — раньше создавали заново на каждый POST.
const insertCallbackStmt = db.prepare(
    "INSERT INTO callbacks (name, phone, info, ip_address) VALUES (?, ?, ?, ?)"
);

app.post('/api/callback', formLimiter, [
    body('name').trim().isLength({ min: 2, max: 100 }),
    // phone проверяем по числу цифр после очистки от форматирования —
    // раньше «+7 (916) 961-05-55» (18 символов) валился на isLength{min:10,max:11}.
    body('phone').customSanitizer(v => String(v || '').replace(/\D/g, ''))
                 .isLength({ min: 10, max: 11 }).withMessage('Неверный телефон'),
    body('info').optional().trim().isLength({ max: 500 })
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.json({ success: false, error: 'Некорректные данные' });
    }

    let { name, phone, info } = req.body;
    name = sanitizeInput(name);
    info = sanitizeInput(info);

    if (!name || name.length < 2) {
        return res.json({ success: false, error: 'Имя слишком короткое' });
    }

    insertCallbackStmt.run(name, phone, info || '', req.ip, function(err) {
        if (err) {
            console.error('❌ Ошибка БД:', err);
            logToFile('callbacks', { event: 'db_error', err: String(err), ip: req.ip });
            return res.json({ success: false, error: 'Ошибка сервера' });
        }
        console.log(`✅ Новая заявка #${this.lastID}: ${name} - ${phone}`);
        logToFile('callbacks', { event: 'new_callback', id: this.lastID, name, phone, info, ip: req.ip, ua: req.headers['user-agent'] || '' });
        res.json({ success: true, message: 'Заявка принята! Мы свяжемся с вами.' });
    });
});

// Раньше /api/cookie-consent шёл без rate-limit и без валидации — флудилось
// тривиально. Свой лимитер: 30/час/IP плюс whitelist допустимых типов.
const consentLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
});
const ALLOWED_CONSENT = new Set(['accept_all', 'reject_all', 'custom']);
const insertConsentStmt = db.prepare(
    `INSERT INTO cookie_consents (consent_type, analytics, marketing, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)`
);
app.post('/api/cookie-consent', consentLimiter, [
    body('consent_type').optional().isString().isLength({ max: 20 }),
], (req, res) => {
    let { consent_type, analytics, marketing } = req.body;
    consent_type = sanitizeInput(consent_type || 'custom');
    if (!ALLOWED_CONSENT.has(consent_type)) consent_type = 'custom';

    insertConsentStmt.run(
        consent_type,
        analytics ? 1 : 0,
        marketing ? 1 : 0,
        req.ip || 'unknown',
        (req.headers['user-agent'] || 'unknown').substring(0, 255),
        function(err) {
            if (err) {
                console.error('❌ Ошибка сохранения согласия:', err);
                return res.json({ success: false, error: 'Ошибка сервера' });
            }
            res.json({ success: true, id: this.lastID });
        }
    );
});

// ========== ЗАПУСК СЕРВЕРА ==========
// Production (Docker): plain HTTP на 0.0.0.0 — SSL терминирует Nginx снаружи.
// Local dev: HTTPS если есть сертификаты, иначе HTTP.

const sslPath = path.join(__dirname, 'ssl');
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction) {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`
    ╔══════════════════════════════════════════════════════════╗
    ║   🐳 DOCKER HTTP СЕРВЕР ЗАПУЩЕН                          ║
    ║   🌐 http://0.0.0.0:${PORT} (за Nginx)                    ║
    ╚══════════════════════════════════════════════════════════╝`);
        console.log(`🔐 СЕКРЕТНЫЙ ПУТЬ К АДМИНКЕ: /admin-${adminSecret}\n`);
    });
} else {
    const hasSSL = fs.existsSync(path.join(sslPath, 'privkey.pem')) && fs.existsSync(path.join(sslPath, 'cert.pem'));
    if (hasSSL) {
        try {
            const sslOptions = {
                key: fs.readFileSync(path.join(sslPath, 'privkey.pem')),
                cert: fs.readFileSync(path.join(sslPath, 'cert.pem'))
            };
            https.createServer(sslOptions, app).listen(PORT, '0.0.0.0', () => {
                const localIp = getLocalIp();
                console.log(`
    ╔══════════════════════════════════════════════════════════╗
    ║   🔒 HTTPS СЕРВЕР ЗАПУЩЕН (локально)                     ║
    ║   🌍 САЙТ:    https://${localIp}:${PORT}                  ║
    ║   🔐 АДМИНКА: https://${localIp}:${PORT}/admin-${adminSecret} ║
    ╚══════════════════════════════════════════════════════════╝`);
                console.log(`🔐 СЕКРЕТНЫЙ ПУТЬ К АДМИНКЕ: /admin-${adminSecret}\n`);
            });
        } catch (err) {
            console.log('❌ Ошибка загрузки сертификатов:', err.message);
            startHttpServer();
        }
    } else {
        console.log('⚠️ SSL сертификаты не найдены, запускаем HTTP сервер');
        startHttpServer();
    }
}

function startHttpServer() {
    app.listen(PORT, '0.0.0.0', () => {
        const localIp = getLocalIp();
        console.log(`
    ╔══════════════════════════════════════════════════════════╗
    ║   🌐 HTTP СЕРВЕР ЗАПУЩЕН                                 ║
    ║   🌍 САЙТ:    http://${localIp}:${PORT}                   ║
    ║   🔐 АДМИНКА: http://${localIp}:${PORT}/admin-${adminSecret} ║
    ╚══════════════════════════════════════════════════════════╝`);
        console.log(`🔐 СЕКРЕТНЫЙ ПУТЬ К АДМИНКЕ: /admin-${adminSecret}\n`);
    });
}

process.on('SIGINT', () => {
    console.log('\n🛑 Сервер остановлен');
    db.close();
    process.exit();
});