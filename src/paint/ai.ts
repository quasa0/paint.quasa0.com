import { ctx2d, intersectRect, makeCanvas, type Pt, type Rect } from './doc';

export type ModelId = 'gpt-image-2.5-flare' | 'gpt-image-2.5-sunburst';
export type Quality = 'low' | 'medium' | 'high';
/**
 * How the selection is communicated to the model.
 * - nomask: send the context crop with no mask; the model sees the strokes under the selection and
 *   transforms them in place. Only the selection rectangle is pasted back, so the outside is untouched.
 * - mask: classic alpha mask (transparent = selection). The model does not see what is under the mask.
 * - maskref: alpha mask plus the unmasked crop as a second reference image.
 */
export type EditMode = 'nomask' | 'mask' | 'maskref' | 'selection';

export const MODELS: { id: ModelId; label: string; hint: string }[] = [
  { id: 'gpt-image-2.5-flare', label: 'Flare · fast', hint: 'gpt-image-2.5-flare: fastest, everyday quality' },
  { id: 'gpt-image-2.5-sunburst', label: 'Sunburst · precise', hint: 'gpt-image-2.5-sunburst: slower, best editing precision' },
];

export const QUALITIES: Quality[] = ['low', 'medium', 'high'];

/** OpenAI custom-size constraints for gpt-image-2.5. */
const MIN_PIXELS = 655_360;
const MAX_PIXELS = 1536 * 1536;
const MAX_ASPECT = 3;

export interface ContextPlan {
  /** Region of the document (may extend past its edges) that is sent to the model. */
  box: Rect;
  /** Pixel size of the image sent to the model. Multiples of 16. */
  outW: number;
  outH: number;
  /** outW / box.w */
  scale: number;
}

const roundUp16 = (v: number) => Math.max(16, Math.ceil(v / 16) * 16);

/**
 * Decide how much surrounding context to send with a selection. The model needs to see
 * neighbouring strokes so that the repaint continues them, and the API needs a size that
 * is a multiple of 16 with at least 655,360 pixels, so the crop is upscaled when needed.
 */
export function planContext(sel: Rect, docW: number, docH: number, withContext = true): ContextPlan {
  const pad = withContext ? Math.min(640, Math.max(64, Math.round(0.6 * Math.max(sel.w, sel.h)))) : 0;
  let bw = Math.min(docW, sel.w + pad * 2);
  let bh = Math.min(docH, sel.h + pad * 2);
  let bx = Math.min(Math.max(sel.x - pad, 0), docW - bw);
  let by = Math.min(Math.max(sel.y - pad, 0), docH - bh);

  // Keep the aspect ratio inside the API's 1:3 … 3:1 window by growing the short side.
  if (bw / bh > MAX_ASPECT) {
    const nh = bw / MAX_ASPECT;
    by -= (nh - bh) / 2;
    bh = nh;
  } else if (bh / bw > MAX_ASPECT) {
    const nw = bh / MAX_ASPECT;
    bx -= (nw - bw) / 2;
    bw = nw;
  }

  let scale = Math.max(1, Math.sqrt(MIN_PIXELS / (bw * bh)));
  if (bw * bh * scale * scale > MAX_PIXELS) scale = Math.sqrt(MAX_PIXELS / (bw * bh));
  const outW = roundUp16(bw * scale);
  const outH = roundUp16(bh * scale);
  // Grow the box symmetrically so the crop maps onto outW×outH with a uniform scale.
  const cx = bx + bw / 2;
  const cy = by + bh / 2;
  bw = outW / scale;
  bh = outH / scale;
  return { box: { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh }, outW, outH, scale };
}

