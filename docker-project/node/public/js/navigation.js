// ============================================
// navigation.js - ЕДИНЫЙ ШАБЛОН НАВИГАЦИИ, ФУТЕРА И МОДАЛОК
// ============================================

function loadNavigationAndFooter() {
    const navbarHtml = `
        <nav class="navbar">
            <div class="burger" id="burger">
                <span></span><span></span><span></span>
            </div>
            <ul class="nav-links" id="navLinks">
                <li><a href="index.html">Главная</a></li>
                <li><a href="services.html">Услуги</a></li>
                <li><a href="contacts.html">Контакты</a></li>
            </ul>
            <button class="callback-btn" onclick="window.openModal()">Обратный звонок</button>
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
        <div id="callbackModal" class="modal">
            <div class="modal-content">
                <span class="close-modal" onclick="window.closeModal()">&times;</span>
                <h3>Оставить заявку</h3>
                <form id="callbackForm" onsubmit="window.submitCallback(event)">
                    <div class="form-group">
                        <label>Ваше имя *</label>
                        <input type="text" id="modalName" placeholder="Иван Иванов" required>
                    </div>
                    <div class="form-group">
                        <label>Телефон *</label>
                        <input type="tel" id="modalPhone" placeholder="+7 (___) ___-__-__" oninput="window.phoneMask(this)" required>
                    </div>
                    <div class="form-group">
                        <label>Дополнительная информация</label>
                        <textarea id="modalInfo" rows="3" placeholder="Опишите, какие работы вас интересуют..."></textarea>
                    </div>
                    <button type="submit" class="submit-btn">Отправить заявку</button>
                </form>
            </div>
        </div>
        
        <div id="imageModal" class="image-modal" onclick="window.closeImageModal()">
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
});