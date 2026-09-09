import { PaintDoc, clipRect, ctx2d, hexToRgba, loadImage, makeCanvas, normRect, rectContains, type Pt, type Rect } from './doc';
import * as draw from './draw';
import { inpaint, pathToPath2D, type EditMode, type ModelId, type Quality } from './ai';
import { canvasToBlob, deleteDrawing, deleteVersion, deleteVersionsOf, getDrawing, getVersion, listDrawings, listVersions, makeThumb, newId, openDb, putDrawing, putVersion, type DrawingMeta, type VersionMeta } from './library';
import { PALETTE, AIRBRUSH_SIZES, BRUSH_SIZES, ERASER_SIZES, LINE_WIDTHS, MAGNIFIER_ZOOMS, TOOLS, clampZoom, type BrushShape, type FillMode, type ShapeKind, type ToolId } from './tools';

export type DialogId = 'none' | 'key' | 'attributes' | 'stretch' | 'flip' | 'about' | 'shortcuts';
export type Theme = 'system' | 'light' | 'dark';
export const DEFAULT_SIZE = { w: 1080, h: 1080 };
const MAX_DIM = 8000;

export interface TextBox {
  x: number;
  y: number;
  text: string;
  size: number;
  bold: boolean;
  italic: boolean;
}

export interface AiState {
  status: 'idle' | 'running' | 'error' | 'done';
  message: string;
  lastMs?: number;
}

/** One in-flight (or failed) AI repaint. Jobs outlive the selection they were started from. */
export interface AiJob {
  id: number;
  rect: Rect;
  path: Pt[] | null;
  prompt: string;
  status: 'running' | 'error';
  message: string;
}

export interface EditorState {
  tool: ToolId;
  prevTool: ToolId;
  brushShape: BrushShape;
  brushSize: number;
  eraserSize: number;
  airbrushSize: number;
  lineWidth: number;
  fillMode: FillMode;
  magnifierZoom: number;
  transparentSelection: boolean;
  color1: string;
  color2: string;
  customColors: string[];
  selection: Rect | null;
  /** Free-form outline (document coordinates) when the selection was made with the lasso. */
  selectionPath: Pt[] | null;
  /** Lasso stroke in progress. */
  lasso: Pt[] | null;
  /** True while the selection holds lifted pixels that follow the mouse. */
  floating: boolean;
  hasClipboard: boolean;
  zoom: number;
  panX: number;
  panY: number;
  gridlines: boolean;
  docW: number;
  docH: number;
  docVersion: number;
  cursor: Pt | null;
  textBox: TextBox | null;
  /** Live size while dragging a canvas resize handle. */
  resizing: { w: number; h: number } | null;
  /** Multi-step tool in progress (curve / polygon). */
  pending: 'curve' | 'polygon' | null;
  ai: AiState;
  jobs: AiJob[];
  apiKey: string;
  model: ModelId;
  quality: Quality;
  editMode: EditMode;
  canUndo: boolean;
  canRedo: boolean;
  dialog: DialogId;
  fileName: string;
  spaceHeld: boolean;
  shiftHeld: boolean;
  status: string;
  theme: Theme;
  /** Saved drawings, newest first. */
  drawings: DrawingMeta[];
  currentId: string | null;
  showLibrary: boolean;
  /** Incremented when the view should re-fit the whole canvas (open, new, load). */
  fitRequest: number;
  /** Snap guides shown while dragging a selection (document coords). */
  guides: { x: number | null; y: number | null };
  /** Last AI prompt, for "repaint again" and ↑ recall. */
  lastPrompt: string;
  /** Persistent history of the current drawing (V1, V2, …) and the version on screen. */
  versions: VersionMeta[];
  headId: string | null;
  showVersions: boolean;
  /** True until the first change on a new document (drives the empty-canvas hint). */
  blank: boolean;
}

type StrokeTool = 'pencil' | 'eraser' | 'brush' | 'airbrush';
export type Corner = 'nw' | 'ne' | 'sw' | 'se';

type Gesture =
  | { kind: 'stroke'; last: Pt; color: string; size: number; tool: StrokeTool; shape: BrushShape }
  | { kind: 'shape'; start: Pt; shape: ShapeKind; style: draw.ShapeStyle }
  | { kind: 'curveDrag'; phase: 0 | 1 | 2 }
  | { kind: 'polygonDrag' }
  | { kind: 'marquee'; start: Pt }
  | { kind: 'lasso'; pts: Pt[] }
  | { kind: 'move'; grab: Pt; origin: Pt; originPath: Pt[] | null }
  | { kind: 'scale'; corner: Corner; start: Rect; startPath: Pt[] | null; keepAspect: boolean }
  | { kind: 'none' };

interface CurveState {
  a: Pt;
  b: Pt;
  c1?: Pt;
  c2?: Pt;
  style: draw.ShapeStyle;
}
interface PolygonState {
  pts: Pt[];
  cursor: Pt;
  style: draw.ShapeStyle;
}

const SETTINGS_KEY = 'ai-paint:settings';
const DOC_KEY = 'ai-paint:doc';
const KEY_KEY = 'ai-paint:openai-key';
const CURRENT_KEY = 'ai-paint:current';

interface PersistedSettings {
  color1?: string;
  color2?: string;
  customColors?: string[];
  model?: ModelId;
  quality?: Quality;
  editMode?: EditMode;
  theme?: Theme;
  showLibrary?: boolean;
  showVersions?: boolean;
}

function loadSettings(): PersistedSettings {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  } catch {
    return {};
  }
}

const DEFAULT_STATUS = 'Select an area and type a prompt to repaint it with AI.';

/**
 * Central editor. Plain TypeScript with an immutable `state` object and a subscribe/notify
 * pair so React can consume it through useSyncExternalStore without stale closures.
 */
export class Editor {
  readonly doc: PaintDoc;
  /** Overlay canvas the size of the document for in-progress shapes and the floating selection. */
  readonly preview: HTMLCanvasElement;
  private pctx: CanvasRenderingContext2D;
  private floatingCanvas: HTMLCanvasElement | null = null;
  /** Unscaled source of the floating pixels so repeated resizing does not degrade them. */
  private floatingSource: HTMLCanvasElement | null = null;
  /** True when the floating pixels came from a lift (which already took the undo snapshot). */
  private floatingFromLift = false;
  /** Bumped by structural document changes; in-flight AI results for an older epoch are discarded. */
  private docEpoch = 0;
  private clipboard: HTMLCanvasElement | null = null;
  private gesture: Gesture = { kind: 'none' };
  private curve: CurveState | null = null;
  private polygon: PolygonState | null = null;
  private listeners = new Set<() => void>();
  private jobAborts = new Map<number, AbortController>();
  private jobSeq = 0;
  private saveTimer: number | null = null;
  /** True right after New until the user draws; blank documents are not saved to the library. */
  private untouched = true;
  private saving = false;
  private saveAgain = false;
  /** When true, document changes are not recorded as versions (loading, undo, transient states). */
  private silent = false;
  private pixelCache = new Map<string, ImageData>();
  private versionWrites: Promise<void> = Promise.resolve();
  private headChain: Promise<void> = Promise.resolve();
  /** Versions left by consecutive undos (most recent last); redo walks back along them. */
  private undoTrail: string[] = [];
  state: EditorState;

  constructor() {
    const s = loadSettings();
    this.doc = new PaintDoc(DEFAULT_SIZE.w, DEFAULT_SIZE.h);
    this.preview = makeCanvas(DEFAULT_SIZE.w, DEFAULT_SIZE.h);
    this.pctx = ctx2d(this.preview);
    this.state = {
      tool: 'pencil',
      prevTool: 'pencil',
      brushShape: 'round',
      brushSize: BRUSH_SIZES[1],
      eraserSize: ERASER_SIZES[1],
      airbrushSize: AIRBRUSH_SIZES[1],
      lineWidth: LINE_WIDTHS[0],
      fillMode: 'outline',
      magnifierZoom: MAGNIFIER_ZOOMS[1],
      transparentSelection: false,
      color1: s.color1 ?? '#000000',
      color2: s.color2 ?? '#ffffff',
      customColors: s.customColors ?? [],
      selection: null,
      selectionPath: null,
      lasso: null,
      floating: false,
      hasClipboard: false,
      zoom: 1,
      panX: 0,
      panY: 0,
      gridlines: false,
      docW: DEFAULT_SIZE.w,
      docH: DEFAULT_SIZE.h,
      docVersion: 0,
      cursor: null,
      textBox: null,
      resizing: null,
      pending: null,
      ai: { status: 'idle', message: '' },
      jobs: [],
      apiKey: loadKey(),
      model: s.model ?? 'gpt-image-2.5-flare',
      quality: s.quality ?? 'medium',
      editMode: s.editMode ?? 'selection',
      canUndo: false,
      canRedo: false,
      dialog: 'none',
      fileName: 'Untitled',
      spaceHeld: false,
      shiftHeld: false,
      status: DEFAULT_STATUS,
      theme: s.theme ?? 'system',
      drawings: [],
      currentId: null,
      showLibrary: s.showLibrary ?? true,
      fitRequest: 0,
      guides: { x: null, y: null },
      lastPrompt: '',
      blank: true,
      versions: [],
      headId: null,
      showVersions: s.showVersions ?? true,
    };
    this.doc.subscribe(() => this.onDocChanged());
    void this.initLibrary();
    // localStorage can be missing (private mode, storage pressure); fall back to the IndexedDB copy.
    if (!this.state.apiKey) void loadKeyFromDb().then((k) => { if (k && !this.state.apiKey) this.set({ apiKey: k }); });
  }