export function buildPrompt(userPrompt: string, mode: EditMode, region: string): string {
  const what = userPrompt.trim();
  if (mode === 'selection') {
    return [
      `Edit this image: ${what}.`,
      'The image is exactly the area to change. Treat whatever is already drawn in it as the blueprint: keep its position, size, angle, direction and proportions, and transform it into the requested content instead of drawing something new elsewhere.',
      'Keep the background exactly as it is (flat, untextured, same color); do not add paper texture, vignettes, shadows on the background, borders or frames. Do not crop, pad, zoom or shift the picture.',
    ].join(' ');
  }
  const common = [
    'Treat whatever is already drawn there as the blueprint: keep its exact position, size, angle, direction and proportions, and transform it into the requested content instead of drawing something new elsewhere.',
    'Match the surrounding image so the result blends seamlessly: keep the same style, colors and lighting. Any line, edge or shape that enters the region from outside must continue through the region and line up exactly with the outside on both sides.',
    'Keep the background exactly as it is (flat, untextured, same color); do not add paper texture, vignettes, shadows on the background, borders or frames.',
  ];
  if (mode === 'nomask') {
    return [
      `Edit this drawing. Change only the content inside the region ${region}: ${what}.`,
      'Leave everything outside that region completely unchanged, pixel for pixel.',
      ...common,
    ].join(' ');
  }
  if (mode === 'maskref') {
    return [
      `Edit only the transparent area of the mask: ${what}.`,
      'The second image shows the same picture without the mask, so you can see what is currently drawn inside the masked area.',
      ...common,
      'Everything outside the mask must stay pixel-for-pixel unchanged.',
    ].join(' ');
  }
  return [
    `Edit only the transparent area of the mask: ${what}.`,
    ...common,
    'Everything outside the mask must stay pixel-for-pixel unchanged.',
  ].join(' ');
}

/** How requests are authorized: a personal API key, or an OpenAI (ChatGPT) sign-in relayed by /api/codex-images. */
export type AiAuth = { kind: 'apiKey'; apiKey: string } | { kind: 'openai'; accessToken: string; accountId: string };

export interface InpaintOptions {
  source: HTMLCanvasElement;
  selection: Rect;
  /** Optional free-form outline in document coordinates; only pixels inside it are edited. */
  path?: Pt[] | null;
  prompt: string;
  auth: AiAuth;
  model: ModelId;
  quality: Quality;
  mode?: EditMode;
  /** Background color used where the request image extends past the selection/canvas. */
  background?: string;
  signal?: AbortSignal;
  onStatus?: (msg: string) => void;
}

export interface InpaintResult {
  /** Canvas the size of the selection containing the repainted pixels. */
  patch: HTMLCanvasElement;
  plan: ContextPlan;
  elapsedMs: number;
  /** Drift of the model output relative to the input, in output pixels. */
  shift: { dx: number; dy: number; score: number };
}

export class OpenAIError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function canvasToBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode PNG'))), 'image/png'),
  );
}

function decodeBase64Png(b64: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode the generated image'));
    img.src = `data:image/png;base64,${b64}`;
  });
}

/** Build the image + mask pair for the API from the document and selection. */
export function buildRequestImages(source: HTMLCanvasElement, sel: Rect, plan: ContextPlan, path?: Pt[] | null, bg = '#ffffff') {
  const { box, outW, outH, scale } = plan;
  const image = makeCanvas(outW, outH);
  const ictx = ctx2d(image);
  ictx.fillStyle = bg;
  ictx.fillRect(0, 0, outW, outH);
  const visible = intersectRect(box, { x: 0, y: 0, w: source.width, h: source.height });
  if (visible) {
    ictx.imageSmoothingEnabled = true;
    ictx.imageSmoothingQuality = 'high';
    ictx.drawImage(
      source,
      visible.x, visible.y, visible.w, visible.h,
      (visible.x - box.x) * scale, (visible.y - box.y) * scale, visible.w * scale, visible.h * scale,
    );
  }
  const mask = makeCanvas(outW, outH);
  const mctx = ctx2d(mask);
  mctx.fillStyle = '#000000';
  mctx.fillRect(0, 0, outW, outH);
  const mx = (sel.x - box.x) * scale;
  const my = (sel.y - box.y) * scale;
  if (path && path.length >= 3) {
    mctx.save();
    mctx.globalCompositeOperation = 'destination-out';
    mctx.translate(-box.x * scale, -box.y * scale);
    mctx.scale(scale, scale);
    mctx.fill(pathToPath2D(path), 'evenodd');
    mctx.restore();
  } else {
    mctx.clearRect(Math.floor(mx), Math.floor(my), Math.ceil(sel.w * scale), Math.ceil(sel.h * scale));
  }
  return { image, mask, maskRect: { x: mx, y: my, w: sel.w * scale, h: sel.h * scale } };
}

