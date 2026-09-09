import { useState, type JSX, type RefObject } from 'react';
import { useEditorState } from '../hooks';
import { ZOOM_MAX, ZOOM_MIN } from '../paint/tools';
import type { WorkspaceHandle } from './Workspace';

// Slider is logarithmic so 100% sits in the middle and both directions feel even.
const toSlider = (z: number) => Math.log(z / ZOOM_MIN) / Math.log(ZOOM_MAX / ZOOM_MIN);
const fromSlider = (t: number) => ZOOM_MIN * Math.pow(ZOOM_MAX / ZOOM_MIN, t);

export function StatusBar({ workspace }: { workspace: RefObject<WorkspaceHandle | null> }): JSX.Element {
  const s = useEditorState();
  const pct = Math.round(s.zoom * 100);
  const [zoomEdit, setZoomEdit] = useState<string | null>(null);
  const aiMsg = s.ai.status !== 'idle' && s.ai.message;
  return (
    <div className="statusbar">
      <div className={`status-text ${aiMsg ? s.ai.status : ''}`} data-testid="status-text" role="status" aria-live="polite">{aiMsg || s.status}</div>
      <div className="status-cell mono" title="Cursor position" data-testid="status-cursor">{s.cursor ? `${s.cursor.x}, ${s.cursor.y}` : ''}</div>
      <div className="status-cell mono" title="Selection size" data-testid="status-selection">{s.selection ? `${s.selection.w} × ${s.selection.h}` : ''}</div>
      <div className="status-cell mono" title="Image size" data-testid="image-size">{s.resizing ? `${s.resizing.w} × ${s.resizing.h}` : `${s.docW} × ${s.docH}`}</div>
      <div className="status-cell zoom">
        <button type="button" className="zoom-btn" onClick={() => workspace.current?.zoomBy(0.8)} aria-label="Zoom out">−</button>
        <input type="range" className="zoom-slider" min={0} max={1} step={0.001} value={toSlider(s.zoom)} onChange={(e) => workspace.current?.setZoom(fromSlider(Number(e.target.value)))} aria-label="Zoom" />
        <button type="button" className="zoom-btn" onClick={() => workspace.current?.zoomBy(1.25)} aria-label="Zoom in">+</button>
        {zoomEdit === null ? (
          <button type="button" className="zoom-pct mono" onClick={() => setZoomEdit(String(pct))} onDoubleClick={() => workspace.current?.fit(1)} title="Click to type a zoom level" data-testid="zoom-pct">{pct}%</button>
        ) : (
          <input
            className="zoom-input mono"
            value={zoomEdit}
            autoFocus
            onChange={(e) => setZoomEdit(e.target.value)}
            onBlur={() => { const v = Number(zoomEdit); if (v > 0) workspace.current?.setZoom(v / 100); setZoomEdit(null); }}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setZoomEdit(null); }}
            aria-label="Zoom percent"
          />
        )}
      </div>
    </div>
  );
}
