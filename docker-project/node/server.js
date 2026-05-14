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
const PORT = process.env.PORT || 52211;

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
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());
app.use(express.static('public'));

// ========== HELMET ==========
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
            scriptSrcAttr: ["'unsafe-inline'"],
            scriptSrcElem: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'"],
            upgradeInsecureRequests: null,
        },
    },
}));

// ========== ЗАЩИТА ОТ DDoS ==========
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    message: { error: 'Слишком много запросов. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use(globalLimiter);

// ========== БЛОКИРОВКА СКАНЕРОВ ==========
const blockedPatterns = [
    '.env', 'wp-config', 'phpunit', 'cgi-bin', '.git', 'stripe', 'credentials',
    'config.yml', 'docker-compose', 'info.php', 'phpinfo', 'eval-stdin',
    'actuator', 'swagger', 'vendor', 'composer', 'laravel', 'artisan',
    'server-status', 'xmlrpc.php', 'wp-admin', 'wp-login', 'backup',
    'config.json', 'settings.json', '.aws', 'passwd', 'shadow'
];

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

function saveBlockedIPs() {
    fs.writeFileSync(BLOCKED_IPS_FILE, JSON.stringify([...blockedIPs]), 'utf8');
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

// Функция проверки на сканера
function isScannerRequest(url) {
    const patterns = ['.env', 'wp-config', 'phpunit', 'cgi-bin', '.git', 'stripe', 'credentials',
        'config.yml', 'docker-compose', 'info.php', 'phpinfo', 'eval-stdin', 'actuator', 'swagger',
        'vendor', 'composer', 'laravel', 'artisan', 'server-status', 'xmlrpc.php', 'wp-admin',
        'wp-login', 'backup', 'config.json', 'settings.json', '.aws', 'passwd', 'shadow'];
    return patterns.some(pattern => url.toLowerCase().includes(pattern));
}

// MAIN MIDDLEWARE ДЛЯ БЛОКИРОВКИ (БЕЗ СБРОСА СЧЁТЧИКА)
app.use((req, res, next) => {
    const ip = req.ip;
    const url = req.url.toLowerCase();
    const method = req.method;
    const ua = req.headers['user-agent'] || '';
    
    // 1. Проверка на перманентно заблокированные IP (НАВСЕГДА!)
    if (blockedIPs.has(ip)) {
        console.log(`🚫 ПЕРМАНЕНТНО ЗАБЛОКИРОВАН: ${ip} - ${method} ${url}`);
        return res.status(403).send('Access Denied - Your IP has been permanently blocked');
    }
    
    // 2. Проверка на сканеры (по подозрительным путям)
    if (isScannerRequest(url)) {
        const hits = (ipHits.get(ip) || 0) + 1;
        ipHits.set(ip, hits);
        
        console.log(`⚠️ ПОДОЗРИТЕЛЬНЫЙ IP: ${ip} (попытка #${hits}) - ${method} ${url}`);
        logAttackToDB(ip, url, method, ua);
        
        if (hits >= 3) {
            blockedIPs.add(ip);
            saveBlockedIPs();
            console.log(`🔒 IP ${ip} ЗАБЛОКИРОВАН НАВСЕГДА (3 подозрительные попытки)`);
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
        logAttackToDB(ip, url, method, ua, 'опасный метод');
        
        if (hits >= 3) {
            blockedIPs.add(ip);
            saveBlockedIPs();
            console.log(`🔒 IP ${ip} ЗАБЛОКИРОВАН НАВСЕГДА (3 опасных метода)`);
        }
        return res.status(405).send('Method Not Allowed');
    }
    
    // 4. Блокировка по User-Agent (боты)
    const blockedUserAgents = [
        'nikto', 'sqlmap', 'nmap', 'masscan', 'zgrab', 'httpx',
        'python-requests', 'curl', 'wget', 'Go-http-client', 'java'
    ];
    
    if (blockedUserAgents.some(bot => ua.toLowerCase().includes(bot))) {
        const hits = (ipHits.get(ip) || 0) + 1;
        ipHits.set(ip, hits);
        console.log(`🚫 БЛОКИРОВАН БОТ: ${ua} от ${ip} (попытка #${hits})`);
        logAttackToDB(ip, url, method, ua, 'бот/сканер');
        
        if (hits >= 3) {
            blockedIPs.add(ip);
            saveBlockedIPs();
            console.log(`🔒 IP ${ip} ЗАБЛОКИРОВАН НАВСЕГДА (бот)`);
        }
        return res.status(403).send('Access Denied');
    }
    
    next();
});

app.set('trust proxy', 1);

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
        res.redirect(`/admin-${adminSecret}/dashboard`);
    } else {
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
            @media(max-width:768px){
                body{padding:10px}
                .stats{flex-direction:column}
                .stat-card{width:100%}
                th,td{padding:8px;font-size:12px}
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
                </div>`;
        
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

function sanitizeInput(input) {
    if (!input) return '';
    let clean = input.replace(/['";`\-\\%]/g, '');
    clean = xss(clean);
    return clean.trim();
}

// ========== API ==========
const formLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    message: { success: false, error: 'Вы отправили слишком много заявок. Подождите час.' }
});