  // ---------- store plumbing ----------

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getState = (): EditorState => this.state;

  set(patch: Partial<EditorState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  private onDocChanged(): void {
    if (this.preview.width !== this.doc.width || this.preview.height !== this.doc.height) {
      this.preview.width = this.doc.width;
      this.preview.height = this.doc.height;
    }
    if (!this.silent) this.recordVersion();
    this.set({
      docW: this.doc.width,
      docH: this.doc.height,
      docVersion: this.state.docVersion + 1,
      canUndo: this.hasParent(this.state.headId),
      canRedo: !!this.childOf(this.state.headId),
    });
    this.scheduleSave();
  }

  // ---------- persistent version history ----------

  private hasParent(id: string | null): boolean {
    return !!id && !!this.state.versions.find((v) => v.id === id)?.parentId;
  }
  /** Newest child of a version: the redo target. */
  private childOf(id: string | null): VersionMeta | undefined {
    if (!id) return undefined;
    return this.state.versions.filter((v) => v.parentId === id).sort((a, b) => b.createdAt - a.createdAt)[0];
  }
  private cachePixels(id: string, px: ImageData): void {
    this.pixelCache.delete(id);
    this.pixelCache.set(id, px);
    while (this.pixelCache.size > 24) this.pixelCache.delete(this.pixelCache.keys().next().value as string);
  }
  private enqueueWrite(work: () => Promise<void>): void {
    this.versionWrites = this.versionWrites.then(work).catch((e) => console.warn('[ai-paint] version write failed', e));
  }
  private static thumbOf(px: ImageData): string {
    const c = makeCanvas(px.width, px.height);
    ctx2d(c).putImageData(px, 0, 0);
    return makeThumb(c, 64);
  }
  private static blobOf(px: ImageData): Promise<Blob> {
    const c = makeCanvas(px.width, px.height);
    ctx2d(c).putImageData(px, 0, 0);
    return canvasToBlob(c);
  }

  /** Turn the action that just finished into a new version (child of the current head). */
  private recordVersion(): void {
    const drawingId = this.state.currentId ?? newId();
    const versions = this.state.versions.slice();
    const nextSeq = () => (versions.length ? Math.max(...versions.map((v) => v.seq)) + 1 : 1);
    const now = Date.now();
    let parentId = this.state.headId;
    const pre = this.doc.preState;
    this.doc.preState = null;
    // First action on a drawing: keep what it looked like before as V1 so undo can reach it.
    if (!parentId && pre) {
      const base: VersionMeta = { id: newId(), drawingId, seq: nextSeq(), parentId: null, createdAt: now - 1, w: pre.width, h: pre.height, thumb: Editor.thumbOf(pre) };
      versions.push(base);
      this.cachePixels(base.id, pre);
      const pending = Editor.blobOf(pre);
      this.enqueueWrite(async () => putVersion({ ...base, blob: await pending }));
      parentId = base.id;
    }
    const cur = this.doc.pixels();
    const v: VersionMeta = { id: newId(), drawingId, seq: nextSeq(), parentId, createdAt: now, w: cur.width, h: cur.height, thumb: makeThumb(this.doc.canvas, 64) };
    versions.push(v);
    this.cachePixels(v.id, cur);
    const pending = canvasToBlob(this.doc.canvas);
    this.enqueueWrite(async () => putVersion({ ...v, blob: await pending }));
    this.set({ versions, headId: v.id, currentId: drawingId });
    this.pruneVersions();
  }

  /** Keep at most 200 versions per drawing; drop the oldest that are not on the head's ancestry. */
  private pruneVersions(): void {
    const MAX = 200;
    const versions = this.state.versions;
    if (versions.length <= MAX) return;
    const byId = new Map(versions.map((v) => [v.id, v]));
    const keep = new Set<string>();
    for (let id: string | null = this.state.headId; id; id = byId.get(id)?.parentId ?? null) keep.add(id);
    const removable = versions.filter((v) => !keep.has(v.id)).sort((a, b) => a.seq - b.seq);
    const drop = removable.slice(0, versions.length - MAX);
    if (!drop.length) return;
    const dropIds = new Set(drop.map((v) => v.id));
    const survivor = (id: string | null): string | null => {
      while (id && dropIds.has(id)) id = byId.get(id)?.parentId ?? null;
      return id;
    };
    const next = versions.filter((v) => !dropIds.has(v.id)).map((v) => (v.parentId && dropIds.has(v.parentId) ? { ...v, parentId: survivor(v.parentId) } : v));
    this.set({ versions: next });
    for (const v of drop) {
      this.pixelCache.delete(v.id);
      this.enqueueWrite(() => deleteVersion(v.id));
    }
    for (const v of next) {
      if (v.parentId !== byId.get(v.id)?.parentId) {
        this.enqueueWrite(async () => {
          const rec = await getVersion(v.id);
          if (rec) await putVersion({ ...rec, parentId: v.parentId });
        });
      }
    }
  }

  private async pixelsOf(id: string): Promise<ImageData | null> {
    const hit = this.pixelCache.get(id);
    if (hit) return hit;
    await this.versionWrites; // make sure the blob has landed
    const rec = await getVersion(id);
    if (!rec) return null;
    const img = await loadImage(rec.blob);
    const c = makeCanvas(img.width, img.height);
    const x = ctx2d(c);
    x.drawImage(img, 0, 0);
    const px = x.getImageData(0, 0, c.width, c.height);
    this.cachePixels(id, px);
    return px;
  }

  /** Show a version without creating a new one (undo, redo, clicking in the versions strip). */
  setHead(id: string): Promise<void> {
    this.headChain = this.headChain.then(async () => {
      if (!this.state.versions.some((v) => v.id === id)) return;
      const px = await this.pixelsOf(id);
      if (!px) return;
      this.commitText();
      this.finishPending();
      this.floatingCanvas = null;
      this.floatingSource = null;
      this.floatingFromLift = false;
      this.clearPreview();
      this.bumpEpoch();
      this.silent = true;
      this.doc.restore(px);
      this.silent = false;
      this.set({ headId: id, selection: null, selectionPath: null, floating: false, canUndo: this.hasParent(id), canRedo: !!this.childOf(id) });
      this.undoTrail = [];
      this.untouched = false;
      this.scheduleSave();
    });
    return this.headChain;
  }

  setShowVersions(showVersions: boolean): void {
    this.set({ showVersions });
    this.persistSettings();
  }

  /** Called by drawing gestures: from now on changes are saved. */
  private touch(): void {
    if (this.state.blank) this.set({ blank: false });
    if (this.untouched) {
      this.untouched = false;
      this.scheduleSave();
    }
  }

  private persistSettings(): void {
    const { color1, color2, customColors, model, quality, editMode, theme, showLibrary, showVersions } = this.state;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ color1, color2, customColors, model, quality, editMode, theme, showLibrary, showVersions } satisfies PersistedSettings));
    } catch {
      /* quota */
    }
  }

  private scheduleSave(): void {
    if (this.untouched) return;
    if (this.saveTimer) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.saveCurrent();
    }, 700);
  }

  /** Persist the current document into the library (creating a record on first change). */
  private async saveCurrent(): Promise<void> {
    if (this.saving) {
      this.saveAgain = true;
      return;
    }
    this.saving = true;
    try {
      const id = this.state.currentId ?? newId();
      const existing = this.state.drawings.find((d) => d.id === id);
      const now = Date.now();
      const thumb = makeThumb(this.doc.canvas);
      const blob = await canvasToBlob(this.doc.canvas);
      const rec = { id, createdAt: existing?.createdAt ?? now, updatedAt: now, name: existing?.name, w: this.doc.width, h: this.doc.height, thumb, blob, headId: this.state.headId ?? undefined };
      await putDrawing(rec);
      const { blob: _b, ...meta } = rec;
      const drawings = [meta, ...this.state.drawings.filter((d) => d.id !== id)];
      this.set({ drawings, currentId: id });
      try {
        localStorage.setItem(CURRENT_KEY, id);
      } catch {
        /* ignore */
      }
    } catch (e) {
      console.warn('[ai-paint] save failed', e);
    } finally {
      this.saving = false;
      if (this.saveAgain) {
        this.saveAgain = false;
        void this.saveCurrent();
      }
    }
  }

  /** Load the library, migrate the old single-slot autosave, and reopen the last drawing. */
  private async initLibrary(): Promise<void> {
    let drawings: DrawingMeta[] = [];
    try {
      drawings = await listDrawings();
    } catch {
      /* IndexedDB unavailable: the app still works without persistence */
    }
    this.set({ drawings });
    // One-time migration of the previous localStorage autosave into the library.
    const legacy = localStorage.getItem(DOC_KEY);
    if (legacy) {
      try {
        const img = await loadImage(legacy);
        const c = makeCanvas(img.width, img.height);
        ctx2d(c).drawImage(img, 0, 0);
        const now = Date.now();
        const rec = { id: newId(), createdAt: now, updatedAt: now, w: img.width, h: img.height, thumb: makeThumb(c), blob: await canvasToBlob(c) };
        await putDrawing(rec);
        const { blob: _b, ...meta } = rec;
        drawings = [meta, ...drawings];
        this.set({ drawings });
        localStorage.setItem(CURRENT_KEY, rec.id);
      } catch {
        /* ignore corrupt autosave */
      }
      localStorage.removeItem(DOC_KEY);
    }
    const last = localStorage.getItem(CURRENT_KEY);
    const target = (last && drawings.find((d) => d.id === last)) || drawings[0];
    if (target && this.state.docVersion === 0) await this.openDrawing(target.id);
  }

  /** Open a saved drawing in place of the current document. */
  async openDrawing(id: string): Promise<void> {
    if (id === this.state.currentId) return;
    await this.flushSave();
    const rec = await getDrawing(id);
    if (!rec) return;
    const versions = await listVersions(id).catch(() => [] as VersionMeta[]);
    const headId = (rec.headId && versions.some((v) => v.id === rec.headId) ? rec.headId : versions[versions.length - 1]?.id) ?? null;
    const headPx = headId ? await this.pixelsOf(headId).catch(() => null) : null;
    const img = headPx ? null : await loadImage(rec.blob);
    this.commitText();
    this.finishPending();
    this.bumpEpoch();
    this.floatingCanvas = null;
    this.floatingSource = null;
    this.floatingFromLift = false;
    this.clearPreview();
    this.untouched = true; // loading is not a user change
    this.silent = true;
    this.set({ selection: null, selectionPath: null, lasso: null, floating: false, currentId: id, fileName: rec.name || 'Untitled', versions, headId });
    if (headPx) this.doc.restore(headPx);
    else if (img) this.doc.replace(img, img.width, img.height);
    this.silent = false;
    this.doc.preState = null;
    this.untouched = false;
    this.set({ blank: false, canUndo: this.hasParent(headId), canRedo: !!this.childOf(headId) });
    this.requestFit();
    try {
      localStorage.setItem(CURRENT_KEY, id);
    } catch {
      /* ignore */
    }
  }

  /** Save now if a save is pending (before switching drawings). */
  private async flushSave(): Promise<void> {
    if (this.saveTimer) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
      await this.saveCurrent();
    }
    while (this.saving) await new Promise((r) => setTimeout(r, 30));
  }

  async deleteDrawing(id: string): Promise<void> {
    try {
      await deleteDrawing(id);
      await deleteVersionsOf(id);
    } catch {
      /* ignore */
    }
    const drawings = this.state.drawings.filter((d) => d.id !== id);
    const wasCurrent = this.state.currentId === id;
    this.set({ drawings });
    if (wasCurrent) {
      // The picture on screen no longer has a home; start fresh like Paint would after deleting the file.
      this.newDocument();
    }
  }

  setShowLibrary(showLibrary: boolean): void {
    this.set({ showLibrary });
    this.persistSettings();
  }

  // ---------- settings ----------

  setTool(tool: ToolId): void {
    if (tool === this.state.tool) return;
    const def = TOOLS.find((t) => t.id === tool);
    if (def?.disabled) {
      this.setStatus(def.hint);
      return;
    }
    this.commitText();
    this.finishPending();
    if (tool !== 'select' && tool !== 'freeSelect') this.commitFloating();
    this.set({ tool, prevTool: this.state.tool, status: def?.hint ?? DEFAULT_STATUS });
  }
  setStatus(status: string): void {
    if (status !== this.state.status) this.set({ status });
  }
  setBrush(brushShape: BrushShape, brushSize: number): void {
    this.set({ brushShape, brushSize });
  }
  setEraserSize(eraserSize: number): void {
    this.set({ eraserSize });
  }
  setAirbrushSize(airbrushSize: number): void {
    this.set({ airbrushSize });
  }
  setLineWidth(lineWidth: number): void {
    this.set({ lineWidth });
  }
  setFillMode(fillMode: FillMode): void {
    this.set({ fillMode });
  }
  setMagnifierZoom(magnifierZoom: number): void {
    this.set({ magnifierZoom });
  }
  setTransparentSelection(transparentSelection: boolean): void {
    this.set({ transparentSelection });
  }
  setColor(slot: 1 | 2, color: string): void {
    this.set(slot === 1 ? { color1: color } : { color2: color });
    this.persistSettings();
  }
  /** Palette click: left button sets Color 1, right button sets Color 2. */
  pickPalette(color: string, button: number): void {
    this.setColor(button === 2 ? 2 : 1, color);
  }
  /** Colors you actually paint with join the custom row (Figma-style recents). */
  private rememberColor(color: string): void {
    if (PALETTE.includes(color) || this.state.customColors.includes(color)) return;
    this.set({ customColors: [color, ...this.state.customColors].slice(0, 14) });
    this.persistSettings();
  }

  /** Crop the canvas to the bounding box of everything that is not the background color. */
  trimToContent(): void {
    this.commitText();
    this.finishPending();
    this.commitFloating();
    const [r, g, b] = hexToRgba(this.state.color2);
    const d = this.doc.ctx.getImageData(0, 0, this.doc.width, this.doc.height).data;
    let x0 = this.doc.width, y0 = this.doc.height, x1 = -1, y1 = -1;
    for (let y = 0; y < this.doc.height; y++) {
      for (let x = 0; x < this.doc.width; x++) {
        const i = (y * this.doc.width + x) * 4;
        if (Math.abs(d[i] - r) > 8 || Math.abs(d[i + 1] - g) > 8 || Math.abs(d[i + 2] - b) > 8) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) {
      this.setStatus('Nothing to trim: the canvas is empty.');
      return;
    }
    const pad = 16;
    const rect = clipRect({ x: x0 - pad, y: y0 - pad, w: x1 - x0 + 1 + pad * 2, h: y1 - y0 + 1 + pad * 2 }, this.doc.width, this.doc.height);
    if (!rect) return;
    this.bumpEpoch();
    this.touch();
    this.doc.crop(rect);
    this.setSelection(null);
    this.requestFit();
  }

  /** Run the last prompt again on the current selection. */
  regenerate(): void {
    if (this.state.lastPrompt && this.state.selection) void this.generate(this.state.lastPrompt);
  }

  addCustomColor(color: string, slot: 1 | 2 = 1): void {
    const customColors = [color, ...this.state.customColors.filter((c) => c !== color)].slice(0, 14);
    this.set({ customColors });
    this.setColor(slot, color);
  }
  swapColors(): void {
    this.set({ color1: this.state.color2, color2: this.state.color1 });
    this.persistSettings();
  }
  setGridlines(gridlines: boolean): void {
    this.set({ gridlines });
  }
  setTheme(theme: Theme): void {
    this.set({ theme });
    this.persistSettings();
  }
  /** Replace the selection (and its optional lasso outline) in one update. */
  private setSelection(selection: Rect | null, selectionPath: Pt[] | null = null): void {
    this.set({ selection, selectionPath: selection ? selectionPath : null });
  }
  private bumpEpoch(): void {
    this.docEpoch++;
  }
  private requestFit(): void {
    this.set({ fitRequest: this.state.fitRequest + 1 });
  }
  /** True when a document point is inside the selection (respecting a lasso outline). */
  hitSelection(p: Pt): boolean {
    const s = this.state;
    if (!s.selection || !rectContains(s.selection, p)) return false;
    return !s.selectionPath || s.floating || this.pctx.isPointInPath(pathToPath2D(s.selectionPath), p.x, p.y, 'evenodd');
  }
  setSpaceHeld(spaceHeld: boolean): void {
    if (spaceHeld !== this.state.spaceHeld) this.set({ spaceHeld });
  }
  setShiftHeld(shiftHeld: boolean): void {
    if (shiftHeld !== this.state.shiftHeld) this.set({ shiftHeld });
  }
  openDialog(dialog: DialogId): void {
    this.set({ dialog });
  }

  setApiKey(apiKey: string): void {
    apiKey = apiKey.trim();
    this.set({ apiKey });
    saveKey(apiKey);
  }
  setModel(model: ModelId): void {
    this.set({ model });
    this.persistSettings();
  }
  setQuality(quality: Quality): void {
    this.set({ quality });
    this.persistSettings();
  }
  setEditMode(editMode: EditMode): void {
    this.set({ editMode });
    this.persistSettings();
  }

  // ---------- viewport ----------

  setView(zoom: number, panX: number, panY: number): void {
    this.set({ zoom: clampZoom(zoom), panX, panY });
  }

  /** Zoom keeping the given screen point (relative to the workspace) fixed. */
  zoomAt(zoom: number, sx: number, sy: number): void {
    zoom = clampZoom(zoom);
    const { zoom: z0, panX, panY } = this.state;
    const dx = (sx - panX) / z0;
    const dy = (sy - panY) / z0;
    this.set({ zoom, panX: sx - dx * zoom, panY: sy - dy * zoom });
  }

  /** Center the document in a workspace of the given size at the given zoom. */
  fit(viewW: number, viewH: number, zoom?: number): void {
    const z = zoom ?? clampZoom(Math.min(1, (viewW - 80) / this.doc.width, (viewH - 80) / this.doc.height));
    this.set({ zoom: z, panX: Math.round((viewW - this.doc.width * z) / 2), panY: Math.round((viewH - this.doc.height * z) / 2) });
  }

  // ---------- pointer handling (document coordinates) ----------

  private shapeStyle(button: number): draw.ShapeStyle {
    const s = this.state;
    const fg = button === 2 ? s.color2 : s.color1;
    const bg = button === 2 ? s.color1 : s.color2;
    switch (s.fillMode) {
      case 'outline':
        return { width: s.lineWidth, stroke: fg, fill: null };
      case 'both':
        return { width: s.lineWidth, stroke: fg, fill: bg };
      case 'fill':
        return { width: s.lineWidth, stroke: null, fill: fg };
    }
  }

  pointerDown(p: Pt, button: number, mods: { alt?: boolean } = {}): void {
    const s = this.state;
    // Alt-click with a paint tool samples the color under the cursor (Figma/Photoshop habit).
    if (mods.alt && ['pencil', 'brush', 'airbrush', 'fill', 'line', 'curve', 'rect', 'ellipse', 'roundRect', 'polygon', 'eraser', 'text'].includes(s.tool)) {
      if (rectContains(this.doc.bounds, p)) this.setColor(button === 2 ? 2 : 1, this.doc.pixelAt(p.x, p.y));
      return;
    }
    if (s.tool !== 'magnifier' && s.tool !== 'picker') this.touch();
    if (!['select', 'freeSelect', 'magnifier', 'picker', 'eraser'].includes(s.tool)) this.rememberColor(button === 2 ? s.color2 : s.color1);
    if (s.textBox) {
      this.commitText();
      if (s.tool === 'text') return;
    }
    const color = button === 2 ? s.color2 : s.color1;
    switch (s.tool) {
      case 'pencil':
      case 'eraser':
      case 'brush':
      case 'airbrush': {
        this.commitFloating();
        this.set({ selection: null });
        this.doc.snapshot();
        const size = s.tool === 'pencil' ? 1 : s.tool === 'eraser' ? s.eraserSize : s.tool === 'brush' ? s.brushSize : s.airbrushSize;
        const strokeColor = s.tool === 'eraser' ? (button === 2 ? s.color1 : s.color2) : color;
        this.gesture = { kind: 'stroke', last: p, color: strokeColor, size, tool: s.tool, shape: s.brushShape };
        this.strokeTo(p);
        break;
      }
      case 'line':
      case 'rect':
      case 'ellipse':
      case 'roundRect':
        this.commitFloating();
        this.set({ selection: null });
        this.gesture = { kind: 'shape', start: p, shape: s.tool, style: this.shapeStyle(button) };
        break;
      case 'curve':
        this.commitFloating();
        this.set({ selection: null });
        if (!this.curve) {
          this.curve = { a: p, b: p, style: { width: s.lineWidth, stroke: color, fill: null } };
          this.gesture = { kind: 'curveDrag', phase: 0 };
          this.set({ pending: 'curve' });
        } else if (!this.curve.c1) {
          this.curve.c1 = p;
          this.gesture = { kind: 'curveDrag', phase: 1 };
        } else {
          this.curve.c2 = p;
          this.gesture = { kind: 'curveDrag', phase: 2 };
        }
        this.renderCurve();
        break;
      case 'polygon':
        this.commitFloating();
        this.set({ selection: null });
        if (!this.polygon) {
          this.polygon = { pts: [p], cursor: p, style: this.shapeStyle(button) };
          this.gesture = { kind: 'polygonDrag' };
          this.set({ pending: 'polygon' });
        } else {
          const first = this.polygon.pts[0];
          const last = this.polygon.pts[this.polygon.pts.length - 1];
          const nearStart = Math.hypot(p.x - first.x, p.y - first.y) * this.state.zoom < 8;
          const samePoint = Math.hypot(p.x - last.x, p.y - last.y) * this.state.zoom < 3;
          if (nearStart && this.polygon.pts.length > 2) {
            this.finishPolygon();
          } else if (samePoint) {
            // Second click on the same spot = double-click: finish.
            this.finishPolygon();
          } else {
            this.polygon.pts.push(p);
            this.polygon.cursor = p;
            this.renderPolygon();
          }
        }
        break;
      case 'fill':
        this.commitFloating();
        this.doc.snapshot();
        draw.floodFill(this.doc.ctx, this.doc.width, this.doc.height, p.x, p.y, color);
        this.doc.changed();
        break;
      case 'picker': {
        if (!rectContains(this.doc.bounds, p)) return;
        const hex = this.doc.pixelAt(p.x, p.y);
        this.setColor(button === 2 ? 2 : 1, hex);
        this.set({ tool: s.prevTool === 'picker' ? 'pencil' : s.prevTool });
        break;
      }
      case 'magnifier':
        // Handled by the workspace (needs screen coordinates).
        break;
      case 'text':
        this.commitFloating();
        this.set({
          selection: null,
          textBox: { x: Math.floor(p.x), y: Math.floor(p.y), text: '', size: 24, bold: false, italic: false },
        });
        break;
      case 'select':
      case 'freeSelect':
        if (s.selection && rectContains(s.selection, p) && (!s.selectionPath || s.floating || this.pctx.isPointInPath(pathToPath2D(s.selectionPath), p.x, p.y, 'evenodd'))) {
          if (mods.alt) this.duplicateSelection(0, 0); // Option-drag: move a copy, leave the original
          else this.liftSelection();
          this.gesture = { kind: 'move', grab: p, origin: { x: s.selection.x, y: s.selection.y }, originPath: this.state.selectionPath };
        } else {
          this.commitFloating();
          this.setSelection(null);
          if (s.tool === 'freeSelect') {
            this.gesture = { kind: 'lasso', pts: [p] };
            this.set({ lasso: [p] });
          } else {
            this.gesture = { kind: 'marquee', start: p };
          }
        }
        break;
    }
  }

  pointerMove(p: Pt): void {
    this.set({ cursor: rectContains(this.doc.bounds, p) ? { x: Math.floor(p.x), y: Math.floor(p.y) } : null });
    const g = this.gesture;
    switch (g.kind) {
      case 'stroke':
        this.strokeTo(p);
        break;
      case 'shape':
        this.clearPreview();
        draw.drawShape(this.pctx, g.shape, g.start, this.constrain(g.shape, g.start, p), g.style);
        break;
      case 'curveDrag':
        if (!this.curve) return;
        if (g.phase === 0) this.curve.b = p;
        else if (g.phase === 1) this.curve.c1 = p;
        else this.curve.c2 = p;
        this.renderCurve();
        break;
      case 'polygonDrag':
        if (!this.polygon) return;
        this.polygon.cursor = p;
        this.renderPolygon();
        break;
      case 'marquee': {
        const r = clipRect(normRect(g.start, p), this.doc.width, this.doc.height);
        this.setSelection(r);
        break;
      }
      case 'lasso': {
        const last = g.pts[g.pts.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) >= 1) {
          g.pts.push(p);
          this.set({ lasso: g.pts.slice() });
        }
        break;
      }
      case 'scale':
        this.applyScale(p, g);
        break;
      case 'move': {
        const sel = this.state.selection;
        if (!sel) return;
        let dx = Math.round(p.x - g.grab.x);
        let dy = Math.round(p.y - g.grab.y);
        // Magnetic snapping to canvas edges and center (hold ⌘/Ctrl to disable).
        const guides: { x: number | null; y: number | null } = { x: null, y: null };
        if (!this.snapOff) {
          const tol = 6 / this.state.zoom;
          const nx = g.origin.x + dx;
          const ny = g.origin.y + dy;
          const candX: [number, number][] = [[0, 0], [this.doc.width / 2, sel.w / 2], [this.doc.width, sel.w]];
          const candY: [number, number][] = [[0, 0], [this.doc.height / 2, sel.h / 2], [this.doc.height, sel.h]];
          for (const [line, off] of candX) if (Math.abs(nx + off - line) <= tol) { dx = Math.round(line - off - g.origin.x); guides.x = line; break; }
          for (const [line, off] of candY) if (Math.abs(ny + off - line) <= tol) { dy = Math.round(line - off - g.origin.y); guides.y = line; break; }
        }
        const path = g.originPath ? g.originPath.map((q) => ({ x: q.x + dx, y: q.y + dy })) : null;
        this.set({ selection: { ...sel, x: g.origin.x + dx, y: g.origin.y + dy }, selectionPath: path, guides });
        this.renderFloating();
        break;
      }
      case 'none':
        if (this.polygon && this.state.tool === 'polygon') {
          this.polygon.cursor = p;
          this.renderPolygon();
        }
        break;
    }
  }

  pointerUp(p: Pt): void {
    const g = this.gesture;
    this.gesture = { kind: 'none' };
    switch (g.kind) {
      case 'stroke':
        this.doc.changed();
        break;
      case 'shape': {
        this.clearPreview();
        const end = this.constrain(g.shape, g.start, p);
        if (Math.abs(end.x - g.start.x) + Math.abs(end.y - g.start.y) >= 1) {
          this.doc.snapshot();
          draw.drawShape(this.doc.ctx, g.shape, g.start, end, g.style);
          this.doc.changed();
        }
        break;
      }
      case 'curveDrag':
        if (!this.curve) return;
        if (g.phase === 0 && Math.hypot(this.curve.b.x - this.curve.a.x, this.curve.b.y - this.curve.a.y) < 1) {
          this.curve = null;
          this.clearPreview();
          this.set({ pending: null });
        } else if (g.phase === 2) {
          this.finishCurve();
        }
        break;
      case 'polygonDrag':
        if (!this.polygon) return;
        if (Math.hypot(p.x - this.polygon.pts[0].x, p.y - this.polygon.pts[0].y) >= 1) this.polygon.pts.push(p);
        this.renderPolygon();
        break;
      case 'marquee': {
        const r = clipRect(normRect(g.start, p), this.doc.width, this.doc.height);
        this.setSelection(r && r.w >= 1 && r.h >= 1 ? r : null);
        break;
      }
      case 'lasso': {
        const pts = g.pts;
        this.set({ lasso: null });
        if (pts.length < 3) {
          this.setSelection(null);
          break;
        }
        const simplified = simplifyRing(pts, 0.75);
        const xs = simplified.map((q) => q.x);
        const ys = simplified.map((q) => q.y);
        const bbox = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
        const r = clipRect(bbox, this.doc.width, this.doc.height);
        this.setSelection(r && r.w >= 1 && r.h >= 1 ? r : null, r ? simplified : null);
        break;
      }
      case 'scale':
        this.finishScale();
        break;
      case 'move':
        this.set({ guides: { x: null, y: null } });
        break;
    }
  }

  /** Set while ⌘/Ctrl is held during a drag to bypass snapping. */
  snapOff = false;

  /** Shift: lines snap to 45° steps, boxes become squares/circles. */
  private constrain(shape: ShapeKind, a: Pt, b: Pt): Pt {
    if (!this.state.shiftHeld) return b;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (shape === 'line') {
      const len = Math.hypot(dx, dy);
      const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      return { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
    }
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    return { x: a.x + Math.sign(dx || 1) * side, y: a.y + Math.sign(dy || 1) * side };
  }

  // ---------- selection toolbar operations ----------

  /** Move the selection to an edge or the center of the canvas. */
  alignSelection(h: 'left' | 'center' | 'right' | null, v: 'top' | 'middle' | 'bottom' | null): void {
    if (!this.state.selection) return;
    if (!this.state.floating) this.liftSelection();
    const sel = this.state.selection;
    if (!sel) return;
    let x = sel.x;
    let y = sel.y;
    if (h === 'left') x = 0;
    else if (h === 'center') x = Math.round((this.doc.width - sel.w) / 2);
    else if (h === 'right') x = this.doc.width - sel.w;
    if (v === 'top') y = 0;
    else if (v === 'middle') y = Math.round((this.doc.height - sel.h) / 2);
    else if (v === 'bottom') y = this.doc.height - sel.h;
    this.nudgeSelection(x - sel.x, y - sel.y);
  }

  /** Scale the floating selection to fit inside the canvas and center it. */
  fitSelectionToCanvas(): void {
    if (!this.state.selection) return;
    if (!this.state.floating) this.liftSelection();
    const sel = this.state.selection;
    if (!sel || !this.floatingSource) return;
    const k = Math.min(this.doc.width / sel.w, this.doc.height / sel.h);
    const w = Math.max(1, Math.round(sel.w * k));
    const h = Math.max(1, Math.round(sel.h * k));
    const rect = { x: Math.round((this.doc.width - w) / 2), y: Math.round((this.doc.height - h) / 2), w, h };
    const path = this.state.selectionPath?.map((q) => ({ x: rect.x + (q.x - sel.x) * (w / sel.w), y: rect.y + (q.y - sel.y) * (h / sel.h) })) ?? null;
    this.set({ selection: rect, selectionPath: path });
    this.finishScale();
  }

  /** Mirror the selected pixels in place. */
  flipSelection(axis: 'h' | 'v'): void {
    if (!this.state.selection) return;
    if (!this.state.floating) this.liftSelection();
    const sel = this.state.selection;
    if (!sel || !this.floatingSource) return;
    const flip = (c: HTMLCanvasElement) => {
      const out = makeCanvas(c.width, c.height);
      const x = ctx2d(out);
      if (axis === 'h') {
        x.translate(c.width, 0);
        x.scale(-1, 1);
      } else {
        x.translate(0, c.height);
        x.scale(1, -1);
      }
      x.drawImage(c, 0, 0);
      return out;
    };
    this.floatingSource = flip(this.floatingSource);
    this.floatingCanvas = this.floatingCanvas ? flip(this.floatingCanvas) : null;
    const path = this.state.selectionPath?.map((q) => (axis === 'h' ? { x: 2 * sel.x + sel.w - q.x, y: q.y } : { x: q.x, y: 2 * sel.y + sel.h - q.y })) ?? null;
    this.set({ selectionPath: path });
    this.renderFloating();
  }

  /** Rotate the selected pixels by a quarter turn around their center. */
  rotateSelection(deg: 90 | 270): void {
    if (!this.state.selection) return;
    if (!this.state.floating) this.liftSelection();
    const sel = this.state.selection;
    if (!sel || !this.floatingSource) return;
    const rot = (c: HTMLCanvasElement) => {
      const out = makeCanvas(c.height, c.width);
      const x = ctx2d(out);
      x.translate(out.width / 2, out.height / 2);
      x.rotate((deg * Math.PI) / 180);
      x.drawImage(c, -c.width / 2, -c.height / 2);
      return out;
    };
    this.floatingSource = rot(this.floatingSource);
    this.floatingCanvas = this.floatingCanvas ? rot(this.floatingCanvas) : null;
    const cx = sel.x + sel.w / 2;
    const cy = sel.y + sel.h / 2;
    const rect = { x: Math.round(cx - sel.h / 2), y: Math.round(cy - sel.w / 2), w: sel.h, h: sel.w };
    const rad = (deg * Math.PI) / 180;
    const path = this.state.selectionPath?.map((q) => {
      const dx = q.x - cx;
      const dy = q.y - cy;
      return { x: cx + dx * Math.cos(rad) - dy * Math.sin(rad), y: cy + dx * Math.sin(rad) + dy * Math.cos(rad) };
    }) ?? null;
    this.set({ selection: rect, selectionPath: path });
    this.renderFloating();
  }

  /** Place the current selection and start moving a copy of it, offset by (dx, dy). */
  duplicateSelection(dx = 16, dy = 16): void {
    const s = this.selectionPixels();
    if (!s) return;
    const copy = makeCanvas(s.canvas.width, s.canvas.height);
    ctx2d(copy).drawImage(s.canvas, 0, 0);
    const path = this.state.selectionPath?.map((q) => ({ x: q.x + dx, y: q.y + dy })) ?? null;
    this.commitFloating();
    this.touch();
    this.floatingCanvas = copy;
    this.floatingSource = copy;
    this.floatingFromLift = false;
    this.set({ tool: this.state.tool === 'freeSelect' ? 'freeSelect' : 'select', selection: { x: s.rect.x + dx, y: s.rect.y + dy, w: s.rect.w, h: s.rect.h }, selectionPath: path, floating: true });
    this.renderFloating();
  }

  doubleClick(): void {
    if (this.polygon) this.finishPolygon();
  }

  pointerLeave(): void {
    this.set({ cursor: null });
  }

  private clearPreview(): void {
    this.pctx.clearRect(0, 0, this.preview.width, this.preview.height);
  }

  private strokeTo(p: Pt): void {
    const g = this.gesture;
    if (g.kind !== 'stroke') return;
    const ctx = this.doc.ctx;
    switch (g.tool) {
      case 'pencil':
      case 'eraser':
        draw.pencilLine(ctx, g.last, p, g.size, g.color);
        break;
      case 'brush':
        if (g.shape === 'round') draw.brushSegment(ctx, g.last, p, g.size, g.color);
        else if (g.shape === 'square') draw.squareBrushSegment(ctx, g.last, p, g.size, g.color);
        else draw.calligraphySegment(ctx, g.last, p, g.size, g.color);
        break;
      case 'airbrush':
        draw.airbrushDab(ctx, p, g.size / 2.5, g.color);
        break;
    }
    g.last = p;
  }

  private renderCurve(): void {
    if (!this.curve) return;
    this.clearPreview();
    const c = this.curve;
    draw.paintPath(this.pctx, draw.curvePath(c.a, c.b, c.c1, c.c2), c.style);
  }

  private finishCurve(): void {
    const c = this.curve;
    this.curve = null;
    this.clearPreview();
    this.set({ pending: null });
    if (!c) return;
    this.doc.snapshot();
    draw.paintPath(this.doc.ctx, draw.curvePath(c.a, c.b, c.c1, c.c2), c.style);
    this.doc.changed();
  }

  private renderPolygon(): void {
    if (!this.polygon) return;
    this.clearPreview();
    const pg = this.polygon;
    const pts = this.gesture.kind === 'polygonDrag' ? [pg.pts[0], pg.cursor] : [...pg.pts, pg.cursor];
    draw.paintPath(this.pctx, draw.polygonPath(pts, false), { width: pg.style.width, stroke: pg.style.stroke ?? pg.style.fill, fill: null });
  }

  private finishPolygon(): void {
    const pg = this.polygon;
    this.polygon = null;
    this.clearPreview();
    this.set({ pending: null });
    if (!pg || pg.pts.length < 2) return;
    this.doc.snapshot();
    draw.paintPath(this.doc.ctx, draw.polygonPath(pg.pts, true), pg.style);
    this.doc.changed();
  }

  /** Commit any multi-step tool that is mid-way (called on tool change, undo, etc.). */
  finishPending(): void {
    if (this.curve) this.finishCurve();
    if (this.polygon) this.finishPolygon();
  }

  // ---------- selection & clipboard ----------

  /** Copy the selected pixels into the floating layer and clear them from the document. */
  private liftSelection(): void {
    const sel = this.state.selection;
    if (!sel || this.state.floating) return;
    const path = this.state.selectionPath;
    this.doc.snapshot();
    const region = this.doc.copyRegion(sel);
    if (path) maskToPath(region, path, sel);
    if (this.state.transparentSelection) makeColorTransparent(region, this.state.color2);
    this.floatingCanvas = region;
    this.floatingSource = region;
    this.floatingFromLift = true;
    this.fillSelectionArea(sel, path, this.state.color2);
    this.silent = true; // the hole is transient; the commit records the version
    this.doc.changed();
    this.silent = false;
    this.set({ floating: true });
    this.renderFloating();
  }

  /** Fill the selected area (rectangle or lasso outline) with a color. */
  private fillSelectionArea(sel: Rect, path: Pt[] | null, color: string): void {
    if (path) {
      this.doc.ctx.fillStyle = color;
      this.doc.ctx.fill(pathToPath2D(path), 'evenodd');
    } else {
      this.doc.fillRegion(sel, color);
    }
  }

  private renderFloating(): void {
    this.clearPreview();
    const sel = this.state.selection;
    if (this.floatingCanvas && sel) this.pctx.drawImage(this.floatingCanvas, sel.x, sel.y);
  }

  /** Stamp the floating pixels back onto the document. Keeps the selection outline. */
  commitFloating(): void {
    const sel = this.state.selection;
    if (this.floatingCanvas && sel) {
      // A lift already snapshotted the pre-move state, so lift + move + commit is one undo step.
      if (!this.floatingFromLift) this.doc.snapshot();
      this.doc.ctx.drawImage(this.floatingCanvas, sel.x, sel.y);
      this.doc.changed();
    }
    this.floatingCanvas = null;
    this.floatingSource = null;
    this.floatingFromLift = false;
    this.clearPreview();
    if (this.state.floating) this.set({ floating: false });
  }

  /** Begin scaling the floating selection from one of its corner handles. */
  startScale(corner: Corner, keepAspect: boolean): void {
    const sel = this.state.selection;
    if (!sel) return;
    if (!this.state.floating) this.liftSelection();
    this.gesture = { kind: 'scale', corner, start: { ...sel }, startPath: this.state.selectionPath, keepAspect };
  }

  private applyScale(p: Pt, g: Extract<Gesture, { kind: 'scale' }>): void {
    const st = g.start;
    // Anchor is the corner opposite to the one being dragged.
    const ax = g.corner.includes('w') ? st.x + st.w : st.x;
    const ay = g.corner.includes('n') ? st.y + st.h : st.y;
    let w = Math.max(1, Math.abs(p.x - ax));
    let h = Math.max(1, Math.abs(p.y - ay));
    if (g.keepAspect) {
      const k = Math.max(w / st.w, h / st.h);
      w = Math.max(1, st.w * k);
      h = Math.max(1, st.h * k);
    }
    const x = g.corner.includes('w') ? ax - w : ax;
    const y = g.corner.includes('n') ? ay - h : ay;
    const rect = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
    const sx = rect.w / st.w;
    const sy = rect.h / st.h;
    const path = g.startPath ? g.startPath.map((q) => ({ x: rect.x + (q.x - st.x) * sx, y: rect.y + (q.y - st.y) * sy })) : null;
    this.set({ selection: rect, selectionPath: path });
    // Live preview from the unscaled source.
    this.clearPreview();
    if (this.floatingSource) {
      this.pctx.imageSmoothingEnabled = true;
      this.pctx.imageSmoothingQuality = 'high';
      this.pctx.drawImage(this.floatingSource, rect.x, rect.y, rect.w, rect.h);
    }
  }

  private finishScale(): void {
    const sel = this.state.selection;
    if (!sel || !this.floatingSource) return;
    const scaled = makeCanvas(sel.w, sel.h);
    const c = ctx2d(scaled);
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(this.floatingSource, 0, 0, sel.w, sel.h);
    this.floatingCanvas = scaled;
    this.renderFloating();
  }

  /** Move the selection by whole pixels (arrow keys). Lifts it first if needed. */
  nudgeSelection(dx: number, dy: number): void {
    const sel = this.state.selection;
    if (!sel) return;
    if (!this.state.floating) this.liftSelection();
    const cur = this.state.selection;
    if (!cur) return;
    const path = this.state.selectionPath?.map((q) => ({ x: q.x + dx, y: q.y + dy })) ?? null;
    this.set({ selection: { ...cur, x: cur.x + dx, y: cur.y + dy }, selectionPath: path });
    this.renderFloating();
  }

  deselect(): void {
    this.commitFloating();
    this.setSelection(null);
  }

  selectAll(): void {
    this.commitText();
    this.finishPending();
    this.commitFloating();
    this.set({ tool: 'select', selection: this.doc.bounds, selectionPath: null });
  }

  private selectionPixels(): { rect: Rect; canvas: HTMLCanvasElement } | null {
    const sel = this.state.selection;
    if (!sel) return null;
    if (this.floatingCanvas) return { rect: sel, canvas: this.floatingCanvas };
    const r = clipRect(sel, this.doc.width, this.doc.height);
    if (!r) return null;
    const canvas = this.doc.copyRegion(r);
    if (this.state.selectionPath) maskToPath(canvas, this.state.selectionPath, r);
    return { rect: r, canvas };
  }

  copy(): void {
    const s = this.selectionPixels();
    if (!s) return;
    this.clipboard = s.canvas;
    this.set({ hasClipboard: true });
    void this.writeSystemClipboard(s.canvas);
  }

  cut(): void {
    const s = this.selectionPixels();
    if (!s) return;
    this.clipboard = s.canvas;
    if (this.floatingCanvas) {
      this.floatingCanvas = null;
      this.floatingSource = null;
      this.floatingFromLift = false;
      this.clearPreview();
      this.set({ floating: false, selection: null, selectionPath: null, hasClipboard: true });
    } else {
      this.doc.snapshot();
      this.fillSelectionArea(s.rect, this.state.selectionPath, this.state.color2);
      this.doc.changed();
      this.set({ selection: null, selectionPath: null, hasClipboard: true });
    }
    void this.writeSystemClipboard(s.canvas);
  }

  private async writeSystemClipboard(c: HTMLCanvasElement): Promise<void> {
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return;
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
      if (blob) await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    } catch {
      /* clipboard permission denied; internal clipboard still works */
    }
  }

  /** Paste the internal clipboard as a floating selection centered on `at` (document coords). */
  paste(at?: Pt): void {
    if (!this.clipboard) return;
    this.pasteCanvas(this.clipboard, at);
  }

  /**
   * Paste pixels as a floating, movable, resizable selection. Images larger than the canvas are
   * scaled down to fit; the result is centered on `at` (or the canvas) and kept inside the canvas.
   */
  pasteCanvas(src: HTMLCanvasElement, at?: Pt): void {
    this.touch();
    this.commitText();
    this.finishPending();
    this.commitFloating();
    const k = Math.min(1, this.doc.width / src.width, this.doc.height / src.height);
    const w = Math.max(1, Math.round(src.width * k));
    const h = Math.max(1, Math.round(src.height * k));
    const source = makeCanvas(src.width, src.height);
    ctx2d(source).drawImage(src, 0, 0);
    const copy = makeCanvas(w, h);
    const cc = ctx2d(copy);
    cc.imageSmoothingEnabled = true;
    cc.imageSmoothingQuality = 'high';
    cc.drawImage(source, 0, 0, w, h);
    const cx = at?.x ?? this.doc.width / 2;
    const cy = at?.y ?? this.doc.height / 2;
    const x = Math.max(0, Math.min(Math.round(cx - w / 2), this.doc.width - w));
    const y = Math.max(0, Math.min(Math.round(cy - h / 2), this.doc.height - h));
    this.floatingCanvas = copy;
    this.floatingSource = source;
    this.floatingFromLift = false;
    this.set({ tool: 'select', selection: { x, y, w, h }, selectionPath: null, floating: true, status: 'Drag to move. Drag a corner to resize (Shift keeps proportions). Arrow keys nudge. Click outside or press Enter to place.' });
    this.renderFloating();
  }

  async pasteImageFile(file: Blob, at?: Pt): Promise<void> {
    const img = await loadImage(file);
    const c = makeCanvas(img.width, img.height);
    ctx2d(c).drawImage(img, 0, 0);
    this.pasteCanvas(c, at);
  }

  /**
   * Handle a browser paste event. Looks at clipboard items, files, and images embedded in pasted
   * HTML (copied from a web page). Returns true when something was pasted.
   */
  async pasteFromEvent(e: ClipboardEvent, at?: Pt): Promise<boolean> {
    const data = e.clipboardData;
    if (!data) return false;
    for (const item of Array.from(data.items ?? [])) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) {
          await this.pasteImageFile(f, at);
          return true;
        }
      }
    }
    for (const f of Array.from(data.files ?? [])) {
      if (f.type.startsWith('image/')) {
        await this.pasteImageFile(f, at);
        return true;
      }
    }
    const html = data.getData('text/html');
    const src = html && /<img[^>]+src=["']([^"']+)["']/i.exec(html)?.[1];
    if (src && (await this.pasteImageUrl(src, at))) return true;
    const text = data.getData('text/plain').trim();
    if (/^(data:image\/|https?:\/\/\S+\.(png|jpe?g|gif|webp|bmp)(\?\S*)?$)/i.test(text) && (await this.pasteImageUrl(text, at))) return true;
    return false;
  }

  /** Paste an image by URL (data: URLs always work; remote URLs need CORS). */
  async pasteImageUrl(url: string, at?: Pt): Promise<boolean> {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      if (!blob.type.startsWith('image/')) return false;
      await this.pasteImageFile(blob, at);
      return true;
    } catch {
      return false;
    }
  }

  /** Edit → Paste / fallback: try the async Clipboard API (needs a user gesture), then the internal clipboard. */
  async pasteFromSystem(at?: Pt): Promise<boolean> {
    try {
      if (navigator.clipboard?.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const type = item.types.find((t) => t.startsWith('image/'));
          if (type) {
            await this.pasteImageFile(await item.getType(type), at);
            return true;
          }
        }
      }
    } catch {
      /* permission denied or no image: fall through */
    }
    if (this.clipboard) {
      this.paste(at);
      return true;
    }
    this.setStatus('Nothing to paste: copy an image (or a selection here) first.');
    return false;
  }

  deleteSelection(): void {
    const sel = this.state.selection;
    if (!sel) return;
    if (this.floatingCanvas) {
      this.floatingCanvas = null;
      this.floatingSource = null;
      this.floatingFromLift = false;
      this.clearPreview();
      this.set({ floating: false, selection: null, selectionPath: null });
      return;
    }
    const r = clipRect(sel, this.doc.width, this.doc.height);
    if (!r) return;
    this.doc.snapshot();
    this.fillSelectionArea(r, this.state.selectionPath, this.state.color2);
    this.doc.changed();
    this.setSelection(null);
  }

  crop(): void {
    this.commitFloating();
    const sel = this.state.selection && clipRect(this.state.selection, this.doc.width, this.doc.height);
    if (!sel) return;
    this.bumpEpoch();
    this.doc.crop(sel);
    this.setSelection(null);
  }

  // ---------- image operations ----------

  private beforeImageOp(): void {
    this.commitText();
    this.finishPending();
    this.deselect();
    this.bumpEpoch();
    this.touch();
  }
  rotate(deg: 90 | 180 | 270): void {
    this.beforeImageOp();
    this.doc.rotate(deg);
  }
  flip(axis: 'h' | 'v'): void {
    this.beforeImageOp();
    this.doc.flip(axis);
  }
  invertColors(): void {
    this.beforeImageOp();
    this.doc.snapshot();
    const img = this.doc.ctx.getImageData(0, 0, this.doc.width, this.doc.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = 255 - d[i];
      d[i + 1] = 255 - d[i + 1];
      d[i + 2] = 255 - d[i + 2];
    }
    this.doc.ctx.putImageData(img, 0, 0);
    this.doc.changed();
  }
  clearImage(): void {
    this.beforeImageOp();
    this.doc.clear(this.state.color2);
  }
  /** Resize handles / Attributes: change the canvas size without scaling the picture. */
  resizeCanvas(w: number, h: number): void {
    this.beforeImageOp();
    this.doc.resize(Math.min(MAX_DIM, w), Math.min(MAX_DIM, h), this.state.color2);
  }
  /** Stretch dialog: scale the picture. */
  scaleImage(w: number, h: number): void {
    this.beforeImageOp();
    this.doc.scaleTo(w, h);
  }
  setResizing(resizing: { w: number; h: number } | null): void {
    this.set({ resizing });
  }

  newDocument(w = DEFAULT_SIZE.w, h = DEFAULT_SIZE.h): void {
    this.commitText();
    this.finishPending();
    this.bumpEpoch();
    this.floatingCanvas = null;
    this.floatingFromLift = false;
    this.clearPreview();
    this.untouched = true;
    this.set({ selection: null, selectionPath: null, lasso: null, floating: false, fileName: 'Untitled', currentId: null, versions: [], headId: null, canUndo: false, canRedo: false });
    this.silent = true;
    this.doc.reset(w, h, '#ffffff');
    this.silent = false;
    this.doc.preState = null;
    this.untouched = true; // the reset itself is not a user change; the first stroke creates the record
    this.set({ blank: true });
    this.requestFit();
    try {
      localStorage.removeItem(CURRENT_KEY);
    } catch {
      /* ignore */
    }
  }

  async openFile(file: File): Promise<void> {
    const img = await loadImage(file);
    this.commitText();
    this.finishPending();
    this.bumpEpoch();
    this.floatingCanvas = null;
    this.floatingFromLift = false;
    this.clearPreview();
    this.untouched = true;
    this.set({ selection: null, selectionPath: null, lasso: null, floating: false, fileName: file.name.replace(/\.[^.]+$/, '') || 'Untitled', currentId: null });
    this.set({ versions: [], headId: null, canUndo: false, canRedo: false, blank: false });
    this.silent = true;
    this.doc.replace(img, img.width, img.height);
    this.silent = false;
    this.doc.preState = null;
    this.untouched = false; // an opened file is worth keeping
    this.scheduleSave();
    this.requestFit();
  }

  /** Rename the current or a given drawing (shown in the sidebar and used as the download name). */
  async renameDrawing(id: string, name: string): Promise<void> {
    name = name.trim();
    const rec = await getDrawing(id);
    if (rec) {
      rec.name = name || undefined;
      await putDrawing(rec);
    }
    this.set({
      drawings: this.state.drawings.map((d) => (d.id === id ? { ...d, name: name || undefined } : d)),
      fileName: id === this.state.currentId ? name || 'Untitled' : this.state.fileName,
    });
  }

  /** Copy the selection (or the whole canvas) to the system clipboard as PNG. Lasso keeps transparency. */
  async copyAsPng(): Promise<boolean> {
    const s = this.selectionPixels();
    const canvas = s ? s.canvas : this.doc.canvas;
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('unsupported');
      const blob = await canvasToBlob(canvas);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      this.setStatus(s ? 'Selection copied as PNG.' : 'Canvas copied as PNG.');
      return true;
    } catch {
      this.setStatus('Clipboard blocked by the browser; use File → Export instead.');
      return false;
    }
  }

  /** Download the canvas or the selection in the given format. Scale 2 exports at double resolution. */
  exportImage(opts: { format: 'png' | 'jpeg' | 'webp'; scale?: number; selectionOnly?: boolean; quality?: number }): void {
    this.commitText();
    this.finishPending();
    const s = opts.selectionOnly ? this.selectionPixels() : null;
    const src = s ? s.canvas : this.doc.canvas;
    const k = opts.scale ?? 1;
    const out = makeCanvas(src.width * k, src.height * k);
    const x = ctx2d(out);
    if (opts.format !== 'png') {
      x.fillStyle = this.state.color2;
      x.fillRect(0, 0, out.width, out.height);
    }
    x.imageSmoothingEnabled = k !== 1;
    x.imageSmoothingQuality = 'high';
    x.drawImage(src, 0, 0, out.width, out.height);
    const mime = `image/${opts.format}`;
    const a = document.createElement('a');
    a.href = out.toDataURL(mime, opts.quality ?? 0.92);
    a.download = `${this.state.fileName}${s ? '-selection' : ''}${k !== 1 ? `@${k}x` : ''}.${opts.format === 'jpeg' ? 'jpg' : opts.format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  /** Numeric transform: set the selection rectangle (moves/scales the floating pixels). */
  setSelectionRect(next: Partial<Rect>): void {
    const sel = this.state.selection;
    if (!sel) return;
    if (!this.state.floating) this.liftSelection();
    const cur = this.state.selection;
    if (!cur) return;
    const rect = { x: Math.round(next.x ?? cur.x), y: Math.round(next.y ?? cur.y), w: Math.max(1, Math.round(next.w ?? cur.w)), h: Math.max(1, Math.round(next.h ?? cur.h)) };
    const sx = rect.w / cur.w;
    const sy = rect.h / cur.h;
    const path = this.state.selectionPath?.map((q) => ({ x: rect.x + (q.x - cur.x) * sx, y: rect.y + (q.y - cur.y) * sy })) ?? null;
    this.set({ selection: rect, selectionPath: path });
    if (rect.w !== cur.w || rect.h !== cur.h) this.finishScale();
    else this.renderFloating();
  }

  /** Synchronous on purpose: an awaited toBlob can lose the user activation some browsers require for downloads. */
  save(): void {
    this.commitText();
    this.finishPending();
    this.commitFloating();
    const a = document.createElement('a');
    a.href = this.doc.toDataURL();
    a.download = `${this.state.fileName}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  undo(): void {
    this.commitText();
    if (this.curve || this.polygon) {
      // Undo while a curve/polygon is in progress cancels it.
      this.curve = null;
      this.polygon = null;
      this.clearPreview();
      this.set({ pending: null });
      return;
    }
    if (this.floatingCanvas) {
      // A lifted/pasted layer that was never placed: dropping it is the whole undo (head is untouched).
      const fromLift = this.floatingFromLift;
      this.floatingCanvas = null;
      this.floatingSource = null;
      this.floatingFromLift = false;
      this.clearPreview();
      this.set({ floating: false, selection: null, selectionPath: null });
      if (fromLift && this.state.headId) void this.setHead(this.state.headId); // put the lifted pixels back
      else if (fromLift && this.doc.preState) {
        this.silent = true;
        this.doc.restore(this.doc.preState);
        this.silent = false;
      }
      return;
    }
    const head = this.state.versions.find((v) => v.id === this.state.headId);
    if (head?.parentId) {
      const from = head.id;
      const trail = [...this.undoTrail, from];
      void this.setHead(head.parentId).then(() => {
        this.undoTrail = trail;
      });
    }
  }
  redo(): void {
    this.commitText();
    this.finishPending();
    this.commitFloating();
    const trail = this.undoTrail.slice();
    const rememberedId = trail.pop();
    const remembered = rememberedId ? this.state.versions.find((v) => v.id === rememberedId) : undefined;
    const target = remembered && remembered.parentId === this.state.headId ? remembered : this.childOf(this.state.headId);
    if (target) {
      void this.setHead(target.id).then(() => {
        this.undoTrail = remembered && target.id === remembered.id ? trail : [];
      });
    }
  }

  // ---------- text ----------

  updateText(patch: Partial<TextBox>): void {
    if (!this.state.textBox) return;
    this.set({ textBox: { ...this.state.textBox, ...patch } });
  }
  commitText(): void {
    const tb = this.state.textBox;
    if (!tb) return;
    if (tb.text.trim()) {
      this.touch();
      this.doc.snapshot();
      draw.drawText(this.doc.ctx, tb.text, tb, { size: tb.size, color: this.state.color1, font: draw.TEXT_FONT, bold: tb.bold, italic: tb.italic });
      this.doc.changed();
    }
    this.set({ textBox: null });
  }
  cancelText(): void {
    if (this.state.textBox) this.set({ textBox: null });
  }

  // ---------- AI ----------

  private updateJob(id: number, patch: Partial<AiJob>): void {
    this.set({ jobs: this.state.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) });
  }
  private removeJob(id: number): void {
    this.set({ jobs: this.state.jobs.filter((j) => j.id !== id) });
  }

  /** Start a repaint job for the current selection. The job keeps its own outline and label on screen. */
  async generate(prompt: string): Promise<void> {
    const s = this.state;
    if (!prompt.trim()) return;
    if (!s.apiKey) {
      this.set({ dialog: 'key' });
      return;
    }
    this.commitFloating();
    const sel = s.selection && clipRect(s.selection, this.doc.width, this.doc.height);
    if (!sel) {
      this.set({ ai: { status: 'error', message: 'Select an area first.' } });
      return;
    }
    const path = this.state.selectionPath;
    const id = ++this.jobSeq;
    const abort = new AbortController();
    this.jobAborts.set(id, abort);
    const epoch = this.docEpoch;
    // Remember what the area looked like; if it is painted over meanwhile, the result is stale.
    const before = this.doc.ctx.getImageData(sel.x, sel.y, sel.w, sel.h).data;
    const job: AiJob = { id, rect: sel, path, prompt: prompt.trim(), status: 'running', message: 'Starting…' };
    this.set({ lastPrompt: prompt.trim() });
    // The job overlay now shows this area; free the live selection for the next edit.
    this.set({ jobs: [...this.state.jobs, job], selection: null, selectionPath: null, ai: { status: 'running', message: 'Generating…' } });
    try {
      const result = await inpaint({
        source: this.doc.canvas,
        selection: sel,
        path,
        prompt,
        apiKey: s.apiKey,
        model: this.state.model,
        quality: this.state.quality,
        mode: this.state.editMode,
        background: this.state.color2,
        signal: abort.signal,
        onStatus: (message) => {
          if (!abort.signal.aborted) this.updateJob(id, { message });
        },
      });
      if (abort.signal.aborted) return;
      const now = this.doc.ctx.getImageData(sel.x, sel.y, sel.w, sel.h).data;
      if (epoch !== this.docEpoch || !sameBytes(before, now)) {
        this.updateJob(id, { status: 'error', message: 'Discarded: the area changed while generating.' });
        this.set({ ai: { status: 'error', message: 'Discarded: the area changed while generating.' } });
        window.setTimeout(() => this.removeJob(id), 8000);
        return;
      }
      this.touch();
      snapBackground(result.patch, this.doc.copyRegion(sel), this.state.color2);
      if (path) maskToPath(result.patch, path, sel);
      this.doc.snapshot();
      this.doc.ctx.drawImage(result.patch, sel.x, sel.y);
      this.doc.changed();
      this.removeJob(id);
      this.set({ ai: { status: 'done', message: `Done in ${(result.elapsedMs / 1000).toFixed(1)}s`, lastMs: result.elapsedMs } });
    } catch (e) {
      if (abort.signal.aborted) {
        this.removeJob(id);
        return;
      }
      const message = e instanceof Error ? e.message : String(e);
      this.updateJob(id, { status: 'error', message });
      this.set({ ai: { status: 'error', message } });
    } finally {
      this.jobAborts.delete(id);
      if (this.jobAborts.size === 0 && this.state.ai.status === 'running') this.set({ ai: { status: 'idle', message: '' } });
    }
  }

  cancelJob(id: number): void {
    this.jobAborts.get(id)?.abort();
    this.jobAborts.delete(id);
    this.removeJob(id);
    if (this.jobAborts.size === 0) this.set({ ai: { status: 'idle', message: '' } });
  }

  /** Cancel every running job (Escape). */
  cancelGenerate(): void {
    for (const id of Array.from(this.jobAborts.keys())) this.cancelJob(id);
  }

  dismissJob(id: number): void {
    if (this.jobAborts.has(id)) this.cancelJob(id);
    else this.removeJob(id);
  }

  clearAiStatus(): void {
    if (this.state.ai.status !== 'running') this.set({ ai: { status: 'idle', message: '' } });
  }
}

