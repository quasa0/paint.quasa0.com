import { ctx2d, makeCanvas } from './doc';

/** Stored drawing: bitmap PNG plus a small JPEG thumbnail for the sidebar. */
export interface DrawingRecord {
  id: string;
  createdAt: number;
  updatedAt: number;
  name?: string;
  w: number;
  h: number;
  thumb: string;
  blob: Blob;
  /** Version currently shown for this drawing. */
  headId?: string;
}

export type DrawingMeta = Omit<DrawingRecord, 'blob'>;

/** One point in a drawing's history. Versions form a tree through `parentId`; `seq` is display order (V1, V2…). */
export interface VersionRecord {
  id: string;
  drawingId: string;
  seq: number;
  parentId: string | null;
  createdAt: number;
  w: number;
  h: number;
  thumb: string;
  blob: Blob;
}
export type VersionMeta = Omit<VersionRecord, 'blob'>;

const DB = 'ai-paint';
const VERSION = 3;

export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
    const open = indexedDB.open(DB, VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys');
      if (!db.objectStoreNames.contains('drawings')) db.createObjectStore('drawings', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('versions')) {
        const vs = db.createObjectStore('versions', { keyPath: 'id' });
        vs.createIndex('byDrawing', 'drawingId', { unique: false });
      }
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => resolve(open.result);
  });
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        let out: T | undefined;
        if (req) req.onsuccess = () => (out = req.result);
        t.oncomplete = () => {
          db.close();
          resolve(out);
        };
        t.onerror = () => {
          db.close();
          reject(t.error);
        };
      }),
  );
}

export async function listDrawings(): Promise<DrawingMeta[]> {
  const all = (await tx<DrawingRecord[]>('drawings', 'readonly', (s) => s.getAll())) ?? [];
  return all
    .map(({ blob: _blob, ...meta }) => meta)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getDrawing(id: string): Promise<DrawingRecord | undefined> {
  return tx<DrawingRecord | undefined>('drawings', 'readonly', (s) => s.get(id));
}

export async function putDrawing(rec: DrawingRecord): Promise<void> {
  await tx('drawings', 'readwrite', (s) => s.put(rec));
}

export async function deleteDrawing(id: string): Promise<void> {
  await tx('drawings', 'readwrite', (s) => s.delete(id));
}

export async function listVersions(drawingId: string): Promise<VersionMeta[]> {
  const all = (await tx<VersionRecord[]>('versions', 'readonly', (s) => s.index('byDrawing').getAll(drawingId))) ?? [];
  return all.map(({ blob: _b, ...m }) => m).sort((a, b) => a.seq - b.seq);
}

export async function getVersion(id: string): Promise<VersionRecord | undefined> {
  return tx<VersionRecord | undefined>('versions', 'readonly', (s) => s.get(id));
}

export async function putVersion(rec: VersionRecord): Promise<void> {
  await tx('versions', 'readwrite', (s) => s.put(rec));
}

export async function deleteVersion(id: string): Promise<void> {
  await tx('versions', 'readwrite', (s) => s.delete(id));
}

export async function deleteVersionsOf(drawingId: string): Promise<void> {
  const metas = await listVersions(drawingId);
  for (const m of metas) await deleteVersion(m.id);
}

export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Small "cover" thumbnail as a JPEG data URL (a few KB). */
export function makeThumb(source: HTMLCanvasElement, size = 96): string {
  const c = makeCanvas(size, size);
  const x = ctx2d(c);
  x.fillStyle = '#fff';
  x.fillRect(0, 0, size, size);
  const scale = Math.max(size / source.width, size / source.height);
  const w = source.width * scale;
  const h = source.height * scale;
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = 'high';
  x.drawImage(source, (size - w) / 2, (size - h) / 2, w, h);
  return c.toDataURL('image/jpeg', 0.72);
}

export function canvasToBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'));
}
