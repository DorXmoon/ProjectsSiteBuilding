// ============================================
// navigation.js - ЕДИНЫЙ ШАБЛОН НАВИГАЦИИ, ФУТЕРА И МОДАЛОК
// ============================================

function loadNavigationAndFooter() {
    const navbarHtml = `
        <nav class="navbar" aria-label="Главное меню">
            <button type="button" class="burger" id="burger"
                    aria-label="Меню" aria-expanded="false" aria-controls="navLinks">
                <span></span><span></span><span></span>
            </button>
            <ul class="nav-links" id="navLinks">
                <li><a href="index.html">Главная</a></li>
                <li><a href="services.html">Услуги</a></li>
                <li><a href="contacts.html">Контакты</a></li>
            </ul>
            <button class="callback-btn" type="button" onclick="window.openModal()">Обратный звонок</button>
        </nav>
    `;
    
    const footerHtml = `
        <footer>
            <div class="footer-grid">
                <div class="footer-item">
                    <h4>Контакты</h4>
                    <p><a href="#" data-phone-link></a></p>
                    <p><a href="#" data-email></a></p>
                </div>
                <div class="footer-item">
                    <h4>График работы</h4>
                    <p data-schedule></p>
                </div>
                <div class="footer-item">
                    <h4>Адрес</h4>
                    <p data-address></p>
                </div>
                <div class="footer-item">
                    <button class="callback-btn" onclick="window.openModal()">Обратный звонок</button>
                </div>
            </div>
            <div style="text-align: center; padding-top: 20px;">© <span data-year></span> <span data-site-name></span>. Все права защищены.</div>
        </footer>
    `;
    
    const modalsHtml = `
        <div id="callbackModal" class="modal" role="dialog" aria-modal="true"
             aria-labelledby="callbackModalTitle" aria-hidden="true">
            <div class="modal-content">
                <button type="button" class="close-modal" aria-label="Закрыть"
                        onclick="window.closeModal()">&times;</button>
                <h3 id="callbackModalTitle">Оставить заявку</h3>
                <form id="callbackForm" onsubmit="window.submitCallback(event)">
                    <div class="form-group">
                        <label for="modalName">Ваше имя *</label>
                        <input type="text" id="modalName" name="name"
                               placeholder="Иван Иванов" required
                               autocomplete="name" inputmode="text" enterkeyhint="next">
                    </div>
                    <div class="form-group">
                        <label for="modalPhone">Телефон *</label>
                        <input type="tel" id="modalPhone" name="phone"
                               placeholder="+7 (___) ___-__-__" required
                               autocomplete="tel" inputmode="tel" enterkeyhint="next"
                               oninput="window.phoneMask(this)">
                    </div>
                    <div class="form-group">
                        <label for="modalInfo">Дополнительная информация</label>
                        <textarea id="modalInfo" name="info" rows="3"
                                  enterkeyhint="send"
                                  placeholder="Опишите, какие работы вас интересуют..."></textarea>
                    </div>
                    <button type="submit" class="submit-btn">Отправить заявку</button>
                </form>
            </div>
        </div>

        <div id="imageModal" class="image-modal" role="dialog" aria-modal="true"
             aria-hidden="true" onclick="window.closeImageModal()">
            <div class="image-modal-content">
                <img id="modalImage" src="" alt="">
                <p id="modalImageCaption"></p>
            </div>
        </div>
    `;
    
    if (document.body) {
        if (!document.querySelector('.navbar')) {
            document.body.insertAdjacentHTML('afterbegin', navbarHtml);
        }
        if (!document.querySelector('footer')) {
            document.body.insertAdjacentHTML('beforeend', footerHtml);
        }
        if (!document.querySelector('#callbackModal')) {
            document.body.insertAdjacentHTML('beforeend', modalsHtml);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    loadNavigationAndFooter();
    initSpaRouter();
});

// ============================================
// SPA-РОУТЕР: перехватываем переходы между .html, чтобы JS
// (особенно three.js фон) НЕ ПЕРЕЗАГРУЖАЛСЯ. Граф продолжает
// летать бесшовно, меняется только содержимое <main>.
// ============================================
function initSpaRouter() {
    // Делегируем клик на document — работает и для динамически
    // вставленного навбара/футера.
    document.addEventListener('click', function(e) {
        const a = e.target.closest('a');
        if (!a) return;
        const href = a.getAttribute('href');
        if (!href) return;
        // только локальные .html (не tel:, не mailto:, не https://...)
        if (!/^[a-z0-9_\-]+\.html(\?.*)?(#.*)?$/i.test(href)) return;
        if (a.target === '_blank') return;
        // модификаторы — пусть открывает в новой вкладке
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        navigateSpa(href, true);
    });

    window.addEventListener('popstate', () => {
        const path = location.pathname.split('/').pop() || 'index.html';
        navigateSpa(path, false);
    });
}

async function navigateSpa(url, pushState) {
    try {
        const res = await fetch(url, { credentials: 'same-origin' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const newMain = doc.querySelector('main');
        const oldMain = document.querySelector('main');
        if (!newMain || !oldMain) { location.href = url; return; }
        oldMain.replaceWith(newMain);
        document.title = doc.title || document.title;
        if (pushState) history.pushState({}, '', url);
        window.scrollTo(0, 0);

        // Переинициализируем UI, который завязан на содержимое main.
        // background-3d.js не трогаем — он продолжает работать с тем же
        // canvas в <div class="bg-stage">, который не подменялся.
        if (typeof fillAllContacts === 'function') fillAllContacts();
        if (typeof initMap === 'function') initMap();
        if (typeof initContactPageLinks === 'function') initContactPageLinks();
    } catch (err) {
        console.warn('SPA fetch failed → fallback на полную перезагрузку', err);
        location.href = url;
    }
}