/**
 * The model tends to return the flat background very slightly off-white. Where the original
 * pixel was exactly the background color and the result is within a small tolerance of it,
 * restore the exact background so the repainted rectangle has no visible tint or seam.
 * Real shading (larger differences) is kept.
 */
function snapBackground(patch: HTMLCanvasElement, original: HTMLCanvasElement, bgHex: string, tol = 10): void {
  const pctx = ctx2d(patch);
  const a = pctx.getImageData(0, 0, patch.width, patch.height);
  const b = ctx2d(original).getImageData(0, 0, original.width, original.height);
  const [r, g, bl] = hexToRgba(bgHex);
  const pa = a.data;
  const pb = b.data;
  for (let i = 0; i < pa.length; i += 4) {
    if (pb[i] !== r || pb[i + 1] !== g || pb[i + 2] !== bl) continue;
    if (Math.abs(pa[i] - r) <= tol && Math.abs(pa[i + 1] - g) <= tol && Math.abs(pa[i + 2] - bl) <= tol) {
      pa[i] = r;
      pa[i + 1] = g;
      pa[i + 2] = bl;
      pa[i + 3] = 255;
    }
  }
  pctx.putImageData(a, 0, 0);
}

/** Make every pixel equal to `hex` fully transparent (Paint's "transparent selection"). */
function makeColorTransparent(c: HTMLCanvasElement, hex: string): void {
  const ctx = ctx2d(c);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const [r, g, b] = hexToRgba(hex);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] === r && d[i + 1] === g && d[i + 2] === b) d[i + 3] = 0;
  }
  ctx.putImageData(img, 0, 0);
}

