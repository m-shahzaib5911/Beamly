// ═══════════════════════════════════════════
//  Encryptify — Particles Background Animation
//  Interactive connected nodes with mouse tracking
// ═══════════════════════════════════════════

(function initParticles() {
    const canvas = document.createElement('canvas');
    canvas.id = 'bg-canvas';
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100vw';
    canvas.style.height = '100vh';
    canvas.style.zIndex = '-5';
    canvas.style.pointerEvents = 'none';
    document.body.prepend(canvas);

    const ctx = canvas.getContext('2d');
    let width, height;
    let particles = [];

    // Mouse tracking
    let mouse = { x: null, y: null };
    window.addEventListener('mousemove', (e) => {
        mouse.x = e.x;
        mouse.y = e.y;
    });
    window.addEventListener('mouseout', () => {
        mouse.x = null;
        mouse.y = null;
    });

    function resize() {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
    }
    window.addEventListener('resize', resize);
    resize();

    class Particle {
        constructor() {
            this.x = Math.random() * width;
            this.y = Math.random() * height;
            this.size = Math.random() * 2.5 + 1;
            this.speedX = Math.random() * 1.5 - 0.75;
            this.speedY = Math.random() * 1.5 - 0.75;
            this.color = Math.random() > 0.5 ? '#00e5c3' : '#9d8afe'; // Cyan or Purple
        }
        update() {
            this.x += this.speedX;
            this.y += this.speedY;
            if (this.x > width || this.x < 0) this.speedX *= -1;
            if (this.y > height || this.y < 0) this.speedY *= -1;
        }
        draw() {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fillStyle = this.color;
            ctx.fill();
        }
    }

    function init() {
        particles = [];
        let numParticles = Math.floor((width * height) / 10000); // optimal density
        for (let i = 0; i < numParticles; i++) {
            particles.push(new Particle());
        }
    }

    function animate() {
        // Create trailing effect — use correct color for current theme
        const isLight = document.body.classList.contains('light-theme');
        ctx.fillStyle = isLight ? 'rgba(240, 244, 248, 0.25)' : 'rgba(11, 15, 25, 0.25)';
        ctx.fillRect(0, 0, width, height);

        for (let i = 0; i < particles.length; i++) {
            particles[i].update();
            particles[i].draw();

            // Connect particles to each other
            for (let j = i; j < particles.length; j++) {
                let dx = particles[i].x - particles[j].x;
                let dy = particles[i].y - particles[j].y;
                let distance = Math.sqrt(dx * dx + dy * dy);
                if (distance < 110) {
                    ctx.beginPath();
                    ctx.strokeStyle = particles[i].color;
                    ctx.globalAlpha = 1 - (distance / 110);
                    ctx.lineWidth = 1;
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.stroke();
                    ctx.globalAlpha = 1.0;
                }
            }
        }

        // Connect to mouse like a spiderweb
        if (mouse.x != null) {
            for (let i = 0; i < particles.length; i++) {
                let dx = mouse.x - particles[i].x;
                let dy = mouse.y - particles[i].y;
                let distance = Math.sqrt(dx * dx + dy * dy);
                if (distance < 180) {
                    ctx.beginPath();
                    ctx.strokeStyle = particles[i].color;
                    ctx.globalAlpha = 1 - (distance / 180);
                    ctx.lineWidth = 1.5;
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(mouse.x, mouse.y);
                    ctx.stroke();
                    ctx.globalAlpha = 1.0;
                }
            }
        }
        requestAnimationFrame(animate);
    }
    init();
    animate();
})();
