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
        document.body.style.overflow = 'hidden';
    }
    
    function closeMenu() {
        navLinks.classList.remove('active');
        burger.classList.remove('active');
        overlay.classList.remove('active');
        document.body.style.overflow = '';
    }
    
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
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });
    
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('active')) {
            closeModal();
        }
    });
}

function openModal() {
    const modal = document.getElementById('callbackModal');
    if (modal) {
        modal.classList.add('active');
        console.log('Модальное окно обратной связи открыто');
    } else {
        console.error('Элемент callbackModal не найден');
    }
}

function closeModal() {
    const modal = document.getElementById('callbackModal');
    if (modal) {
        modal.classList.remove('active');
    }
    const form = document.getElementById('callbackForm');
    if (form) form.reset();
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
    console.log('✅ Сайт загружен, все функции инициализированы');
});

// ========== ФУНКЦИИ КОПИРОВАНИЯ ИЗ CONFIG.JS ==========
function copyToClipboardPhone() {
    if (window.SITE_CONFIG) {
        copyToClipboard(window.SITE_CONFIG.phone);
    } else {
        console.error('SITE_CONFIG не загружен');
        copyToClipboard('+7 (916) 961-05-55');
    }
}

function copyToClipboardEmail() {
    if (window.SITE_CONFIG) {
        copyToClipboard(window.SITE_CONFIG.email);
    } else {
        console.error('SITE_CONFIG не загружен');
        copyToClipboard('elddorx@yandex.ru');
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

// ========== ДОПОЛНИТЕЛЬНАЯ ЗАЩИТА КЛИЕНТСКОЙ ЧАСТИ ==========
// Блокировка правой кнопки мыши
document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    return false;
});

// Блокировка выделения (дубль с CSS)
document.addEventListener('selectstart', (e) => {
    if (!e.target.closest('input, textarea')) {
        e.preventDefault();
    }
});

// ========== ЭКСПОРТ ФУНКЦИЙ ДЛЯ HTML ==========
window.openModal = openModal;
window.closeModal = closeModal;
window.submitCallback = submitCallback;
window.phoneMask = phoneMask;
window.initMap = initMap;
window.openImageModal = openImageModal;
window.closeImageModal = closeImageModal;

console.log('✅ Все функции экспортированы в window');