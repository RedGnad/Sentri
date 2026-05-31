"use client";

import { useEffect, useRef } from "react";

/**
 * InteractiveGridBackground — port of the Blender geometry-nodes scene at
 * Desktop/DESIGN/Sentri-UI.blend, simplified to Canvas 2D.
 *
 * Reading the node graph:
 *   Grid → Mesh to Points → Random Value (Boolean, prob ≈ 0.12)
 *     → Set Position (Offset = mix(wave, proximity))
 *     → Instance on Points → Scale Instances (Scale = mix(wave, proximity))
 *
 *   Wave: Wave Texture, Bands type, Scale 5 → diagonal bands sliding via
 *     animated Phase Offset.
 *   Proximity: Geometry Proximity from each point to the Empty
 *     (here, the cursor in screen space).
 *   Mix: combines the wave (ambient flow) with the proximity bump.
 *
 * Implementation notes:
 *  - Canvas 2D rather than WebGL/Three.js. Even with ~20% sparsity that
 *    leaves a few hundred dots per frame — well within Canvas budget on
 *    mobile, and avoids shipping a 3D engine for a background ornament.
 *  - Sparsity is deterministic per (cx, cy) via a small integer hash, so
 *    the same cells keep their dot identity as the user scrolls.
 *  - Canvas stays position: fixed (so it always covers the viewport),
 *    but the grid is rendered in virtual document coordinates with an
 *    offset of -scrollY * SCROLL_FACTOR. With factor = 1.0 the grid
 *    scrolls exactly at page speed; drop below 1.0 for a subtle parallax.
 *  - Scroll-driven blur ramps from no blur (top) up to MAX_BLUR_PX so the
 *    content lower on the page reads cleanly.
 *  - prefers-reduced-motion → wave phase is frozen, but cursor + scroll
 *    still respond. No gratuitous autonomous motion in reduced mode.
 *  - pointer-events: none + aria-hidden — purely decorative.
 */

// Grid spacing / size
const CELL = 22; // px between candidate grid points
const DOT_SIZE = 2.2; // base dot side (px)

// Sparsity — Blender's Random Value Boolean probability
const SPARSITY = 0.18; // 18% of grid points keep an instance

// Proximity (Empty / cursor)
const PROX_RADIUS = 200; // px of influence around the cursor
const PROX_PEAK_SCALE = 9; // scale at the cursor centre
const PROX_PEAK_ALPHA = 0.85; // alpha at the cursor centre

// Wave Texture (Bands type, animated Phase Offset)
const WAVE_BAND_FREQ = 0.0028; // bands per pixel (≈ 6 bands across 1920px)
const WAVE_BAND_ANGLE = Math.PI / 6; // direction the bands travel
const WAVE_SPEED = 0.0002; // phase increment per ms (≈ 5s per cycle)
const WAVE_DISPLACEMENT_PX = 5; // max position offset driven by the wave
const WAVE_SCALE_CONTRIB = 3; // peak scale added by a fully-bright band
const WAVE_ALPHA_CONTRIB = 0.32; // peak alpha added by a fully-bright band

// Base look
const BASE_ALPHA = 0.1; // alpha at rest (no wave peak, no cursor)
const COLOR = "#FFB000"; // Sentri amber

// Scroll behaviour
const SCROLL_FACTOR = 1.0; // 1.0 = grid scrolls at page speed; < 1 = parallax
const SCROLL_BLUR_START_PX = 160;
const SCROLL_BLUR_FULL_PX = 720;
const MAX_BLUR_PX = 7;

// Deterministic per-cell hash so dots keep their identity through scroll +
// resize. Two large odd-prime multipliers, XOR'd and masked to a uint32.
function cellHash(cx: number, cy: number): number {
  const h = (Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663)) >>> 0;
  return (h % 100000) / 100000;
}