export function pathToPath2D(pts: Pt[]): Path2D {
  const p = new Path2D();
  pts.forEach((q, i) => (i === 0 ? p.moveTo(q.x, q.y) : p.lineTo(q.x, q.y)));
  p.closePath();
  return p;
}

/** Human-readable location of the selection inside the crop, for prompts without a mask. */
export function describeRegion(r: Rect, w: number, h: number): string {
  const pct = (v: number, total: number) => `${Math.round((v / total) * 100)}%`;
  return `spanning ${pct(r.x, w)}–${pct(r.x + r.w, w)} of the width and ${pct(r.y, h)}–${pct(r.y + r.h, h)} of the height (from the top-left)`;
}

/** Our relay runs as a Vercel Function, which rejects request bodies over 4.5 MB (413). Keep the JSON under this. */
const RELAY_BODY_BUDGET = 4_000_000;

/**
 * Encode a canvas as a data URL that fits `budget` bytes: PNG when it fits, otherwise JPEG at
 * decreasing quality, and as a last resort a downscaled JPEG. The model resamples inputs anyway,
 * so a lightly compressed photo loses nothing visible; line art stays PNG because it is small.
 */
function encodeWithinBudget(canvas: HTMLCanvasElement, budget: number): string {
  const png = canvas.toDataURL('image/png');
  if (png.length <= budget) return png;
  for (const q of [0.92, 0.85, 0.75]) {
    const jpg = canvas.toDataURL('image/jpeg', q);
    if (jpg.length <= budget) return jpg;
  }
  let c = canvas;
  for (let i = 0; i < 4; i++) {
    const jpg = c.toDataURL('image/jpeg', 0.8);
    if (jpg.length <= budget) return jpg;
    const f = Math.sqrt(budget / jpg.length) * 0.95;
    const next = makeCanvas(Math.max(64, Math.round(c.width * f)), Math.max(64, Math.round(c.height * f)));
    const nctx = ctx2d(next);
    nctx.imageSmoothingEnabled = true;
    nctx.imageSmoothingQuality = 'high';
    nctx.drawImage(c, 0, 0, next.width, next.height);
    c = next;
  }
  return c.toDataURL('image/jpeg', 0.7);
}

/** Same edit through the OpenAI sign-in: JSON body, relayed by our function because chatgpt.com blocks browser origins. */
async function callEditsViaOpenAI(body: Record<string, unknown>, auth: Extract<AiAuth, { kind: 'openai' }>, signal?: AbortSignal): Promise<string> {
  let res: Response;
  try {
    res = await fetch('/api/codex-images?op=edits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.accessToken}`, 'chatgpt-account-id': auth.accountId },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new OpenAIError(0, 'Could not reach the server.');
  }
  const text = await res.text();
  let json: { data?: { b64_json?: string }[]; error?: { message?: string }; detail?: string } = {};
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const detail = json.error?.message || json.detail || `OpenAI request failed (${res.status})`;
    if (res.status === 401) throw new OpenAIError(401, `Your OpenAI session is not valid. Sign in again. ${detail}`);
    if (res.status === 413) throw new OpenAIError(413, 'The selection is too large to send. Try a smaller area.');
    if (res.status === 429) throw new OpenAIError(429, `Usage limit reached on your ChatGPT plan. ${detail}`);
    throw new OpenAIError(res.status, detail);
  }
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new OpenAIError(res.status, 'OpenAI returned no image data');
  return b64;
}

async function callEdits(form: FormData, apiKey: string, signal?: AbortSignal): Promise<string> {
  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new OpenAIError(0, 'Could not reach api.openai.com. Check your connection; a blocked request usually means an invalid key format or an ad blocker.');
  }
  const text = await res.text();
  let json: { data?: { b64_json?: string }[]; error?: { message?: string } } = {};
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const detail = json.error?.message || `OpenAI request failed (${res.status})`;
    if (res.status === 401) throw new OpenAIError(401, `Invalid API key. ${detail}`);
    if (res.status === 429) throw new OpenAIError(429, `Rate limit or quota exceeded. ${detail}`);
    if (res.status === 403) throw new OpenAIError(403, `This key cannot use the Images API. ${detail}`);
    throw new OpenAIError(res.status, detail);
  }
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new OpenAIError(res.status, 'OpenAI returned no image data');
  return b64;
}

