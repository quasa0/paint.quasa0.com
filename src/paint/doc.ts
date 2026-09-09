export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Pt {
  x: number;
  y: number;
}

export function normRect(a: Pt, b: Pt): Rect {
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Snap a rect to integer pixels and clip it to the document. Returns null when empty. */
export function clipRect(r: Rect, w: number, h: number): Rect | null {
  const x0 = Math.max(0, Math.floor(r.x));
  const y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(w, Math.ceil(r.x + r.w));
  const y1 = Math.min(h, Math.ceil(r.y + r.h));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function rectContains(r: Rect, p: Pt): boolean {
  return p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h;
}

export function intersectRect(a: Rect, b: Rect): Rect | null {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas context unavailable');
  return ctx;
}

/**
 * The bitmap document: a single RGBA canvas. History lives in the editor's version graph.
 * The canvas element is mounted directly into the DOM by the workspace, so drawing
 * on `ctx` is immediately visible.
 */
export class PaintDoc {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  private listeners = new Set<() => void>();

  constructor(w: number, h: number, bg = '#ffffff') {
    this.canvas = makeCanvas(w, h);
    this.ctx = ctx2d(this.canvas);
    this.ctx.fillStyle = bg;
    this.ctx.fillRect(0, 0, w, h);
  }

  get width(): number {
    return this.canvas.width;
  }
  get height(): number {
    return this.canvas.height;
  }
  get bounds(): Rect {
    return { x: 0, y: 0, w: this.width, h: this.height };
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Notify listeners that pixels or size changed. */
  changed(): void {
    for (const fn of this.listeners) fn();
  }

  /** Pixels as they were before the current action started (captured by `snapshot`). */
  preState: ImageData | null = null;

  /** Capture the current pixels. Call before every mutation; the editor turns the result into a version. */
  snapshot(): void {
    this.preState = this.ctx.getImageData(0, 0, this.width, this.height);
  }

  /** Replace all pixels (used by the editor's version history). */
  restore(d: ImageData): void {
    if (d.width !== this.width || d.height !== this.height) {
      this.canvas.width = d.width;
      this.canvas.height = d.height;
    }
    this.ctx.putImageData(d, 0, 0);
    this.changed();
  }

  pixels(): ImageData {
    return this.ctx.getImageData(0, 0, this.width, this.height);
  }

  /** Resize the document, anchored top-left. New area is filled with `bg`. */
  resize(w: number, h: number, bg: string): void {
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    if (w === this.width && h === this.height) return;
    this.snapshot();
    const old = this.ctx.getImageData(0, 0, this.width, this.height);
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx.fillStyle = bg;
    this.ctx.fillRect(0, 0, w, h);
    this.ctx.putImageData(old, 0, 0, 0, 0, Math.min(w, old.width), Math.min(h, old.height));
    this.changed();
  }

  /** Scale the whole image to a new size (Paint's "Resize" dialog). */
  scaleTo(w: number, h: number): void {
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    if (w === this.width && h === this.height) return;
    this.snapshot();
    const copy = makeCanvas(this.width, this.height);
    ctx2d(copy).drawImage(this.canvas, 0, 0);
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
    this.ctx.drawImage(copy, 0, 0, w, h);
    this.changed();
  }

  /** Replace the document with an image (Open / New). */
  replace(source: CanvasImageSource, w: number, h: number): void {
    this.snapshot();
    this.canvas.width = Math.max(1, Math.round(w));
    this.canvas.height = Math.max(1, Math.round(h));
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, this.width, this.height);
    this.ctx.drawImage(source, 0, 0);
    this.changed();
  }

  /** New document: snapshot, resize and fill with an exactly uniform background. */
  reset(w: number, h: number, bg: string): void {
    this.snapshot();
    this.canvas.width = Math.max(1, Math.round(w));
    this.canvas.height = Math.max(1, Math.round(h));
    this.ctx.fillStyle = bg;
    this.ctx.fillRect(0, 0, this.width, this.height);
    this.changed();
  }

  clear(bg: string): void {
    this.snapshot();
    this.ctx.fillStyle = bg;
    this.ctx.fillRect(0, 0, this.width, this.height);
    this.changed();
  }

  /** Copy a region into a new canvas. */
  copyRegion(r: Rect): HTMLCanvasElement {
    const c = makeCanvas(r.w, r.h);
    ctx2d(c).drawImage(this.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    return c;
  }

  fillRegion(r: Rect, color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(r.x, r.y, r.w, r.h);
  }

  crop(r: Rect): void {
    const region = this.copyRegion(r);
    this.replace(region, r.w, r.h);
  }

  rotate(deg: 90 | 180 | 270): void {
    const copy = makeCanvas(this.width, this.height);
    ctx2d(copy).drawImage(this.canvas, 0, 0);
    const swap = deg !== 180;
    const w = swap ? this.height : this.width;
    const h = swap ? this.width : this.height;
    this.snapshot();
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx.save();
    this.ctx.translate(w / 2, h / 2);
    this.ctx.rotate((deg * Math.PI) / 180);
    this.ctx.drawImage(copy, -copy.width / 2, -copy.height / 2);
    this.ctx.restore();
    this.changed();
  }

  flip(axis: 'h' | 'v'): void {
    const copy = makeCanvas(this.width, this.height);
    ctx2d(copy).drawImage(this.canvas, 0, 0);
    this.snapshot();
    this.ctx.save();
    if (axis === 'h') {
      this.ctx.translate(this.width, 0);
      this.ctx.scale(-1, 1);
    } else {
      this.ctx.translate(0, this.height);
      this.ctx.scale(1, -1);
    }
    this.ctx.drawImage(copy, 0, 0);
    this.ctx.restore();
    this.changed();
  }

  pixelAt(x: number, y: number): string {
    const d = this.ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
    return rgbToHex(d[0], d[1], d[2]);
  }

  toDataURL(): string {
    return this.canvas.toDataURL('image/png');
  }

  toBlob(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      this.canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
    });
  }
}

export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

export function hexToRgba(hex: string): [number, number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

export function loadImage(src: Blob | string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = typeof src === 'string' ? src : URL.createObjectURL(src);
    img.onload = () => {
      if (typeof src !== 'string') URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      if (typeof src !== 'string') URL.revokeObjectURL(url);
      reject(new Error('Could not decode image'));
    };
    img.src = url;
  });
}