/** Keep only the pixels inside `path` (document coordinates) of a canvas positioned at `origin`. */
function maskToPath(c: HTMLCanvasElement, path: Pt[], origin: Rect): void {
  const ctx = ctx2d(c);
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.translate(-origin.x, -origin.y);
  ctx.fill(pathToPath2D(path), 'evenodd');
  ctx.restore();
}

/** Closed-ring simplification: split the ring at the point farthest from the start, simplify both halves. */
function simplifyRing(pts: Pt[], tolerance: number): Pt[] {
  // Drop consecutive duplicates and an explicit closing point.
  const clean: Pt[] = [];
  for (const q of pts) {
    const last = clean[clean.length - 1];
    if (!last || Math.hypot(q.x - last.x, q.y - last.y) >= 0.5) clean.push(q);
  }
  if (clean.length > 2 && Math.hypot(clean[0].x - clean[clean.length - 1].x, clean[0].y - clean[clean.length - 1].y) < 0.5) clean.pop();
  if (clean.length < 3) return clean;
  let far = 1;
  let best = -1;
  for (let i = 1; i < clean.length; i++) {
    const d = Math.hypot(clean[i].x - clean[0].x, clean[i].y - clean[0].y);
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const a = simplifyPath(clean.slice(0, far + 1), tolerance);
  const b = simplifyPath([...clean.slice(far), clean[0]], tolerance);
  const ring = [...a, ...b.slice(1, -1)];
  return ring.length >= 3 ? ring : clean;
}

/** Ramer–Douglas–Peucker simplification of an open polyline. */
function simplifyPath(pts: Pt[], tolerance: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop() as [number, number];
    const A = pts[a];
    const B = pts[b];
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const len = Math.hypot(dx, dy) || 1;
    let maxD = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const P = pts[i];
      const d = Math.abs(dy * P.x - dx * P.y + B.x * A.y - B.y * A.x) / len;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tolerance && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

function sameBytes(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}


/* ---------- API key persistence: localStorage + IndexedDB copy (same origin, survives redeploys) ---------- */

function loadKey(): string {
  try {
    return localStorage.getItem(KEY_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveKey(key: string): void {
  try {
    if (key) localStorage.setItem(KEY_KEY, key);
    else localStorage.removeItem(KEY_KEY);
  } catch {
    /* private mode */
  }
  void withKeyStore('readwrite', (store) => (key ? store.put(key, 'openai') : store.delete('openai'))).catch(() => {
    /* Browser storage may be unavailable; the in-memory key still works. */
  });
}

function loadKeyFromDb(): Promise<string> {
  return new Promise((resolve) => {
    void withKeyStore('readonly', (store) => {
      const req = store.get('openai');
      req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : '');
      req.onerror = () => resolve('');
    }).catch(() => resolve(''));
  });
}

async function withKeyStore(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => void): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('keys', mode);
    fn(tx.objectStore('keys'));
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
