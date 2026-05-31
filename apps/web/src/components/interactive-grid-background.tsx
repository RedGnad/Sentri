"use client";

import { useEffect, useRef } from "react";

/**
 * InteractiveGridBackground — port of the Blender geometry-nodes scene at
 * Desktop/DESIGN/Sentri-UI.blend.
 *
 * Key reading of the graph that corrects the previous version:
 *   The Wave Texture is NOT autonomous. The Mixer combines wave and
 *   proximity with proximity as the factor, so the wave's effect on
 *   position + scale is fully gated by how close each cell is to the
 *   cursor (Empty). Cells far from the cursor stay at their rest
 *   position — only those inside the proximity radius animate.
 *
 *   Within that radius, each cell traces a small circular orbit around
 *   its rest position. The orbit radius is proportional to proximity,
 *   so cells approach a full orbit at the cursor centre and shrink
 *   back to no displacement at the edge of the influence zone. Each
 *   cell has its own deterministic phase offset (from cellHash) so
 *   the field flows naturally instead of marching in lockstep.
 *
 * Implementation notes:
 *  - Canvas 2D, no 3D engine, no WebGL.
 *  - Sparsity is deterministic per (cx, cy) via cellHash, so cells keep
 *    their identity across scroll, resize, and cursor changes.
 *  - Canvas stays position: fixed, but the grid is rendered in virtual
 *    document coordinates offset by -scrollY * SCROLL_FACTOR. With
 *    factor 1.0 the grid scrolls at exactly page speed.
 *  - Scroll-driven blur ramps from clear (top) up to MAX_BLUR_PX so the
 *    content lower on the page reads cleanly.
 *  - prefers-reduced-motion: the orbit speed is forced to 0 so cells
 *    still scale on hover but no longer translate. Cursor and scroll
 *    stay responsive (user-driven, not autonomous).
 *  - pointer-events: none + aria-hidden — purely decorative.
 */

// Grid spacing / size — matches the cell pitch the user liked from the
// previous version.
const CELL = 22;
const DOT_SIZE = 2.2;

// Sparsity — Blender's Random Value Boolean ≈ 0.117 selection.
const SPARSITY = 0.18;

// Proximity (Empty / cursor) — the influence zone around the cursor.
const PROX_RADIUS = 200;

// Peak hover response (at the cursor centre, prox = 1).
const PROX_PEAK_SCALE = 9; // dot scale at the cursor centre
const PROX_PEAK_ALPHA = 0.85; // dot alpha at the cursor centre

// Orbit — each cell traces a circle around its rest position while the
// cursor is inside the proximity zone. Radius is proportional to prox,
// so the displacement smoothly returns to zero as the cursor moves away.
const ORBIT_RADIUS_PX = 10; // peak orbit radius (at cursor centre)
const ORBIT_SPEED = 0.0008; // angular velocity (rad/ms) — full turn ≈ 7.8s

// Base look — at rest (cursor far), every dot draws at this alpha and no
// displacement. No autonomous wave; the field is calm by default.
const BASE_ALPHA = 0.1;
const COLOR = "#FFB000"; // Sentri amber

// Scroll behaviour
const SCROLL_FACTOR = 1.0; // 1.0 = grid scrolls at page speed; < 1 = parallax
const SCROLL_BLUR_START_PX = 160;
const SCROLL_BLUR_FULL_PX = 720;
const MAX_BLUR_PX = 7;

// Deterministic per-cell hash so dots keep their identity through scroll +
// resize, and so the orbital phase offset is stable per cell.
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
    const orbitSpeed = reducedMotion ? 0 : ORBIT_SPEED;

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
      const t = now - startTime;
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

      const radiusSq = PROX_RADIUS * PROX_RADIUS;
      const orbitAngle = t * orbitSpeed; // base angle, same for all cells

      for (let cx = 0; cx < cols; cx++) {
        for (let cy = rowStartIdx; cy <= rowEndIdx; cy++) {
          // Sparsity gate — Blender Random Value Boolean.
          const h = cellHash(cx, cy);
          if (h > SPARSITY) continue;

          const baseX = offsetX + cx * CELL;
          const virtualY = cy * CELL;
          const screenY = virtualY - virtualScrollOffset;

          // Default state: cell at rest, no displacement, no scale boost.
          let dispX = 0;
          let dispY = 0;
          let scale = 1;
          let alpha = BASE_ALPHA;

          // Proximity to cursor (in screen space). Only inside the radius
          // do we apply the wave/orbit effect — the rest of the field
          // stays calm.
          if (cursor.active) {
            const dxCur = baseX - cursor.x;
            const dyCur = screenY - cursor.y;
            const distSq = dxCur * dxCur + dyCur * dyCur;
            if (distSq < radiusSq) {
              const f = 1 - Math.sqrt(distSq) / PROX_RADIUS;
              const prox = f * f; // quadratic ease-out — the Float Curve

              // Orbit: each cell rotates around its rest position. Phase
              // offset varies per cell via cellHash so the field flows
              // organically instead of marching in lockstep.
              const cellPhase = h * 2 * Math.PI; // 0..2π, stable per cell
              const angle = orbitAngle + cellPhase;
              const radius = ORBIT_RADIUS_PX * prox;
              dispX = Math.cos(angle) * radius;
              dispY = Math.sin(angle) * radius;

              scale = 1 + prox * (PROX_PEAK_SCALE - 1);
              alpha = BASE_ALPHA + prox * (PROX_PEAK_ALPHA - BASE_ALPHA);
            }
          }

          const x = baseX + dispX;
          const y = screenY + dispY;

          // Viewport cull (post-displacement, so a dot orbiting near the
          // edge still draws when its centre wanders out).
          if (y < -CELL || y > height + CELL || x < -CELL || x > width + CELL) {
            continue;
          }

          const size = DOT_SIZE * scale;
          ctx.globalAlpha = alpha;
          ctx.fillRect(x - size / 2, y - size / 2, size, size);
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
