// ============================================
// МОДУЛЬ УВЕДОМЛЕНИЯ О COOKIE
// GDPR / ФЗ-152 / Закон "О персональных данных"
// ============================================

(function() {
    const CONSENT_KEY = 'cookie_consent';
    const CONSENT_EXPIRE_DAYS = 365;
    
    const COOKIE_TYPES = {
        NECESSARY: 'necessary',
        ANALYTICS: 'analytics',
        MARKETING: 'marketing'
    };
    
    const categories = {
        necessary: {
            title: 'Обязательные cookie',
            description: 'Необходимы для работы сайта. Не требуют согласия.',
            required: true,
            enabled: true
        },
        analytics: {
            title: 'Аналитические cookie',
            description: 'Помогают понять, как посетители используют сайт, чтобы улучшить его работу.',
            required: false,
            enabled: false
        },
        marketing: {
            title: 'Маркетинговые cookie',
            description: 'Используются для показа релевантной рекламы.',
            required: false,
            enabled: false
        }
    };
    
    function getConsent() {
        const saved = localStorage.getItem(CONSENT_KEY);
        if (saved) {
            try {
                return JSON.parse(saved);
            } catch(e) {
                return null;
            }
        }
        return null;
    }
    
    function saveConsent(consent) {
        const data = {
            ...consent,
            date: new Date().toISOString(),
            expires: Date.now() + (CONSENT_EXPIRE_DAYS * 24 * 60 * 60 * 1000)
        };
        localStorage.setItem(CONSENT_KEY, JSON.stringify(data));
        document.cookie = `${CONSENT_KEY}=accepted; path=/; max-age=${CONSENT_EXPIRE_DAYS * 24 * 60 * 60}`;
        
        fetch('/api/cookie-consent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                consent_type: consent.analytics && consent.marketing ? 'all' : 'necessary',
                analytics: consent.analytics || false,
                marketing: consent.marketing || false
            })
        }).catch(err => console.error('Ошибка отправки согласия:', err));
    }
    
    function applyCookieSettings(consent) {
        if (consent.analytics) {
            enableAnalytics();
        } else {
            disableAnalytics();
        }
        
        if (consent.marketing) {
            enableMarketing();
        } else {
            disableMarketing();
        }
        
        enableNecessary();
    }
    
    function enableNecessary() {
        document.cookie = `session_active=true; path=/; max-age=${24 * 60 * 60}`;
        console.log('Обязательные cookie активированы');
    }
    
    function enableAnalytics() {
        console.log('Аналитические cookie активированы');
        localStorage.setItem('analytics_enabled', 'true');
    }
    
    function disableAnalytics() {
        console.log('Аналитические cookie отключены');
        localStorage.removeItem('analytics_enabled');
    }
    
    function enableMarketing() {
        console.log('Маркетинговые cookie активированы');
        localStorage.setItem('marketing_enabled', 'true');
    }
    
    function disableMarketing() {
        console.log('Маркетинговые cookie отключены');
        localStorage.removeItem('marketing_enabled');
    }
    
    function showConsentBanner() {
        const existingBanner = document.getElementById('cookieConsentBanner');
        if (existingBanner) return;
        
        const banner = document.createElement('div');
        banner.id = 'cookieConsentBanner';
        banner.innerHTML = `
            <div class="cookie-consent">
                <div class="cookie-content">
                    <div class="cookie-text">
                        <h3>Использование cookie</h3>
                        <p>Мы используем cookie-файлы для улучшения работы сайта, анализа трафика и показа персонализированной рекламы.</p>
                        <div class="cookie-details" id="cookieDetails" style="display: none;">
                            <div class="cookie-category">
                                <label class="cookie-checkbox">
                                    <input type="checkbox" id="cookieNecessary" checked disabled>
                                    <span>${categories.necessary.title}</span>
                                </label>
                                <p>${categories.necessary.description}</p>
                            </div>
                            <div class="cookie-category">
                                <label class="cookie-checkbox">
                                    <input type="checkbox" id="cookieAnalytics">
                                    <span>${categories.analytics.title}</span>
                                </label>
                                <p>${categories.analytics.description}</p>
                            </div>
                            <div class="cookie-category">
                                <label class="cookie-checkbox">
                                    <input type="checkbox" id="cookieMarketing">
                                    <span>${categories.marketing.title}</span>
                                </label>
                                <p>${categories.marketing.description}</p>
                            </div>
                        </div>
                        <button class="cookie-toggle-details" id="cookieToggleDetails">Подробнее</button>
                    </div>
                    <div class="cookie-buttons">
                        <button class="cookie-btn cookie-btn-necessary" id="cookieOnlyNecessary">Только необходимые</button>
                        <button class="cookie-btn cookie-btn-accept" id="cookieAcceptAll">Принять все</button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(banner);
        addCookieStyles();
        
        document.getElementById('cookieAcceptAll').addEventListener('click', () => {
            const consent = { necessary: true, analytics: true, marketing: true };
            saveConsent(consent);
            applyCookieSettings(consent);
            hideConsentBanner();
        });
        
        document.getElementById('cookieOnlyNecessary').addEventListener('click', () => {
            const consent = { necessary: true, analytics: false, marketing: false };
            saveConsent(consent);
            applyCookieSettings(consent);
            hideConsentBanner();
        });
        
        document.getElementById('cookieToggleDetails').addEventListener('click', () => {
            const details = document.getElementById('cookieDetails');
            const btn = document.getElementById('cookieToggleDetails');
            if (details.style.display === 'none') {
                details.style.display = 'block';
                btn.innerHTML = 'Скрыть';
            } else {
                details.style.display = 'none';
                btn.innerHTML = 'Подробнее';
            }
        });
        
        const consent = getConsent();
        if (consent) {
            const analyticsCheck = document.getElementById('cookieAnalytics');
            const marketingCheck = document.getElementById('cookieMarketing');
            if (analyticsCheck) analyticsCheck.checked = consent.analytics || false;
            if (marketingCheck) marketingCheck.checked = consent.marketing || false;
        }
        
        document.getElementById('cookieAnalytics')?.addEventListener('change', (e) => {
            const consent = getConsent();
            if (consent) {
                consent.analytics = e.target.checked;
                saveConsent(consent);
                applyCookieSettings(consent);
            }
        });
        
        document.getElementById('cookieMarketing')?.addEventListener('change', (e) => {
            const consent = getConsent();
            if (consent) {
                consent.marketing = e.target.checked;
                saveConsent(consent);
                applyCookieSettings(consent);
            }
        });
    }
    
    function hideConsentBanner() {
        const banner = document.getElementById('cookieConsentBanner');
        if (banner) {
            banner.style.animation = 'fadeOut 0.3s ease';
            setTimeout(() => banner.remove(), 300);
        }
    }
    
    function addCookieStyles() {
        if (document.getElementById('cookieStyles')) return;
        
        const styles = document.createElement('style');
        styles.id = 'cookieStyles';
        styles.textContent = `
            .cookie-consent {
                position: fixed;
                /* iPhone home-indicator не закрывает баннер — учитываем safe-area */
                bottom: max(20px, env(safe-area-inset-bottom));
                left: max(20px, env(safe-area-inset-left));
                right: max(20px, env(safe-area-inset-right));
                max-width: 450px;
                background: #2d2d2d;
                border: 1px solid #c4511b;
                border-radius: 4px;
                padding: 20px;
                z-index: 10000;
                box-shadow: 0 10px 40px rgba(0,0,0,0.5);
            }
            .cookie-content {
                display: flex;
                flex-direction: column;
                gap: 15px;
            }
            .cookie-text h3 {
                color: #c4511b;
                margin-bottom: 10px;
                font-size: 1rem;
            }
            .cookie-text p {
                color: #888;
                font-size: 0.85rem;
            }
            .cookie-details {
                margin-top: 15px;
                padding-top: 15px;
                border-top: 1px solid #4a4a4a;
            }
            .cookie-category {
                margin-bottom: 15px;
                padding: 10px;
                background: #1a1a1a;
                border-radius: 4px;
            }
            .cookie-checkbox {
                display: flex;
                align-items: center;
                gap: 10px;
                cursor: pointer;
                margin-bottom: 8px;
                color: #c4511b;
                font-weight: 500;
            }
            .cookie-checkbox input {
                width: 18px;
                height: 18px;
                cursor: pointer;
                accent-color: #c4511b;
            }
            .cookie-checkbox input:disabled {
                opacity: 0.5;
            }
            .cookie-category p {
                margin-left: 28px;
                font-size: 0.8rem;
                color: #666;
            }
            .cookie-toggle-details {
                background: none;
                border: none;
                color: #c4511b;
                cursor: pointer;
                font-size: 0.8rem;
                margin-top: 5px;
            }
            .cookie-buttons {
                display: flex;
                gap: 12px;
                flex-wrap: wrap;
            }
            .cookie-btn {
                flex: 1;
                padding: 10px;
                border: none;
                border-radius: 4px;
                font-weight: 500;
                cursor: pointer;
                font-size: 0.85rem;
            }
            .cookie-btn-necessary {
                background: transparent;
                border: 1px solid #c4511b;
                color: #c4511b;
            }
            .cookie-btn-accept {
                background: #c4511b;
                color: white;
            }
            @media (max-width: 768px) {
                .cookie-consent {
                    left: 10px;
                    right: 10px;
                    max-width: none;
                    padding: 15px;
                }
                .cookie-buttons {
                    flex-direction: column;
                }
            }
        `;
        document.head.appendChild(styles);
    }
    
    function initCookieConsent() {
        const consent = getConsent();
        
        if (consent && consent.expires > Date.now()) {
            applyCookieSettings(consent);
            console.log('Cookie согласие уже получено');
        } else if (consent && consent.expires <= Date.now()) {
            localStorage.removeItem(CONSENT_KEY);
            showConsentBanner();
        } else {
            showConsentBanner();
        }
    }
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initCookieConsent);
    } else {
        initCookieConsent();
    }
    
    window.CookieConsent = {
        getConsent: getConsent,
        enableAnalytics: enableAnalytics,
        disableAnalytics: disableAnalytics,
        COOKIE_TYPES: COOKIE_TYPES
    };
})();