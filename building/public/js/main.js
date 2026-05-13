// ============================================
// БЛОКИРОВКА PINCH-ZOOM НА МОБИЛЬНЫХ
// (iOS 10+ игнорирует user-scalable=no в meta — нужно вешать
//  обработчики жестов; Android реагирует на meta + touch-action)
// ============================================
(function() {
    // iOS: блокировка двух-пальцевых жестов (pinch-zoom)
    document.addEventListener('gesturestart',  function(e) { e.preventDefault(); }, { passive: false });
    document.addEventListener('gesturechange', function(e) { e.preventDefault(); }, { passive: false });
    document.addEventListener('gestureend',    function(e) { e.preventDefault(); }, { passive: false });

    // iOS: блокировка double-tap zoom
    let lastTap = 0;
    document.addEventListener('touchend', function(e) {
        const now = Date.now();
        if (now - lastTap < 300) e.preventDefault();
        lastTap = now;
    }, { passive: false });

    // Android Chrome: блокировка multi-touch zoom (если 2+ пальца)
    document.addEventListener('touchmove', function(e) {
        if (e.touches && e.touches.length > 1) e.preventDefault();
    }, { passive: false });

    // Ctrl/⌘ + колесо — десктоп тоже
    document.addEventListener('wheel', function(e) {
        if (e.ctrlKey || e.metaKey) e.preventDefault();
    }, { passive: false });
})();

// ============================================
// ОСНОВНАЯ ЛОГИКА - ВСЕ КОНТАКТЫ ИЗ CONFIG.JS
// ============================================

// Автоматическое заполнение всех контактов на странице
function fillAllContacts() {
    if (!window.SITE_CONFIG) return;
    
    document.querySelectorAll('[data-phone]').forEach(el => {
        el.textContent = SITE_CONFIG.phone;
    });
    
    document.querySelectorAll('[data-phone-link]').forEach(el => {
        el.href = `tel:${SITE_CONFIG.phoneClean}`;
        el.textContent = SITE_CONFIG.phone;
    });
    
    document.querySelectorAll('[data-email]').forEach(el => {
        el.textContent = SITE_CONFIG.email;
        el.href = `mailto:${SITE_CONFIG.email}`;
    });
    
    document.querySelectorAll('[data-schedule]').forEach(el => {
        el.textContent = SITE_CONFIG.schedule;
    });
    
    document.querySelectorAll('[data-address]').forEach(el => {
        el.textContent = SITE_CONFIG.address;
    });
    
    document.querySelectorAll('[data-site-name]').forEach(el => {
        el.textContent = SITE_CONFIG.siteName;
    });
    
    document.querySelectorAll('[data-year]').forEach(el => {
        el.textContent = SITE_CONFIG.currentYear;
    });
}

