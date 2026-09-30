import { useEffect, useRef } from "react";
import { motionAllowed } from "../lib/a11y";

// Restrained celebration for strong results: a single short canvas burst in
// the brand palette that cleans itself up. Skipped entirely under
// prefers-reduced-motion.
export function Confetti({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!active) return;
    if (!motionAllowed()) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Pull the live palette rather than hardcoding hexes, so the burst matches
    // whichever scheme is rendering (and any future token change).
    const styles = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
    const colors = [
      token("--green", "#26c463"),
      token("--green-bright", "#43e07e"),
      token("--amber", "#f6b93b"),
      token("--blue", "#52a5e8"),
      token("--text", "#f1f0ea"),
    ];
    const pieces = Array.from({ length: 70 }, () => ({
      x: width / 2 + (Math.random() - 0.5) * width * 0.5,
      y: height * 0.35 + (Math.random() - 0.5) * 40,
      vx: (Math.random() - 0.5) * 5.5,
      vy: -Math.random() * 7 - 2,
      size: Math.random() * 6 + 3,
      rotation: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.3,
      color: colors[Math.floor(Math.random() * colors.length)],
    }));

    const startedAt = performance.now();
    const LIFETIME = 2200;
    let frame = 0;

    const render = (now: number) => {
      const elapsed = now - startedAt;
      ctx.clearRect(0, 0, width, height);

      for (const p of pieces) {
        p.vy += 0.16; // gravity
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.spin;

        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - elapsed / LIFETIME);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      }

      if (elapsed < LIFETIME) {
        frame = requestAnimationFrame(render);
      } else {
        ctx.clearRect(0, 0, width, height);
      }
    };
    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [active]);

  if (!active) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 30,
      }}
    />
  );
}