/**
 * Repaint the selected rectangle. Only the selection is written back to the caller;
 * surrounding pixels are sent purely as context and are never modified.
 */
export async function inpaint(opts: InpaintOptions): Promise<InpaintResult> {
  const t0 = performance.now();
  const { source, selection: sel, onStatus } = opts;
  const mode = opts.mode ?? 'selection';
  // 'selection' sends only the selected pixels (no surrounding context, no mask).
  const plan = planContext(sel, source.width, source.height, mode !== 'selection');
  onStatus?.('Preparing image…');
  const { image, mask, maskRect } = buildRequestImages(source, sel, plan, opts.path, opts.background);
  const [imageBlob, maskBlob] = await Promise.all([canvasToBlob(image), canvasToBlob(mask)]);
  const region = describeRegion(maskRect, plan.outW, plan.outH);

  const makeForm = (withFidelity: boolean) => {
    const fd = new FormData();
    fd.append('model', opts.model);
    fd.append('prompt', buildPrompt(opts.prompt, mode, region));
    fd.append('image[]', imageBlob, 'image.png');
    if (mode !== 'nomask' && mode !== 'selection') fd.append('mask', maskBlob, 'mask.png');
    if (mode === 'maskref') fd.append('image[]', imageBlob, 'reference.png');
    fd.append('size', `${plan.outW}x${plan.outH}`);
    fd.append('quality', opts.quality);
    fd.append('output_format', 'png');
    fd.append('n', '1');
    if (withFidelity) fd.append('input_fidelity', 'high');
    return fd;
  };

  onStatus?.(`Generating with ${opts.model}…`);
  let b64: string;
  if (opts.auth.kind === 'openai') {
    // The sign-in backend keeps the input's aspect ratio but picks its own resolution (~1.6 MP);
    // the crop is already at the target aspect, and the result is resampled to the exact size below.
    const withMask = mode !== 'nomask' && mode !== 'selection';
    const maskUrl = withMask ? mask.toDataURL('image/png') : '';
    const copies = mode === 'maskref' ? 2 : 1;
    const imageUrl = encodeWithinBudget(image, Math.floor((RELAY_BODY_BUDGET - maskUrl.length - 2048) / copies));
    const body: Record<string, unknown> = {
      model: opts.model,
      prompt: buildPrompt(opts.prompt, mode, region),
      images: Array.from({ length: copies }, () => ({ image_url: imageUrl })),
      size: `${plan.outW}x${plan.outH}`,
      quality: opts.quality,
    };
    if (withMask) body.mask = { image_url: maskUrl };
    b64 = await callEditsViaOpenAI(body, opts.auth, opts.signal);
  } else {
    try {
      b64 = await callEdits(makeForm(true), opts.auth.apiKey, opts.signal);
    } catch (e) {
      // Older/newer model snapshots may reject input_fidelity; retry once without it.
      if (e instanceof OpenAIError && e.status === 400 && /input_fidelity/i.test(e.message)) {
        b64 = await callEdits(makeForm(false), opts.auth.apiKey, opts.signal);
      } else throw e;
    }
  }

  onStatus?.('Applying result…');
  const img = await decodeBase64Png(b64);
  // The API normally returns exactly outW×outH; tolerate any size by resampling to the plan.
  const out = makeCanvas(plan.outW, plan.outH);
  const octx = ctx2d(out);
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(img, 0, 0, plan.outW, plan.outH);
  // gpt-image outputs are not pixel-registered to the input: the whole picture often drifts by a
  // few pixels. Measure that drift on the untouched context ring and compensate before pasting.
  const shift = estimateShift(image, out, maskRect);
  (window as unknown as { __lastInpaint?: unknown }).__lastInpaint = { plan, maskRect, responseW: img.width, responseH: img.height, mode, shift };
  const patch = makeCanvas(sel.w, sel.h);
  const pctx = ctx2d(patch);
  pctx.imageSmoothingEnabled = true;
  pctx.imageSmoothingQuality = 'high';
  pctx.drawImage(
    out,
    maskRect.x + shift.dx, maskRect.y + shift.dy, maskRect.w, maskRect.h,
    0, 0, sel.w, sel.h,
  );
  return { patch, plan, elapsedMs: performance.now() - t0, shift };
}