export function InteractiveGridBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvasEl = canvasRef.current;
    if (!canvasEl) return;
    const ctxRaw = canvasEl.getContext("2d");
    if (!ctxRaw) return;
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

    function render(now: number) {
      // Wave time: frozen under prefers-reduced-motion (no autonomous loop).
      const t = reducedMotion ? 0 : now - startTime;

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = COLOR;

      // Scroll-driven blur via CSS filter on the canvas itself.
      const scrollY = window.scrollY;
      let blurT = 0;
      if (scrollY > SCROLL_BLUR_START_PX) {
        const span = SCROLL_BLUR_FULL_PX - SCROLL_BLUR_START_PX;
        blurT = Math.min(1, (scrollY - SCROLL_BLUR_START_PX) / span);
      }
      canvas.style.filter = blurT > 0 ? `blur(${(blurT * MAX_BLUR_PX).toFixed(2)}px)` : "none";

      // Grid coordinates in document (virtual) space.
      const cols = Math.ceil(width / CELL) + 2;
      const offsetX = (width - (cols - 1) * CELL) / 2;
      const virtualScrollOffset = scrollY * SCROLL_FACTOR;

      // Only iterate rows currently in view (with a one-cell margin).
      const rowStartIdx = Math.floor((virtualScrollOffset - CELL) / CELL);
      const rowEndIdx = Math.ceil((virtualScrollOffset + height + CELL) / CELL);

      // Wave Texture pre-computation: project (x, y) onto the band direction
      // then read sin(proj * 2πf + phase). Phase advances with time.
      const cosA = Math.cos(WAVE_BAND_ANGLE);
      const sinA = Math.sin(WAVE_BAND_ANGLE);
      const wavePhase = t * WAVE_SPEED;

      const radiusSq = PROX_RADIUS * PROX_RADIUS;

      for (let cx = 0; cx < cols; cx++) {
        for (let cy = rowStartIdx; cy <= rowEndIdx; cy++) {
          // Sparsity gate (deterministic per cell): mirrors the Blender
          // Random Value Boolean ~0.12 selection step.
          if (cellHash(cx, cy) > SPARSITY) continue;

          const baseX = offsetX + cx * CELL;
          const virtualY = cy * CELL;
          const screenY = virtualY - virtualScrollOffset;

          // Wave Texture Bands: bands run perpendicular to the angle vector.
          const proj = baseX * cosA + virtualY * sinA;
          const waveRaw = Math.sin(proj * WAVE_BAND_FREQ * 2 * Math.PI + wavePhase * 2 * Math.PI);
          const wave01 = (waveRaw + 1) / 2; // 0..1

          // Geometry Proximity → Map Range → Float Curve (quadratic ease-out).
          let prox01 = 0;
          if (cursor.active) {
            const dx = baseX - cursor.x;
            const dy = screenY - cursor.y;
            const distSq = dx * dx + dy * dy;
            if (distSq < radiusSq) {
              const f = 1 - Math.sqrt(distSq) / PROX_RADIUS;
              prox01 = f * f;
            }
          }

          // Mix: wave provides ambient amplitude, proximity adds on top.
          // The Blender Mixer uses Float type — closest analogue is max(),
          // so the cursor dominates locally while the wave reigns elsewhere.
          const mixed = Math.max(wave01, prox01);

          // Set Position: displacement along the band direction, magnitude
          // driven by the wave (only — the proximity already drives scale).
          const dispMag = wave01 * WAVE_DISPLACEMENT_PX;
          const x = baseX + dispMag * cosA;
          const y = screenY + dispMag * sinA;

          // Scale Instances: 1 + (wave * waveContrib + prox * proxPeak)
          // The wave bumps every visible dot in a band by a small amount;
          // proximity adds a much larger spike at the cursor.
          const scale =
            1 + wave01 * WAVE_SCALE_CONTRIB + prox01 * (PROX_PEAK_SCALE - 1);

          // Alpha: same composition pattern.
          const alpha =
            BASE_ALPHA +
            wave01 * WAVE_ALPHA_CONTRIB +
            prox01 * (PROX_PEAK_ALPHA - BASE_ALPHA);

          // Cull off-viewport draws (cheap rejection after we computed wave
          // because the wave/scroll math is fixed-cost).
          if (
            y < -CELL ||
            y > height + CELL ||
            x < -CELL ||
            x > width + CELL
          ) {
            continue;
          }

          const size = DOT_SIZE * scale;
          ctx.globalAlpha = Math.min(1, alpha);
          ctx.fillRect(x - size / 2, y - size / 2, size, size);
          // mixed is referenced for future tweaks (e.g., glow on combined
          // peaks); keep the variable so the mix layer stays explicit.
          void mixed;
        }
      }
      ctx.globalAlpha = 1;

      rafId = requestAnimationFrame(render);
    }

    resize();
    render(performance.now());

    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("mouseleave", onLeave);
    window.addEventListener("resize", resize);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("resize", resize);
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
