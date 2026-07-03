import { useEffect, useRef } from 'react';
import {
  galaxyHandGestureLive,
  onGalaxyGestureModeChange,
} from './lib/galaxyHandGesture';
import { drawHandSkeleton } from './lib/drawHandSkeleton';
import { patchRoomVisualFx, roomVisualFxLive } from '../../lib/roomVisualFxLive';

/** Mineradio #gesture-hud + #hand-canvas — 仅 HUD 绘制；启停由 roomVisualFxLive 统一调度 */
export default function GestureHudOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    const unsubFail = onGalaxyGestureModeChange((mode, failed) => {
      if (failed && roomVisualFxLive.current.cameraInteraction === 'gesture') {
        patchRoomVisualFx({ cameraInteraction: 'off' });
      }
      if (mode === 'off' && failed) {
        window.dispatchEvent(
          new CustomEvent('openmusic:visual-toast', {
            detail: { message: '手势启动失败（需要摄像头权限）', type: 'error' },
          }),
        );
      }
    });
    return unsubFail;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const draw = () => {
      const live = galaxyHandGestureLive;
      const hud = live.hud;
      const hudEl = document.getElementById('gesture-hud');
      const fillEl = document.getElementById('gesture-fill');
      const labelEl = document.getElementById('gesture-label');
      const confirmEl = document.getElementById('gesture-confirm');
      if (hudEl) hudEl.classList.toggle('show', live.active && hud.visible);
      if (labelEl) labelEl.textContent = hud.label;
      if (confirmEl) confirmEl.textContent = hud.detail;
      if (fillEl) fillEl.style.width = `${Math.max(0, Math.min(100, hud.progress * 100))}%`;
      canvas.classList.toggle('show', live.active);

      const W = window.innerWidth;
      const H = window.innerHeight;
      ctx.clearRect(0, 0, W, H);

      if (live.active && live.skeleton) {
        const { landmarks, isPinch, isFist, openness } = live.skeleton;
        drawHandSkeleton(ctx, landmarks, W, H, {
          isPinch,
          isFist,
          openness,
          time: performance.now() / 1000,
        });
      }

      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <>
      <div id="gesture-hud" className="gesture-hud" aria-live="polite">
        <div className="gesture-hud-row">
          <b id="gesture-label">待命</b>
          <span id="gesture-confirm">把手放进视野</span>
        </div>
        <div className="gesture-progress">
          <div id="gesture-fill" className="gesture-fill" />
        </div>
      </div>
      <canvas ref={canvasRef} id="hand-canvas" aria-hidden />
    </>
  );
}