function grayscale(c: HTMLCanvasElement, factor: number): { g: Float32Array; w: number; h: number } {
  const w = Math.floor(c.width / factor);
  const h = Math.floor(c.height / factor);
  const small = makeCanvas(w, h);
  const sctx = ctx2d(small);
  sctx.imageSmoothingEnabled = true;
  sctx.drawImage(c, 0, 0, w, h);
  const d = sctx.getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) g[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return { g, w, h };
}

/**
 * Find the translation (dx, dy) such that out(x + dx, y + dy) ≈ in(x, y) over the context ring
 * (everything outside the masked rectangle plus a margin). Coarse-to-fine sum of absolute differences.
 */
export function estimateShift(input: HTMLCanvasElement, out: HTMLCanvasElement, maskRect: Rect): { dx: number; dy: number; score: number } {
  const maxShift = Math.round(Math.min(input.width, input.height) * 0.05);
  const sad = (a: { g: Float32Array; w: number; h: number }, b: { g: Float32Array; w: number; h: number }, ring: Rect, dx: number, dy: number, step: number) => {
    let sum = 0;
    let n = 0;
    for (let y = 0; y < a.h; y += step) {
      const yb = y + dy;
      if (yb < 0 || yb >= b.h) continue;
      for (let x = 0; x < a.w; x += step) {
        if (x >= ring.x && x < ring.x + ring.w && y >= ring.y && y < ring.y + ring.h) continue;
        const xb = x + dx;
        if (xb < 0 || xb >= b.w) continue;
        sum += Math.abs(a.g[y * a.w + x] - b.g[yb * b.w + xb]);
        n++;
      }
    }
    return n ? sum / n : Infinity;
  };
  const margin = 6;
  const inner: Rect = { x: maskRect.x - margin, y: maskRect.y - margin, w: maskRect.w + margin * 2, h: maskRect.h + margin * 2 };
  // Nothing to align against if the ring is flat (e.g. all white): keep zero shift.
  const fullA = grayscale(input, 1);
  let mean = 0;
  let cnt = 0;
  for (let y = 0; y < fullA.h; y += 2) for (let x = 0; x < fullA.w; x += 2) {
    if (x >= inner.x && x < inner.x + inner.w && y >= inner.y && y < inner.y + inner.h) continue;
    mean += fullA.g[y * fullA.w + x];
    cnt++;
  }
  mean /= Math.max(1, cnt);
  let variance = 0;
  for (let y = 0; y < fullA.h; y += 2) for (let x = 0; x < fullA.w; x += 2) {
    if (x >= inner.x && x < inner.x + inner.w && y >= inner.y && y < inner.y + inner.h) continue;
    variance += (fullA.g[y * fullA.w + x] - mean) ** 2;
  }
  if (variance / Math.max(1, cnt) < 4) return { dx: 0, dy: 0, score: 0 };

  const f = 4;
  const a4 = grayscale(input, f);
  const b4 = grayscale(out, f);
  const ring4: Rect = { x: inner.x / f, y: inner.y / f, w: inner.w / f, h: inner.h / f };
  let best = { dx: 0, dy: 0, score: Infinity };
  const r4 = Math.ceil(maxShift / f);
  for (let dy = -r4; dy <= r4; dy++) for (let dx = -r4; dx <= r4; dx++) {
    const sc = sad(a4, b4, ring4, dx, dy, a4.w * a4.h > 60000 ? 2 : 1) + 0.01 * (Math.abs(dx) + Math.abs(dy));
    if (sc < best.score) best = { dx, dy, score: sc };
  }
  const fullB = grayscale(out, 1);
  let fine = { dx: best.dx * f, dy: best.dy * f, score: Infinity };
  for (let dy = -f; dy <= f; dy++) for (let dx = -f; dx <= f; dx++) {
    const tx = best.dx * f + dx;
    const ty = best.dy * f + dy;
    const sc = sad(fullA, fullB, inner, tx, ty, 3) + 0.002 * (Math.abs(tx) + Math.abs(ty));
    if (sc < fine.score) fine = { dx: tx, dy: ty, score: sc };
  }
  return fine;
}
