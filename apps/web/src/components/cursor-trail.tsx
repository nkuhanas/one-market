import { useEffect, useRef } from 'react';

/**
 * A short cyan trail that follows the pointer.
 *
 * Drawn on one canvas rather than as elements, so nothing is added to the
 * document while the market re-renders at 20 Hz. The loop only runs while
 * there are points left to draw, so an idle page costs nothing.
 *
 * It only draws over regions marked `data-trail`, currently the hero and the
 * How it works strip. The trading terminal is dense and already moving, so a
 * trail across it is noise: points stop being added there and whatever is on
 * screen fades out on its own rather than cutting off.
 *
 * Skipped entirely for coarse pointers and for anyone who has asked for
 * reduced motion.
 */
const MAX_POINTS = 18;
const FADE_MS = 420;

type Point = { x: number; y: number; at: number };

export function CursorTrail() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const fine = window.matchMedia('(pointer: fine)').matches;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!fine || still) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let points: Point[] = [];
    let frame = 0;
    let ratio = 1;
    let zones: DOMRect[] = [];
    let zonesStale = true;

    const resize = () => {
      ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = window.innerWidth * ratio;
      canvas.height = window.innerHeight * ratio;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      zonesStale = true;
    };
    resize();

    // Rects are cached and only re-read once the page has moved beneath the
    // pointer, so a pointermove never forces layout on its own.
    const inZone = (x: number, y: number) => {
      if (zonesStale) {
        zones = Array.from(
          document.querySelectorAll<HTMLElement>('[data-trail]'),
        ).map((el) => el.getBoundingClientRect());
        zonesStale = false;
      }
      return zones.some(
        (r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom,
      );
    };

    const draw = () => {
      const now = performance.now();
      points = points.filter((p) => now - p.at < FADE_MS);
      ctx.clearRect(0, 0, canvas.width / ratio, canvas.height / ratio);

      for (let i = 1; i < points.length; i += 1) {
        const a = points[i - 1];
        const b = points[i];
        const life = 1 - (now - b.at) / FADE_MS;
        ctx.strokeStyle = `rgba(34, 194, 232, ${(life * 0.55).toFixed(3)})`;
        ctx.lineWidth = 1 + life * 2.4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      const head = points[points.length - 1];
      if (head) {
        const glow = ctx.createRadialGradient(
          head.x,
          head.y,
          0,
          head.x,
          head.y,
          16,
        );
        glow.addColorStop(0, 'rgba(34, 194, 232, 0.28)');
        glow.addColorStop(1, 'rgba(34, 194, 232, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(head.x, head.y, 16, 0, Math.PI * 2);
        ctx.fill();
      }

      frame = points.length > 0 ? requestAnimationFrame(draw) : 0;
    };

    const onMove = (event: PointerEvent) => {
      if (!inZone(event.clientX, event.clientY)) return;
      points.push({
        x: event.clientX,
        y: event.clientY,
        at: performance.now(),
      });
      if (points.length > MAX_POINTS) points.shift();
      if (!frame) frame = requestAnimationFrame(draw);
    };

    const invalidate = () => {
      zonesStale = true;
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('scroll', invalidate, { passive: true });
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('scroll', invalidate);
      window.removeEventListener('resize', resize);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return <canvas ref={canvasRef} className="cursor-trail" aria-hidden="true" />;
}