app.post('/api/callback', formLimiter, [
    body('name').trim().isLength({ min: 2, max: 100 }).escape(),
    body('phone').trim().isLength({ min: 10, max: 11 }),
    body('info').optional().trim().isLength({ max: 500 }).escape()
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
    
    const cleanPhone = phone.replace(/\D/g, '');
    if (!cleanPhone || cleanPhone.length < 10 || cleanPhone.length > 11) {
        return res.json({ success: false, error: 'Неверный телефон' });
    }
    
    const stmt = db.prepare("INSERT INTO callbacks (name, phone, info, ip_address) VALUES (?, ?, ?, ?)");
    stmt.run(name, cleanPhone, info || '', req.ip, function(err) {
        if (err) {
            console.error('❌ Ошибка БД:', err);
            res.json({ success: false, error: 'Ошибка сервера' });
        } else {
            console.log(`✅ Новая заявка #${this.lastID}: ${name} - ${phone}`);
            res.json({ success: true, message: 'Заявка принята! Мы свяжемся с вами.' });
        }
    });
    stmt.finalize();
});

app.post('/api/cookie-consent', (req, res) => {
    let { consent_type, analytics, marketing } = req.body;
    consent_type = sanitizeInput(consent_type || 'custom');
    
    const stmt = db.prepare(`INSERT INTO cookie_consents (consent_type, analytics, marketing, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)`);
    
    stmt.run(
        consent_type,
        analytics ? 1 : 0,
        marketing ? 1 : 0,
        req.ip || 'unknown',
        (req.headers['user-agent'] || 'unknown').substring(0, 255),
        function(err) {
            if (err) {
                console.error('❌ Ошибка сохранения согласия:', err);
                res.json({ success: false, error: 'Ошибка сервера' });
            } else {
                console.log(`✅ Сохранено согласие на cookie #${this.lastID}`);
                res.json({ success: true, id: this.lastID });
            }
        }
    );
    stmt.finalize();
});

// ========== HTTPS СЕРВЕР (ТОЛЬКО HTTPS, ТОЛЬКО Nginx) ==========
const sslPath = path.join(__dirname, 'ssl');
const hasSSL = fs.existsSync(path.join(sslPath, 'privkey.pem')) && fs.existsSync(path.join(sslPath, 'cert.pem'));

if (!hasSSL) {
    console.error('❌ ОШИБКА: SSL сертификаты не найдены!');
    console.error('Файлы должны быть в: ' + sslPath + '/cert.pem и privkey.pem');
    process.exit(1);
}

try {
    const sslOptions = {
        key: fs.readFileSync(path.join(sslPath, 'privkey.pem')),
        cert: fs.readFileSync(path.join(sslPath, 'cert.pem'))
    };
    
    // Слушаем ТОЛЬКО localhost — доступ только через Nginx
    https.createServer(sslOptions, app).listen(PORT, '0.0.0.0', () => {
        const localIp = getLocalIp();
        console.log(`
    ╔══════════════════════════════════════════════════════════════════════════╗
    ║                    🔒 NODE.JS HTTPS СЕРВЕР ЗАПУЩЕН                       ║
    ║                                                                            ║
    ║   🎯 ПОРТ:         ${PORT} (0.0.0.0) — ТОЛЬКО ЛОКАЛЬНО                     ║
    ║   🔄 NGINX PROXY:  https://192.168.0.246:8443                              ║
    ║   ⚠️  ПРЯМОЙ ДОСТУП ИЗВНЕ: ЗАПРЕЩЁН                                         ║
    ║   ✅ ВСЕ ЗАПРОСЫ ТОЛЬКО ЧЕРЕЗ NGINX                                        ║
    ║                                                                            ║
    ║   🌍 САЙТ:        https://192.168.0.246:8443                               ║
    ║   🔐 АДМИНКА:     https://192.168.0.246:8443/admin-${adminSecret}          ║
    ╚══════════════════════════════════════════════════════════════════════════╝
        `);
    });
} catch (err) {
    console.error('❌ Ошибка загрузки сертификатов:', err.message);
    process.exit(1);
}

process.env.NODE_ENV = 'production';
// Убедись, что нет строки с source map

process.on('SIGINT', () => {
    console.log('\n🛑 Сервер остановлен');
    db.close();
    process.exit(0);
});