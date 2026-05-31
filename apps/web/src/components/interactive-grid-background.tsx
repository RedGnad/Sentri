"use client";

import { useEffect, useRef } from "react";

/**
 * InteractiveGridBackground — a fine amber grid that drifts on its own with
 * a gentle two-wave noise (echoing the breathing motion of the Blender
 * geometry-nodes scene) and scales + glows around the cursor. The canvas
 * also blurs progressively as the user scrolls past the hero, so the
 * content lower on the page reads cleanly.
 *
 * Implementation notes:
 *  - Canvas 2D rather than WebGL/Three.js. The grid is a couple of thousand
 *    1-2px rectangles per frame — well within Canvas budget even on mobile,
 *    and avoids shipping a 3D engine for a background ornament.
 *  - DPR-aware for crisp rendering on retina.
 *  - prefers-reduced-motion → render once, no animation loop.
 *  - pointer-events: none → never intercepts clicks.
 *  - aria-hidden → invisible to assistive tech (it's purely decorative).
 *  - fixed inset + z-0 → sits behind the page content (the landing page
 *    wraps its content in relative z-10) but above the body bg paint layer.
 */

const CELL = 28; // px between dots
const DOT_SIZE = 2; // base dot size in px (square)
const PROX_RADIUS = 190; // px of influence around the cursor
const MAX_SCALE = 10; // dot scale at cursor center
const BASE_ALPHA = 0.16; // base opacity (visible film without dominating)
const PEAK_ALPHA = 0.72; // peak opacity at cursor
const COLOR = "#FFB000"; // Sentri amber

// Ambient noise drift — two slow travelling waves with different temporal
// and spatial frequencies produce an organic, non-repeating-looking flow.
// Period ≈ 11.4s and 7.7s, so the grid never lines up with itself for a
// given dot.
const NOISE_AMP_PX = 4.5;
const TIME_FREQ_A = 0.00055;
const TIME_FREQ_B = 0.00082;
const SPATIAL_FREQ_X = 0.008;
const SPATIAL_FREQ_Y = 0.011;

// Subtle scale pulsation derived from the same wave, ±5%, so the grid
// breathes even when the cursor is far from it.
const BREATH_AMP = 0.05;

// Scroll-driven blur: untouched up to SCROLL_BLUR_START_PX, then ramps to
// MAX_BLUR_PX at SCROLL_BLUR_FULL_PX. Puts the focus on the content the
// user is actively reading once they leave the hero.
const SCROLL_BLUR_START_PX = 160;
const SCROLL_BLUR_FULL_PX = 720;
const MAX_BLUR_PX = 7;

export function InteractiveGridBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvasEl = canvasRef.current;
    if (!canvasEl) return;
    const ctxRaw = canvasEl.getContext("2d");
    if (!ctxRaw) return;
    // Alias the non-null versions so the inner closures don't trip the
    // TS strict-null check (it can't narrow through closure boundaries).
    const canvas: HTMLCanvasElement = canvasEl;
    const ctx: CanvasRenderingContext2D = ctxRaw;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    let dpr = Math.max(1, window.devicePixelRatio || 1);
    const cursor = { x: -9999, y: -9999, active: false };
    let rafId = 0;
    const startTime = performance.now();

    function resize() {
      width = window.innerWidth;
      height = window.innerHeight;
      dpr = Math.max(1, window.devicePixelRatio || 1);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function onMove(e: MouseEvent) {
      cursor.x = e.clientX;
      cursor.y = e.clientY;
      cursor.active = true;
    }
    function onLeave() {
      cursor.active = false;
    }

    function applyScrollBlur() {
      const y = window.scrollY;
      let t = 0;
      if (y > SCROLL_BLUR_START_PX) {
        const span = SCROLL_BLUR_FULL_PX - SCROLL_BLUR_START_PX;
        t = Math.min(1, (y - SCROLL_BLUR_START_PX) / span);
      }
      canvas.style.filter = t > 0 ? `blur(${(t * MAX_BLUR_PX).toFixed(2)}px)` : "none";
    }

    function render(now: number) {
      const t = now - startTime;
      ctx.clearRect(0, 0, width, height);
      const cols = Math.ceil(width / CELL) + 1;
      const rows = Math.ceil(height / CELL) + 1;
      const offsetX = (width - (cols - 1) * CELL) / 2;
      const offsetY = (height - (rows - 1) * CELL) / 2;
      const radiusSq = PROX_RADIUS * PROX_RADIUS;

      ctx.fillStyle = COLOR;

      for (let cx = 0; cx < cols; cx++) {
        for (let cy = 0; cy < rows; cy++) {
          const baseX = offsetX + cx * CELL;
          const baseY = offsetY + cy * CELL;

          // Two travelling waves (different temporal + spatial freq) give an
          // organic-looking flow. Composing them produces displacement in
          // both axes without obvious diagonal striping.
          const w1 = Math.sin(t * TIME_FREQ_A + baseX * SPATIAL_FREQ_X + baseY * SPATIAL_FREQ_Y);
          const w2 = Math.cos(t * TIME_FREQ_B - baseX * SPATIAL_FREQ_Y + baseY * SPATIAL_FREQ_X);
          const dispX = (w1 + w2) * 0.5 * NOISE_AMP_PX;
          const dispY = (w2 - w1) * 0.5 * NOISE_AMP_PX;
          const x = baseX + dispX;
          const y = baseY + dispY;

          let scale = 1 + (w1 + 1) * BREATH_AMP; // ambient breathing
          let alpha = BASE_ALPHA;

          if (cursor.active) {
            const dx = x - cursor.x;
            const dy = y - cursor.y;
            const distSq = dx * dx + dy * dy;
            if (distSq < radiusSq) {
              const f = 1 - Math.sqrt(distSq) / PROX_RADIUS;
              const eased = f * f;
              scale = scale + eased * (MAX_SCALE - 1);
              alpha = BASE_ALPHA + eased * (PEAK_ALPHA - BASE_ALPHA);
            }
          }

          const size = DOT_SIZE * scale;
          ctx.globalAlpha = alpha;
          ctx.fillRect(x - size / 2, y - size / 2, size, size);
        }
      }
      ctx.globalAlpha = 1;

      if (!reducedMotion) {
        rafId = requestAnimationFrame(render);
      }
    }

    resize();
    applyScrollBlur();
    render(performance.now());

    if (!reducedMotion) {
      window.addEventListener("mousemove", onMove, { passive: true });
      window.addEventListener("mouseleave", onLeave);
    }
    window.addEventListener("resize", resize);
    window.addEventListener("scroll", applyScrollBlur, { passive: true });

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", applyScrollBlur);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="fixed inset-0 z-0 pointer-events-none"
    />
  );
}
