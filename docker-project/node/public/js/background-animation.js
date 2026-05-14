// ============================================
// ЛЁГКИЙ ГРАФ - ОПТИМИЗАЦИЯ ДЛЯ МОБИЛЬНЫХ
// (фиксированное количество, нет удаления/появления)
// ============================================

(function() {
    let canvas, ctx;
    let particles = [];
    let animationId = null;
    let container = null;
    let width, height;
    let isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    // НАСТРОЙКИ (для телефона меньше точек и связей)
    const MOBILE_CONFIG = {
        particleCount: 35,        // Мало точек для телефона
        connectionDistance: 100,  // Короткие связи
        speedFactor: 0.3,         // Медленное движение
        pointOpacity: 0.5,
        lineOpacity: 0.2,
        pointSize: 1.8
    };
    
    const DESKTOP_CONFIG = {
        particleCount: 80,
        connectionDistance: 130,
        speedFactor: 0.4,
        pointOpacity: 0.55,
        lineOpacity: 0.25,
        pointSize: 2
    };
    
    const config = isMobile ? MOBILE_CONFIG : DESKTOP_CONFIG;
    
    let sessionId = null;
    
    function getSessionId() {
        let id = localStorage.getItem('light_graph_id');
        if (!id) {
            id = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
            localStorage.setItem('light_graph_id', id);
        }
        return id;
    }
    
    function saveState() {
        const state = particles.map(p => ({ x: p.x, y: p.y, vx: p.vx, vy: p.vy }));
        localStorage.setItem(`light_graph_${sessionId}`, JSON.stringify(state));
    }
    
    function loadState() {
        try {
            const saved = localStorage.getItem(`light_graph_${sessionId}`);
            if (saved) {
                const state = JSON.parse(saved);
                particles = state;
                return true;
            }
        } catch(e) {}
        return false;
    }
    
    function initBackground() {
        sessionId = getSessionId();
        
        container = document.getElementById('light-graph');
        if (!container) {
            container = document.createElement('div');
            container.id = 'light-graph';
            container.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                z-index: -2;
                pointer-events: none;
                background: linear-gradient(135deg, #e8edf2 0%, #f0f2f5 100%);
            `;
            document.body.insertBefore(container, document.body.firstChild);
        }
        
        canvas = document.createElement('canvas');
        canvas.style.cssText = `width:100%;height:100%;display:block;`;
        canvas.style.imageRendering = 'crisp-edges';
        container.appendChild(canvas);
        
        ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        
        resizeCanvas();
        
        const loaded = loadState();
        if (!loaded) {
            initParticles();
        }
        
        window.addEventListener('resize', () => {
            resizeCanvas();
        });
        
        animate();
        
        setInterval(() => saveState(), 15000);
        window.addEventListener('beforeunload', () => saveState());
    }
    
    function resizeCanvas() {
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = width;
        canvas.height = height;
        
        // Адаптируем позиции частиц при ресайзе
        if (particles.length > 0) {
            // Ничего не делаем, просто оставляем как есть
        }
    }
    
    function initParticles() {
        particles = [];
        for (let i = 0; i < config.particleCount; i++) {
            particles.push({
                x: Math.random() * width,
                y: Math.random() * height,
                vx: (Math.random() - 0.5) * config.speedFactor,
                vy: (Math.random() - 0.5) * config.speedFactor,
            });
        }
    }
    
    function updateParticles() {
        for (let p of particles) {
            p.x += p.vx;
            p.y += p.vy;
            
            // Плавный переход через границы
            if (p.x > width) p.x = 0;
            if (p.x < 0) p.x = width;
            if (p.y > height) p.y = 0;
            if (p.y < 0) p.y = height;
        }
    }
    
    function draw() {
        if (!ctx) return;
        ctx.clearRect(0, 0, width, height);
        
        // Рисуем связи (оптимизировано: проходим только по частицам)
        ctx.globalAlpha = config.lineOpacity;
        ctx.strokeStyle = '#1a5f7a';
        ctx.lineWidth = 0.6;
        
        const connectionDist = config.connectionDistance;
        
        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const dx = particles[i].x - particles[j].x;
                const dy = particles[i].y - particles[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                
                if (dist < connectionDist) {
                    ctx.beginPath();
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.stroke();
                }
            }
        }
        
        // Рисуем точки
        ctx.globalAlpha = config.pointOpacity;
        ctx.fillStyle = '#1a5f7a';
        
        for (let p of particles) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, config.pointSize, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    
    function animate() {
        updateParticles();
        draw();
        animationId = requestAnimationFrame(animate);
    }
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initBackground);
    } else {
        initBackground();
    }
})();