import { hexToRgba, type Pt, type Rect } from './doc';
import type { ShapeKind } from './tools';

/** Integer line rasterizer. Calls `plot` for every pixel from (x0,y0) to (x1,y1). */
export function bresenham(x0: number, y0: number, x1: number, y1: number, plot: (x: number, y: number) => void): void {
  x0 = Math.floor(x0);
  y0 = Math.floor(y0);
  x1 = Math.floor(x1);
  y1 = Math.floor(y1);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    plot(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

/** Hard-edged (non-antialiased) line made of size×size squares, like Paint's pencil and eraser. */
export function pencilLine(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, size: number, color: string): void {
  ctx.fillStyle = color;
  const off = Math.floor((size - 1) / 2);
  bresenham(a.x, a.y, b.x, b.y, (x, y) => ctx.fillRect(x - off, y - off, size, size));
}

/** Round, antialiased brush segment. */
export function brushSegment(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, size: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

/** Full polyline stroke (used for the translucent marker, which must be drawn as one path). */
export function polylineStroke(ctx: CanvasRenderingContext2D, pts: Pt[], size: number, color: string): void {
  if (pts.length === 0) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 1) ctx.lineTo(pts[0].x + 0.01, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

/** Calligraphy nib: a fixed 45° flat nib swept from a to b. */
export function calligraphySegment(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, size: number, color: string): void {
  const nx = (size / 2) * Math.SQRT1_2;
  const ny = -(size / 2) * Math.SQRT1_2;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(a.x - nx, a.y - ny);
  ctx.lineTo(a.x + nx, a.y + ny);
  ctx.lineTo(b.x + nx, b.y + ny);
  ctx.lineTo(b.x - nx, b.y - ny);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = color;
  ctx.stroke();
}

/** Airbrush: random speckle within a radius. */
export function airbrushDab(ctx: CanvasRenderingContext2D, p: Pt, size: number, color: string): void {
  const radius = size * 2.5;
  const count = Math.max(6, Math.round(radius * radius * 0.06));
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const t = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * radius;
    ctx.fillRect(Math.floor(p.x + Math.cos(t) * r), Math.floor(p.y + Math.sin(t) * r), 1, 1);
  }
}

/** Scanline flood fill like Paint's bucket, with a small tolerance so near-identical shades count as one region. */
export function floodFill(ctx: CanvasRenderingContext2D, w: number, h: number, sx: number, sy: number, color: string, tolerance = 12): void {
  sx = Math.floor(sx);
  sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const px = new Uint32Array(d.buffer);
  const [r, g, b, a] = hexToRgba(color);
  const fill = ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
  const target = px[sy * w + sx];
  if (target === fill) return;
  const tr = target & 255;
  const tg = (target >> 8) & 255;
  const tb = (target >> 16) & 255;
  const ta = (target >>> 24) & 255;
  const visited = new Uint8Array(w * h);
  const match = (i: number) => {
    if (visited[i]) return false;
    const v = px[i];
    if (v === target) return true;
    return Math.abs((v & 255) - tr) <= tolerance && Math.abs(((v >> 8) & 255) - tg) <= tolerance && Math.abs(((v >> 16) & 255) - tb) <= tolerance && Math.abs(((v >>> 24) & 255) - ta) <= tolerance;
  };
  const stack: number[] = [sx, sy];
  while (stack.length) {
    const y = stack.pop() as number;
    let x = stack.pop() as number;
    let row = y * w;
    while (x >= 0 && match(row + x)) x--;
    x++;
    let spanUp = false;
    let spanDown = false;
    while (x < w && match(row + x)) {
      px[row + x] = fill;
      visited[row + x] = 1;
      if (y > 0) {
        const up = match(row - w + x);
        if (up && !spanUp) {
          stack.push(x, y - 1);
          spanUp = true;
        } else if (!up) spanUp = false;
      }
      if (y < h - 1) {
        const down = match(row + w + x);
        if (down && !spanDown) {
          stack.push(x, y + 1);
          spanDown = true;
        } else if (!down) spanDown = false;
      }
      x++;
    }
    row = 0;
  }
  ctx.putImageData(img, 0, 0);
}

/** Square brush: hard-edged squares along the segment. */
export function squareBrushSegment(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, size: number, color: string): void {
  ctx.fillStyle = color;
  const off = size / 2;
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    ctx.fillRect(Math.round(a.x + (b.x - a.x) * t - off), Math.round(a.y + (b.y - a.y) * t - off), size, size);
  }
}

export interface ShapeStyle {
  width: number;
  stroke: string | null;
  fill: string | null;
}

export function shapePath(kind: ShapeKind, a: Pt, b: Pt): Path2D {
  const p = new Path2D();
  const r: Rect = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
  if (kind === 'line') {
    p.moveTo(a.x, a.y);
    p.lineTo(b.x, b.y);
  } else if (kind === 'rect') {
    p.rect(r.x, r.y, r.w, r.h);
  } else if (kind === 'roundRect') {
    p.roundRect(r.x, r.y, r.w, r.h, Math.min(r.w, r.h) * 0.2);
  } else {
    p.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
  }
  return p;
}

export function paintPath(ctx: CanvasRenderingContext2D, path: Path2D, style: ShapeStyle): void {
  ctx.lineWidth = style.width;
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'round';
  if (style.fill) {
    ctx.fillStyle = style.fill;
    ctx.fill(path);
  }
  if (style.stroke) {
    ctx.strokeStyle = style.stroke;
    ctx.stroke(path);
  }
}

export function drawShape(ctx: CanvasRenderingContext2D, kind: ShapeKind, a: Pt, b: Pt, style: ShapeStyle): void {
  paintPath(ctx, shapePath(kind, a, b), kind === 'line' ? { ...style, fill: null, stroke: style.stroke ?? style.fill } : style);
}

export function curvePath(a: Pt, b: Pt, c1?: Pt, c2?: Pt): Path2D {
  const p = new Path2D();
  p.moveTo(a.x, a.y);
  if (c1 && c2) p.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, b.x, b.y);
  else if (c1) p.quadraticCurveTo(c1.x, c1.y, b.x, b.y);
  else p.lineTo(b.x, b.y);
  return p;
}

export function polygonPath(pts: Pt[], close: boolean): Path2D {
  const p = new Path2D();
  pts.forEach((q, i) => (i === 0 ? p.moveTo(q.x, q.y) : p.lineTo(q.x, q.y)));
  if (close) p.closePath();
  return p;
}

export interface TextStyle {
  size: number;
  color: string;
  font: string;
  bold: boolean;
  italic: boolean;
}

export const TEXT_FONT = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

export function drawText(ctx: CanvasRenderingContext2D, text: string, at: Pt, style: TextStyle): void {
  ctx.font = `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${style.size}px ${style.font}`;
  ctx.fillStyle = style.color;
  ctx.textBaseline = 'top';
  const lineHeight = Math.round(style.size * 1.25);
  text.split('\n').forEach((line, i) => ctx.fillText(line, at.x, at.y + i * lineHeight));
}
