"use client";

import { useEffect, useRef } from "react";

/**
 * InteractiveGridBackground — port of the Blender geometry-nodes scene at
 * Desktop/DESIGN/Sentri-UI.blend.
 *
 * Behaviour confirmed against the user's screen recording:
 *   - At rest, every cell stays exactly at its base grid position.
 *     There is NO autonomous motion — no breathing, no orbit, no sliding
 *     wave. The wave only modulates the field where the cursor (Empty)
 *     is currently close.
 *   - Cells inside the proximity radius are pushed RADIALLY OUTWARD from
 *     the cursor (i.e. away from the Empty). The push magnitude is the
 *     quadratic ease-out of (1 - dist/radius) — the Float Curve in the
 *     graph. This is what creates the visible "halo" of cells around
 *     the cursor with a hollowed-out centre.
 *   - Scale + alpha follow the same ease-out, peaking at the cursor.
 *   - When the cursor moves to a new position, cells in the previous
 *     zone fall back to their rest position (because their distance is
 *     now > radius), and new cells get pushed in the new zone.
 *
 * Implementation notes:
 *  - Canvas 2D. The push is a per-frame function of cursor position and
 *    cell rest position only — no time integration, no per-cell state.
 *  - Sparsity is deterministic per (cx, cy) via cellHash, so cells keep
 *    their identity across scroll + resize.
 *  - Canvas stays position: fixed, but the grid is rendered in virtual
 *    document coordinates with an offset of -scrollY * SCROLL_FACTOR.
 *    With factor 1.0 the grid scrolls at exactly page speed.
 *  - Scroll-driven blur ramps from clear (top) up to MAX_BLUR_PX so the
 *    content lower on the page reads cleanly.
 *  - prefers-reduced-motion: the rest state is already static and the
 *    only motion is cursor-driven (user-initiated), so reduced-motion
 *    has no effect to disable.
 *  - pointer-events: none + aria-hidden — purely decorative.
 */

// Grid spacing / size — matches the cell pitch the user liked.
const CELL = 22;
const DOT_SIZE = 2.2;

// Sparsity — Blender's Random Value Boolean ≈ 0.117 selection.
const SPARSITY = 0.18;

// Proximity (Empty / cursor) — the influence zone around the cursor.
const PROX_RADIUS = 200;

// Peak hover response at the cursor centre (prox = 1).
const PROX_PEAK_SCALE = 9;
const PROX_PEAK_ALPHA = 0.85;
// Peak radial push, applied at the MID-radius (not at the cursor centre)
// via a parabolic donut envelope. A cell sitting directly under the cursor
// stays put — only its scale + alpha peak there — which avoids the
// 180-degree direction flip you'd otherwise get when the cursor crosses
// a cell (and the resulting visible teleportation).
const PUSH_MAX_PX = 38;

// Base look — at rest, every dot draws at this alpha and no displacement.
const BASE_ALPHA = 0.1;
const COLOR = "#FFB000"; // Sentri amber

// Scroll behaviour.
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

    let width = 0;
    let height = 0;
    let dpr = Math.max(1, window.devicePixelRatio || 1);
    const cursor = { x: -9999, y: -9999, active: false };
    let rafId = 0;

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

    function render() {
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

      for (let cx = 0; cx < cols; cx++) {
        for (let cy = rowStartIdx; cy <= rowEndIdx; cy++) {
          // Sparsity gate — Blender Random Value Boolean.
          if (cellHash(cx, cy) > SPARSITY) continue;

          const baseX = offsetX + cx * CELL;
          const virtualY = cy * CELL;
          const screenY = virtualY - virtualScrollOffset;

          // Default: cell exactly at rest, no displacement, base alpha.
          let dispX = 0;
          let dispY = 0;
          let scale = 1;
          let alpha = BASE_ALPHA;

          if (cursor.active) {
            // Geometry Proximity — distance from cell to cursor in screen
            // space. Cells outside the radius keep their rest state.
            const dx = baseX - cursor.x;
            const dy = screenY - cursor.y;
            const distSq = dx * dx + dy * dy;
            if (distSq < radiusSq) {
              const dist = Math.sqrt(distSq);
              // Float Curve — quadratic ease-out (1 at cursor centre, 0 at edge).
              const f = 1 - dist / PROX_RADIUS;
              const prox = f * f;

              // Set Position — radial push outward along the cursor→cell
              // direction. Magnitude uses a parabolic donut envelope
              // (4·f·(1-f), zero at both ends, peak 1 at f=0.5) instead of
              // peaking at the cursor centre. Two benefits:
              //  1. A cell directly under the cursor (dist→0) receives a
              //     zero-magnitude push — even though the cursor→cell
              //     direction vector is degenerate at dist=0, multiplying
              //     by zero makes it visually stable and removes the
              //     180° direction flip + teleportation that happened
              //     when the cursor crossed a cell.
              //  2. Cells form a clear "halo" at mid-radius — visually
              //     closer to the ring of displaced cells in the
              //     Blender recording than a centred peak would give.
              if (dist > 0.001) {
                const dirX = dx / dist;
                const dirY = dy / dist;
                const pushEnvelope = 4 * f * (1 - f);
                const pushMag = PUSH_MAX_PX * pushEnvelope;
                dispX = dirX * pushMag;
                dispY = dirY * pushMag;
              }

              // Scale Instances — same proximity drives the scale + alpha.
              scale = 1 + prox * (PROX_PEAK_SCALE - 1);
              alpha = BASE_ALPHA + prox * (PROX_PEAK_ALPHA - BASE_ALPHA);
            }
          }

          const x = baseX + dispX;
          const y = screenY + dispY;

          // Viewport cull post-displacement.
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
    render();

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