// ========== БУРГЕР-МЕНЮ С ОВЕРЛЕЕМ ==========
function initBurgerMenu() {
    const burger = document.getElementById('burger');
    const navLinks = document.getElementById('navLinks');
    
    if (!burger || !navLinks) return;
    
    // Создаём оверлей
    let overlay = document.querySelector('.menu-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'menu-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.4);
            backdrop-filter: blur(3px);
            z-index: 999;
            opacity: 0;
            visibility: hidden;
            transition: opacity 0.3s ease, visibility 0.3s ease;
        `;
        document.body.appendChild(overlay);
    }
    
    function openMenu() {
        navLinks.classList.add('active');
        burger.classList.add('active');
        overlay.classList.add('active');
        burger.setAttribute('aria-expanded', 'true');
        document.body.style.overflow = 'hidden';
    }

    function closeMenu() {
        navLinks.classList.remove('active');
        burger.classList.remove('active');
        overlay.classList.remove('active');
        burger.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
    }

    // Клавиатурный доступ — раньше burger был <div>, не реагировал на Enter/Space
    burger.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            burger.click();
        }
    });
    
    burger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (navLinks.classList.contains('active')) {
            closeMenu();
        } else {
            openMenu();
        }
    });
    
    overlay.addEventListener('click', closeMenu);
    
    // Закрытие по клику на ссылку
    document.querySelectorAll('.nav-links a').forEach(link => {
        link.addEventListener('click', closeMenu);
    });
    
    // Закрытие по Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && navLinks.classList.contains('active')) {
            closeMenu();
        }
    });
}

// ========== МОДАЛЬНОЕ ОКНО ОБРАТНОЙ СВЯЗИ ==========
function initModal() {
    const modal = document.getElementById('callbackModal');
    if (!modal) return;

    // Поле телефона: при фокусе — префикс "+7 " и курсор в конец.
    // При blur с одним лишь префиксом — очищаем (чтобы placeholder вернулся).
    const phone = document.getElementById('modalPhone');
    if (phone) {
        phone.addEventListener('focus', () => {
            if (!phone.value || phone.value.length < 3) {
                phone.value = '+7 ';
            }
            // setTimeout — Safari иногда сбрасывает selection после focus
            setTimeout(() => {
                const end = phone.value.length;
                phone.setSelectionRange(end, end);
            }, 0);
        });
        phone.addEventListener('blur', () => {
            if (phone.value.replace(/\D/g, '').length <= 1) phone.value = '';
        });
    }

    // Закрываем только если и mousedown, и mouseup были на оверлее,
    // НЕ внутри modal-content. Иначе drag из поля ввода за рамку
    // закрывает модалку (была эта баг).
    let _downOnOverlay = false;
    modal.addEventListener('mousedown', (e) => {
        _downOnOverlay = (e.target === modal);
    });
    modal.addEventListener('mouseup', (e) => {
        if (_downOnOverlay && e.target === modal) closeModal();
        _downOnOverlay = false;
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('active')) {
            closeModal();
        }
    });
}

// Сохраняем фокус, чтобы вернуть его после закрытия модалки
let _modalLastFocus = null;
function openModal() {
    const modal = document.getElementById('callbackModal');
    if (!modal) { console.error('Элемент callbackModal не найден'); return; }
    _modalLastFocus = document.activeElement;
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    // Префилл поля телефона "+7 " чтобы курсор был сразу после префикса.
    // Раньше пользователю надо было нажать любую цифру чтобы появилось +7.
    const phone = document.getElementById('modalPhone');
    if (phone && !phone.value) phone.value = '+7 ';

    // Первый фокус на поле "Имя"
    const first = modal.querySelector('input,textarea,button');
    if (first) setTimeout(() => first.focus(), 30);
}

function closeModal() {
    const modal = document.getElementById('callbackModal');
    if (modal) {
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
    }
    document.body.style.overflow = '';
    const form = document.getElementById('callbackForm');
    if (form) form.reset();
    // Возвращаем фокус туда, где был до открытия (доступность)
    if (_modalLastFocus && typeof _modalLastFocus.focus === 'function') {
        _modalLastFocus.focus();
    }
}

// ========== МОДАЛЬНОЕ ОКНО ДЛЯ ИЗОБРАЖЕНИЙ ==========
function initImageModal() {
    const modal = document.getElementById('imageModal');
    if (!modal) return;
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal || e.target.classList.contains('image-modal')) {
            closeImageModal();
        }
    });
    
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeImageModal();
        }
    });
}

function openImageModal(src, caption) {
    const modal = document.getElementById('imageModal');
    const modalImg = document.getElementById('modalImage');
    const modalCaption = document.getElementById('modalImageCaption');
    
    if (modal && modalImg && modalCaption) {
        modal.classList.add('active');
        modalImg.src = src;
        modalCaption.textContent = caption || 'Изображение';
        console.log('Изображение открыто:', src);
    } else {
        console.error('Ошибка открытия изображения');
    }
}

function closeImageModal() {
    const modal = document.getElementById('imageModal');
    if (modal) {
        modal.classList.remove('active');
        const modalImg = document.getElementById('modalImage');
        if (modalImg) modalImg.src = '';
    }
}

// ========== ОТПРАВКА ФОРМЫ ОБРАТНОЙ СВЯЗИ ==========
async function submitCallback(event) {
    event.preventDefault();
    
    const name = document.getElementById('modalName')?.value.trim();
    const phone = document.getElementById('modalPhone')?.value.trim();
    const info = document.getElementById('modalInfo')?.value.trim();
    
    if (!name || name.length < 2) {
        showMessage('Имя должно содержать минимум 2 символа', 'error');
        return;
    }
    
    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length < 10) {
        showMessage('Введите корректный номер телефона', 'error');
        return;
    }
    
    const btn = event.target.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = 'Отправка...';
    
    try {
        const res = await fetch('/api/callback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, phone: cleanPhone, info })
        });
        const data = await res.json();
        
        if (data.success) {
            showMessage('✅ Заявка принята! Мы свяжемся с вами.', 'success');
            closeModal();
            event.target.reset();
        } else {
            showMessage(data.error || '❌ Ошибка отправки', 'error');
        }
    } catch (error) {
        console.error('Ошибка:', error);
        showMessage('❌ Ошибка соединения. Проверьте интернет.', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// ========== УВЕДОМЛЕНИЯ ==========
function showMessage(msg, type = 'success') {
    const toast = document.createElement('div');
    toast.textContent = msg;
    toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: ${type === 'success' ? '#28a745' : '#dc3545'};
        color: white;
        padding: 15px 25px;
        border-radius: 8px;
        z-index: 10000;
        font-weight: 500;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        animation: fadeIn 0.3s ease;
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// ========== МАСКА ТЕЛЕФОНА ==========
function phoneMask(input) {
    let val = input.value.replace(/\D/g, '');
    if (val.length > 11) val = val.slice(0, 11);
    
    let formatted = '';
    if (val.length > 0) formatted = '+7';
    if (val.length > 1) formatted += ' (' + val.substring(1, 4);
    if (val.length >= 5) formatted += ') ' + val.substring(4, 7);
    if (val.length >= 8) formatted += '-' + val.substring(7, 9);
    if (val.length >= 10) formatted += '-' + val.substring(9, 11);
    
    input.value = formatted;
}

// ========== ИНИЦИАЛИЗАЦИЯ КАРТЫ ==========
function initMap() {
    const frame = document.getElementById('mapFrame');
    if (frame && window.SITE_CONFIG) {
        const c = SITE_CONFIG.coordinates;
        frame.src = `https://yandex.ru/map-widget/v1/?ll=${c.lon},${c.lat}&z=10&l=map&pt=${c.lon},${c.lat},org`;
    }
}

