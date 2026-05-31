"use client";

import { useEffect, useRef } from "react";

/**
 * InteractiveGridBackground — a fine amber grid that scales + glows near the
 * cursor. Translates the Blender proximity-field design (grid of cells, each
 * one displaced by distance to an empty) into a discreet web background.
 *
 * Implementation notes:
 *  - Canvas 2D rather than WebGL/Three.js. The grid is a couple of thousand
 *    1-2px rectangles per frame — well within Canvas budget even on mobile,
 *    and avoids shipping a 3D engine for a background ornament.
 *  - DPR-aware for crisp rendering on retina.
 *  - prefers-reduced-motion → render once, no animation loop.
 *  - pointer-events: none → never intercepts clicks.
 *  - aria-hidden → invisible to assistive tech (it's purely decorative).
 *  - Fixed inset, negative z-index → sits behind every content stack
 *    without changing layout flow.
 */

const CELL = 28; // px between dots
const DOT_SIZE = 2; // base dot size in px (square)
const PROX_RADIUS = 180; // px of influence around the cursor
const MAX_SCALE = 6; // dot scale at cursor center
const BASE_ALPHA = 0.16; // base opacity (visible film without dominating)
const PEAK_ALPHA = 0.65; // peak opacity at cursor
const COLOR = "#FFB000"; // Sentri amber

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
      const cols = Math.ceil(width / CELL) + 1;
      const rows = Math.ceil(height / CELL) + 1;
      // Centre the grid so it stays visually balanced regardless of width.
      const offsetX = (width - (cols - 1) * CELL) / 2;
      const offsetY = (height - (rows - 1) * CELL) / 2;
      const radiusSq = PROX_RADIUS * PROX_RADIUS;

      ctx.fillStyle = COLOR;

      for (let cx = 0; cx < cols; cx++) {
        for (let cy = 0; cy < rows; cy++) {
          const x = offsetX + cx * CELL;
          const y = offsetY + cy * CELL;

          let scale = 1;
          let alpha = BASE_ALPHA;

          if (cursor.active) {
            const dx = x - cursor.x;
            const dy = y - cursor.y;
            const distSq = dx * dx + dy * dy;
            if (distSq < radiusSq) {
              // Quadratic ease-out from 1 (at cursor) down to 0 (at radius).
              const t = 1 - Math.sqrt(distSq) / PROX_RADIUS;
              const eased = t * t;
              scale = 1 + eased * (MAX_SCALE - 1);
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
    render();

    if (!reducedMotion) {
      window.addEventListener("mousemove", onMove, { passive: true });
      window.addEventListener("mouseleave", onLeave);
    }
    window.addEventListener("resize", resize);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("resize", resize);
    };
  }, []);

  // z-0 (not -z-10): the body has its own opaque background that the
  // negative-z-index canvas was painting underneath. With z-0 the canvas
  // floats above the body bg; the landing page wraps its content in
  // `relative z-10` so all sections still paint above the grid.
  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="fixed inset-0 z-0 pointer-events-none"
    />
  );
}
