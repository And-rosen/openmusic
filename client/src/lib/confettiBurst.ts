/** 贵宾进房欢迎礼花 — 轻量 canvas，限定在指定容器内 */
export function fireWelcomeConfetti(container: HTMLElement, durationMs = 2600) {
  if (typeof document === 'undefined' || !container) return;
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
  if (!ctx) return;

  const width = container.clientWidth;
  const height = container.clientHeight;
  if (width <= 0 || height <= 0) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:20;contain:strict';
  container.appendChild(canvas);

  const colors = ['#f6d365', '#fb7185', '#67e8f9', '#c4b5fd', '#6ee7b7', '#fbbf24', '#fda4af', '#fff'];
  const targetX = width * 0.5;
  const targetY = height * 0.20;

  type ParticleKind = 'circle' | 'rect' | 'ribbon';
  type Side = 'left' | 'right';

  const createParticle = (index: number, side: Side) => {
    const originX = side === 'left'
      ? width * (0.03 + Math.random() * 0.07)
      : width * (0.9 + Math.random() * 0.07);
    const originY = height * (0.9 + Math.random() * 0.08);

    const dx = targetX - originX + (Math.random() - 0.5) * 48;
    const dy = targetY - originY + (Math.random() - 0.5) * 36;
    const dist = Math.hypot(dx, dy) || 1;
    const speed = 5 + Math.random() * 7;

    const kindRoll = Math.random();
    const kind: ParticleKind = kindRoll < 0.38 ? 'circle' : kindRoll < 0.72 ? 'rect' : 'ribbon';

    return {
      x: originX,
      y: originY,
      vx: (dx / dist) * speed + (Math.random() - 0.5) * 1.2,
      vy: (dy / dist) * speed + (Math.random() - 0.5) * 1.2,
      size: kind === 'ribbon' ? 5 + Math.random() * 5 : 3 + Math.random() * 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.22,
      gravity: 0.1 + Math.random() * 0.05,
      drag: 0.986 + Math.random() * 0.01,
      kind,
      delay: (index % 3) * 40 + Math.random() * 70,
      wobble: Math.random() * Math.PI * 2,
      wobbleSpeed: 0.06 + Math.random() * 0.05,
    };
  };

  const particles = Array.from({ length: 130 }, (_, index) =>
    createParticle(index, index % 2 === 0 ? 'left' : 'right'),
  );

  const start = performance.now();
  let raf = 0;
  const baseTransform = () => ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const roundRectPath = (x: number, y: number, w: number, h: number, r: number) => {
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, w, h, r);
      return;
    }
    ctx.rect(x, y, w, h);
  };

  const drawParticle = (
    p: (typeof particles)[number],
    alpha: number,
  ) => {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;

    if (p.kind === 'circle') {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 0.45, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    const cos = Math.cos(p.rot);
    const sin = Math.sin(p.rot);
    ctx.setTransform(cos * dpr, sin * dpr, -sin * dpr, cos * dpr, p.x * dpr, p.y * dpr);

    if (p.kind === 'rect') {
      const w = p.size;
      const h = p.size * 0.55;
      ctx.beginPath();
      roundRectPath(-w / 2, -h / 2, w, h, 1);
      ctx.fill();
    } else {
      const w = p.size * 1.4;
      const h = p.size * 0.35;
      ctx.beginPath();
      roundRectPath(-w / 2, -h / 2, w, h, h / 2);
      ctx.fill();
    }

    baseTransform();
  };

  const tick = (now: number) => {
    const elapsed = now - start;
    baseTransform();
    ctx.clearRect(0, 0, width, height);

    let visible = 0;
    for (const p of particles) {
      const localElapsed = elapsed - p.delay;
      if (localElapsed < 0) continue;

      p.wobble += p.wobbleSpeed;
      p.x += p.vx + Math.sin(p.wobble) * 0.18;
      p.y += p.vy;
      p.vy += p.gravity;
      p.vx *= p.drag;
      p.rot += p.vr;

      const life = Math.min(1, localElapsed / durationMs);
      const alpha = (1 - life ** 1.6) * 0.95;
      if (alpha <= 0.02) continue;

      visible += 1;
      drawParticle(p, alpha);
    }

    if (visible === 0 && elapsed > durationMs) {
      cancelAnimationFrame(raf);
      canvas.remove();
      return;
    }

    if (elapsed < durationMs + 180) {
      raf = requestAnimationFrame(tick);
    } else {
      cancelAnimationFrame(raf);
      canvas.remove();
    }
  };

  raf = requestAnimationFrame(tick);
}