// ========== ОТКРЫТИЕ МОДАЛКИ С ПРЕДЗАПОЛНЕННОЙ УСЛУГОЙ ==========
window.openModalWithService = function(serviceName) {
    const modal = document.getElementById('callbackModal');
    const infoField = document.getElementById('modalInfo');
    
    if (modal && infoField) {
        infoField.value = serviceName + " - ";
        modal.classList.add('active');
    } else {
        openModal();
    }
};

// ========== ЗАПУСК ВСЕГО ПРИ ЗАГРУЗКЕ ==========
document.addEventListener('DOMContentLoaded', () => {
    fillAllContacts();
    initBurgerMenu();
    initModal();
    initImageModal();
    initMap();
    initContactPageLinks();
    console.log('✅ Сайт загружен, все функции инициализированы');
});

// Whatsapp / Telegram ссылки на странице контактов
function initContactPageLinks() {
    if (!window.SITE_CONFIG) return;
    const wa = document.getElementById('whatsappLink');
    const tg = document.getElementById('telegramLink');
    if (wa) wa.href = SITE_CONFIG.whatsapp;
    if (tg) tg.href = SITE_CONFIG.telegram;

    // Карточки контактов с data-copy="phone|email|address" — берут значение
    // из SITE_CONFIG, чтобы текст не дублировался в HTML.
    document.querySelectorAll('[data-copy]').forEach(card => {
        const key = card.getAttribute('data-copy');
        const value = key === 'phone' ? SITE_CONFIG.phone
                    : key === 'email' ? SITE_CONFIG.email
                    : key === 'address' ? SITE_CONFIG.address
                    : null;
        if (!value) return;
        if (card._copyBound) return;
        card._copyBound = true;
        card.addEventListener('click', () => window.copyToClipboard(value));
    });
}
window.initContactPageLinks = initContactPageLinks;

// Глобальный copyToClipboard — нужен на странице контактов.
// Раньше определялся inline в contacts.html → при SPA-переходе
// inline-скрипт не выполнялся, функция отсутствовала.
window.copyToClipboard = function(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            showMessage('✅ Скопировано: ' + text, 'success');
        }).catch(() => {
            alert('Нажмите Ctrl+C, чтобы скопировать: ' + text);
        });
    } else {
        alert('Нажмите Ctrl+C, чтобы скопировать: ' + text);
    }
};

// ========== ФУНКЦИИ КОПИРОВАНИЯ ИЗ CONFIG.JS ==========
function copyToClipboardPhone() {
    if (window.SITE_CONFIG) {
        copyToClipboard(window.SITE_CONFIG.phone);
    } else {
        console.error('SITE_CONFIG не загружен');
        copyToClipboard('+7 (999) 961-05-55');
    }
}

function copyToClipboardEmail() {
    if (window.SITE_CONFIG) {
        copyToClipboard(window.SITE_CONFIG.email);
    } else {
        console.error('SITE_CONFIG не загружен');
        copyToClipboard('info@construction.ru');
    }
}

function copyToClipboardAddress() {
    if (window.SITE_CONFIG) {
        copyToClipboard(window.SITE_CONFIG.address);
    } else {
        console.error('SITE_CONFIG не загружен');
        copyToClipboard('г. Котельники, мкр. Парковый');
    }
}

// ========== ЭКСПОРТ ФУНКЦИЙ ДЛЯ HTML ==========
window.openModal = openModal;
window.closeModal = closeModal;
window.submitCallback = submitCallback;
window.phoneMask = phoneMask;
window.initMap = initMap;
window.openImageModal = openImageModal;
window.closeImageModal = closeImageModal;

console.log('✅ Все функции экспортированы в window');