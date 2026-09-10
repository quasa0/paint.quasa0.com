import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type JSX, type PointerEvent as RPointerEvent } from 'react';
import { useEditor, useEditorState } from '../hooks';
import type { Pt } from '../paint/doc';
import { TEXT_FONT } from '../paint/draw';
import { Icon, type IconName } from './Icons';

export interface WorkspaceHandle {
  fit(zoom?: number): void;
  zoomBy(factor: number): void;
  setZoom(zoom: number): void;
  /** Document coordinate at the top-left of the visible area (for paste placement). */
  viewOrigin(): Pt;
  /** Document coordinate at the center of the visible area. */
  viewCenter(): Pt;
  /** Zoom so the current selection fills the view. */
  zoomToSelection(): void;
}

type PanGesture = { startX: number; startY: number; panX: number; panY: number } | null;
type HandleGesture = { corner: 'e' | 's' | 'se'; startW: number; startH: number } | null;

export const Workspace = forwardRef<WorkspaceHandle>(function Workspace(_, ref): JSX.Element {
  const editor = useEditor();
  const s = useEditorState();
  const container = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const pan = useRef<PanGesture>(null);
  const handle = useRef<HandleGesture>(null);
  const drawing = useRef(false);
  const [panning, setPanning] = useState(false);
  const [overSel, setOverSel] = useState(false);

  // Mount the document and preview canvases directly so drawing is visible without copies.
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    el.append(editor.doc.canvas, editor.preview);
    editor.doc.canvas.className = 'doc-canvas';
    editor.preview.className = 'preview-canvas';
  }, [editor]);

  const viewSize = () => {
    const r = container.current?.getBoundingClientRect();
    return { w: r?.width ?? 800, h: r?.height ?? 600 };
  };

  const fit = useCallback(
    (zoom?: number) => {
      const { w, h } = viewSize();
      editor.fit(w, h, zoom);
    },
    [editor],
  );

  useImperativeHandle(
    ref,
    () => ({
      fit,
      zoomBy: (factor) => {
        const { w, h } = viewSize();
        editor.zoomAt(editor.state.zoom * factor, w / 2, h / 2);
      },
      setZoom: (zoom) => {
        const { w, h } = viewSize();
        editor.zoomAt(zoom, w / 2, h / 2);
      },
      viewOrigin: () => {
        const { zoom, panX, panY } = editor.state;
        return { x: Math.max(0, (8 - panX) / zoom), y: Math.max(0, (8 - panY) / zoom) };
      },
      zoomToSelection: () => {
        const sel = editor.state.selection;
        if (!sel) return;
        const { w, h } = viewSize();
        const zoom = Math.min(8, Math.max(0.125, Math.min((w - 160) / sel.w, (h - 160) / sel.h)));
        editor.setView(zoom, Math.round(w / 2 - (sel.x + sel.w / 2) * zoom), Math.round(h / 2 - (sel.y + sel.h / 2) * zoom));
      },
      viewCenter: () => {
        const { zoom, panX, panY } = editor.state;
        const { w, h } = viewSize();
        return { x: (w / 2 - panX) / zoom, y: (h / 2 - panY) / zoom };
      },
    }),
    [editor, fit],
  );

  // One effect decides between "fit the whole canvas" (open / new / load) and "keep zoom, re-center" (resize ops).
  const lastFit = useRef(0);
  const lastSize = useRef<string>('');
  useLayoutEffect(() => {
    const key = `${s.docW}x${s.docH}`;
    if (lastSize.current === '' || s.fitRequest !== lastFit.current) {
      lastFit.current = s.fitRequest;
      fit();
    } else if (lastSize.current !== key) {
      const { w, h } = viewSize();
      editor.setView(s.zoom, Math.round((w - s.docW * s.zoom) / 2), Math.round((h - s.docH * s.zoom) / 2));
    }
    lastSize.current = key;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.docW, s.docH, s.fitRequest]);

  // Wheel: pan by default, zoom with Ctrl/Cmd (this is also what trackpad pinch sends).
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const st = editor.state;
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025));
        editor.zoomAt(st.zoom * factor, e.clientX - rect.left, e.clientY - rect.top);
      } else {
        const k = e.deltaMode === 1 ? 16 : 1;
        editor.setView(st.zoom, st.panX - e.deltaX * k, st.panY - e.deltaY * k);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [editor]);

  const toDoc = (e: { clientX: number; clientY: number }): Pt => {
    const rect = container.current!.getBoundingClientRect();
    const st = editor.state;
    return { x: (e.clientX - rect.left - st.panX) / st.zoom, y: (e.clientY - rect.top - st.panY) / st.zoom };
  };
  const toScreen = (e: { clientX: number; clientY: number }): Pt => {
    const rect = container.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.ai-bar, .textbox, .handle, .float-handle')) return;
    const el = container.current!;
    el.setPointerCapture(e.pointerId);
    if (e.button === 1 || s.spaceHeld) {
      const st = editor.state;
      pan.current = { startX: e.clientX, startY: e.clientY, panX: st.panX, panY: st.panY };
      setPanning(true);
      return;
    }
    if (s.tool === 'magnifier') {
      const p = toScreen(e);
      const z = editor.state.magnifierZoom;
      editor.zoomAt(e.button === 2 ? 1 : editor.state.zoom === 1 ? z : 1, p.x, p.y);
      return;
    }
    drawing.current = true;
    editor.pointerDown(toDoc(e), e.button, { alt: e.altKey });
  };

  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (pan.current) {
      const g = pan.current;
      editor.setView(editor.state.zoom, g.panX + (e.clientX - g.startX), g.panY + (e.clientY - g.startY));
      return;
    }
    if (handle.current) {
      const p = toDoc(e);
      const g = handle.current;
      const w = g.corner === 's' ? g.startW : Math.min(8000, Math.max(1, Math.round(p.x)));
      const h = g.corner === 'e' ? g.startH : Math.min(8000, Math.max(1, Math.round(p.y)));
      editor.setResizing({ w, h });
      return;
    }
    editor.snapOff = e.metaKey || e.ctrlKey;
    const p = toDoc(e);
    editor.pointerMove(p);
    if (!drawing.current) {
      const hit = (s.tool === 'select' || s.tool === 'freeSelect') && editor.hitSelection(p);
      if (hit !== overSel) setOverSel(hit);
    }
  };

  const onPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    if (pan.current) {
      pan.current = null;
      setPanning(false);
      return;
    }
    if (handle.current) {
      handle.current = null;
      const r = editor.state.resizing;
      editor.setResizing(null);
      if (r) editor.resizeCanvas(r.w, r.h);
      return;
    }
    if (drawing.current) {
      drawing.current = false;
      editor.pointerUp(toDoc(e));
    }
  };

  const startHandle = (corner: 'e' | 's' | 'se') => (e: RPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    container.current!.setPointerCapture(e.pointerId);
    handle.current = { corner, startW: s.docW, startH: s.docH };
    editor.setResizing({ w: s.docW, h: s.docH });
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f && f.type.startsWith('image/')) void editor.pasteImageFile(f, toDoc(e));
  };

  type Corner = 'nw' | 'ne' | 'sw' | 'se';
  const startCornerScale = (corner: Corner) => (e: RPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    container.current!.setPointerCapture(e.pointerId);
    drawing.current = true;
    editor.startScale(corner, e.shiftKey);
  };

  const cursor = panning || s.spaceHeld ? (panning ? 'grabbing' : 'grab') : overSel ? (drawing.current ? 'grabbing' : 'move') : cursorFor(s.tool);
  const toScreenPt = (q: Pt) => `${s.panX + q.x * s.zoom},${s.panY + q.y * s.zoom}`;
  const outline = s.lasso ?? s.selectionPath;
  const sel = s.selection;
  const selScreen = sel ? { left: s.panX + sel.x * s.zoom, top: s.panY + sel.y * s.zoom, width: sel.w * s.zoom, height: sel.h * s.zoom } : null;
  const docScreen = { left: s.panX, top: s.panY, width: s.docW * s.zoom, height: s.docH * s.zoom };
  const resizing = s.resizing;

  return (
    <div
      ref={container}
      className="workspace"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => editor.pointerLeave()}
      onContextMenu={(e) => e.preventDefault()}
      onDoubleClick={() => editor.doubleClick()}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      data-testid="workspace"
    >
      <div
        ref={stage}
        className={`stage ${s.zoom >= 1 ? 'pixelated' : ''}`}
        style={{ width: s.docW, height: s.docH, transform: `translate(${s.panX}px, ${s.panY}px) scale(${s.zoom})` }}
      />

      {s.gridlines && s.zoom >= 3 && (
        <div className="gridlines" style={{ ...docScreen, backgroundSize: `${s.zoom}px ${s.zoom}px` }} />
      )}

      {/* Canvas resize handles, like Paint: three live handles plus five inert ones. */}
      {(['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'] as const).map((c) => {
        const live = c === 'e' || c === 's' || c === 'se';
        const x = c.includes('e') ? docScreen.left + docScreen.width : c.includes('w') ? docScreen.left : docScreen.left + docScreen.width / 2;
        const y = c.includes('s') ? docScreen.top + docScreen.height : c.includes('n') ? docScreen.top : docScreen.top + docScreen.height / 2;
        return (
          <div
            key={c}
            className={`handle ${live ? `live handle-${c}` : ''}`}
            style={{ left: x, top: y }}
            onPointerDown={live ? startHandle(c as 'e' | 's' | 'se') : undefined}
            title={live ? 'Drag to resize the canvas' : undefined}
            data-testid={live ? `handle-${c}` : undefined}
          />
        );
      })}

      {resizing && (
        <div className="resize-outline" style={{ left: docScreen.left, top: docScreen.top, width: resizing.w * s.zoom, height: resizing.h * s.zoom }} />
      )}

      {s.blank && s.jobs.length === 0 && !s.selection && (
        <div className="blank-hint" style={{ left: docScreen.left + docScreen.width / 2, top: docScreen.top + docScreen.height / 2 }} data-testid="blank-hint">
          Draw something, select it, and describe what it should become.
        </div>
      )}
      <div className="doc-size mono" style={{ left: docScreen.left + docScreen.width, top: docScreen.top + docScreen.height + 6 }} data-testid="doc-size">
        {resizing ? `${resizing.w} × ${resizing.h}` : `${s.docW} × ${s.docH}`}
      </div>

      {s.guides.x !== null && <div className="guide guide-v" style={{ left: s.panX + s.guides.x * s.zoom, top: docScreen.top, height: docScreen.height }} />}
      {s.guides.y !== null && <div className="guide guide-h" style={{ top: s.panY + s.guides.y * s.zoom, left: docScreen.left, width: docScreen.width }} />}
      <JobOverlays />

      {selScreen && !s.selectionPath && <div className="marquee" style={selScreen} data-testid="selection" />}
      {selScreen && s.floating && (['nw', 'ne', 'sw', 'se'] as Corner[]).map((c) => (
        <div
          key={c}
          className={`float-handle float-${c}`}
          style={{ left: c.includes('e') ? selScreen.left + selScreen.width : selScreen.left, top: c.includes('s') ? selScreen.top + selScreen.height : selScreen.top }}
          onPointerDown={startCornerScale(c)}
          title="Drag to resize (Shift keeps proportions)"
          data-testid={`float-${c}`}
        />
      ))}
      {outline && outline.length > 1 && (
        <svg className="lasso-overlay" data-testid={s.lasso ? 'lasso-live' : 'selection-lasso'}>
          <polygon points={outline.map(toScreenPt).join(' ')} className="lasso-halo" />
          <polygon points={outline.map(toScreenPt).join(' ')} className="lasso-line" />
        </svg>
      )}

      {sel && selScreen && (s.tool === 'select' || s.tool === 'freeSelect') && (
        <>
          <SelectionToolbar anchor={selScreen} />
          <AiBar anchor={selScreen} />
        </>
      )}

      {s.textBox && <TextBoxOverlay />}
    </div>
  );
});

function cursorFor(tool: string): string {
  switch (tool) {
    case 'text':
      return 'text';
    case 'magnifier':
      return 'zoom-in';
    default:
      return 'crosshair';
  }
}

/* ---------- AI prompt (minimal) ---------- */

function AiBar({ anchor }: { anchor: { left: number; top: number; width: number; height: number } }): JSX.Element {
  const editor = useEditor();
  const s = useEditorState();
  const [prompt, setPrompt] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: Math.max(8, anchor.left), top: anchor.top + anchor.height + 8 });
  const hasKey = !!s.apiKey || !!s.oauth;
  // A click in the Prompts section drops that text here (state-from-props pattern, no effect needed).
  const [seenFill, setSeenFill] = useState(s.promptFill.n);
  if (s.promptFill.n !== seenFill) {
    setSeenFill(s.promptFill.n);
    setPrompt(s.promptFill.text);
  }

  useEffect(() => {
    if (hasKey) input.current?.focus();
  }, [hasKey, s.promptFill.n]);

  // Grow with the text up to five lines, then scroll.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = '0px';
    const line = 20;
    const h = Math.min(el.scrollHeight, line * 5);
    el.style.height = `${Math.max(line, h)}px`;
    el.style.overflowY = el.scrollHeight > line * 5 ? 'auto' : 'hidden';
  }, [prompt, hasKey]);

  useLayoutEffect(() => {
    const element = bar.current;
    const workspace = element?.closest<HTMLElement>('.workspace');
    if (!element || !workspace) return;
    const gap = 8;
    const left = Math.max(gap, Math.min(anchor.left, workspace.clientWidth - element.offsetWidth - gap));
    const below = anchor.top + anchor.height + gap;
    const top = below + element.offsetHeight <= workspace.clientHeight - gap ? below : Math.max(gap, anchor.top - element.offsetHeight - gap);
    setPosition({ left, top });
  }, [anchor.left, anchor.top, anchor.width, anchor.height, hasKey]);

  const submit = () => {
    if (!prompt.trim()) return;
    void editor.generate(prompt);
    setPrompt('');
  };

  return (
    <div ref={bar} className="ai-bar" style={position} onPointerDown={(e) => e.stopPropagation()} data-testid="ai-bar" role="group" aria-label="AI repaint">
      {hasKey ? (
        <>
          <Icon name="sparkle" size={14} className="ai-icon" />
          <textarea
            ref={input}
            className="ai-input"
            placeholder="Describe this area… (⇧↵ for a new line)"
            value={prompt}
            rows={1}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              } else if (e.key === 'ArrowUp' && !prompt && s.lastPrompt) {
                e.preventDefault();
                setPrompt(s.lastPrompt);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                editor.deselect();
              }
              e.stopPropagation();
            }}
            aria-label="Describe what this area should become"
            data-testid="ai-prompt"
          />
          <kbd className="ai-kbd" aria-hidden="true">↵</kbd>
        </>
      ) : (
        <button type="button" className="ai-addkey" onClick={() => editor.openDialog('key')} data-testid="ai-addkey">
          <Icon name="logo" size={13} />
          Sign in with OpenAI to repaint this area
        </button>
      )}
    </div>
  );
}

/* ---------- contextual selection toolbar (above the selection) ---------- */

function B({ icon, tip, onClick, testid }: { icon: IconName; tip: string; onClick: () => void; testid: string }): JSX.Element {
  return (
    <button type="button" className="sb-btn" data-tip={tip} aria-label={tip} onClick={onClick} data-testid={testid}>
      <Icon name={icon} size={14} />
    </button>
  );
}

function SelectionToolbar({ anchor }: { anchor: { left: number; top: number; width: number; height: number } }): JSX.Element {
  const editor = useEditor();
  const lastPrompt = useEditorState().lastPrompt;
  const bar = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: anchor.left, top: Math.max(8, anchor.top - 40) });
  useLayoutEffect(() => {
    const el = bar.current;
    const ws = el?.closest<HTMLElement>('.workspace');
    if (!el || !ws) return;
    const gap = 8;
    const left = Math.max(gap, Math.min(anchor.left + anchor.width / 2 - el.offsetWidth / 2, ws.clientWidth - el.offsetWidth - gap));
    const above = anchor.top - el.offsetHeight - gap;
    const top = above >= gap ? above : Math.min(ws.clientHeight - el.offsetHeight - gap, anchor.top + anchor.height + 56);
    setPos({ left, top });
  }, [anchor.left, anchor.top, anchor.width, anchor.height]);
  return (
    <div ref={bar} className="sel-bar" style={pos} onPointerDown={(e) => e.stopPropagation()} data-testid="sel-bar" role="toolbar" aria-label="Selection">
      <B icon="alignLeft" tip="Align left" onClick={() => editor.alignSelection('left', null)} testid="al-left" />
      <B icon="alignCenterH" tip="Center horizontally" onClick={() => editor.alignSelection('center', null)} testid="al-ch" />
      <B icon="alignRight" tip="Align right" onClick={() => editor.alignSelection('right', null)} testid="al-right" />
      <B icon="alignTop" tip="Align top" onClick={() => editor.alignSelection(null, 'top')} testid="al-top" />
      <B icon="alignMiddle" tip="Center vertically" onClick={() => editor.alignSelection(null, 'middle')} testid="al-cv" />
      <B icon="alignBottom" tip="Align bottom" onClick={() => editor.alignSelection(null, 'bottom')} testid="al-bottom" />
      <B icon="center" tip="Center on canvas" onClick={() => editor.alignSelection('center', 'middle')} testid="al-center" />
      <span className="sb-sep" />
      <B icon="flipH" tip="Flip horizontal · ⇧H" onClick={() => editor.flipSelection('h')} testid="sb-fliph" />
      <B icon="flipV" tip="Flip vertical · ⇧V" onClick={() => editor.flipSelection('v')} testid="sb-flipv" />
      <B icon="rotateCcw" tip="Rotate left · [" onClick={() => editor.rotateSelection(270)} testid="sb-rotl" />
      <B icon="rotateCw" tip="Rotate right · ]" onClick={() => editor.rotateSelection(90)} testid="sb-rotr" />
      <B icon="fit" tip="Fit to canvas" onClick={() => editor.fitSelectionToCanvas()} testid="sb-fit" />
      <span className="sb-sep" />
      <B icon="duplicate" tip="Duplicate · ⌘D" onClick={() => editor.duplicateSelection()} testid="sb-dup" />
      <B icon="copyPng" tip="Copy as PNG · ⌘⇧C" onClick={() => void editor.copyAsPng()} testid="sb-copypng" />
      {lastPrompt && <B icon="sparkle" tip={`Repaint again: “${lastPrompt.slice(0, 40)}${lastPrompt.length > 40 ? '…' : ''}”`} onClick={() => editor.regenerate()} testid="sb-regen" />}
      <B icon="download" tip="Download selection as PNG" onClick={() => editor.exportImage({ format: 'png', selectionOnly: true })} testid="sb-download" />
      <B icon="crop" tip="Crop canvas to selection · ⌘⇧X" onClick={() => editor.crop()} testid="sb-crop" />
      <B icon="trash" tip="Delete · ⌫" onClick={() => editor.deleteSelection()} testid="sb-del" />
      <span className="sb-sep" />
      <RectFields />
    </div>
  );
}

/** Editable X / Y / W / H readout for the selection. */
function RectFields(): JSX.Element | null {
  const editor = useEditor();
  const sel = useEditorState().selection;
  if (!sel) return null;
  const field = (k: 'x' | 'y' | 'w' | 'h') => (
    <label className="sb-field" key={k}>
      <span>{k.toUpperCase()}</span>
      <input
        type="number"
        value={sel[k]}
        onChange={(e) => editor.setSelectionRect({ [k]: Number(e.target.value) })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur();
          e.stopPropagation();
        }}
        aria-label={`Selection ${k}`}
        data-testid={`sb-${k}`}
      />
    </label>
  );
  return <>{(['x', 'y', 'w', 'h'] as const).map(field)}</>;
}

/* ---------- running / failed AI jobs: outline + label that outlive the selection ---------- */

function JobOverlays(): JSX.Element | null {
  const editor = useEditor();
  const s = useEditorState();
  if (s.jobs.length === 0) return null;
  const toScreen = (q: Pt) => `${s.panX + q.x * s.zoom},${s.panY + q.y * s.zoom}`;
  return (
    <>
      {s.jobs.map((job) => {
        const r = job.rect;
        const box = { left: s.panX + r.x * s.zoom, top: s.panY + r.y * s.zoom, width: r.w * s.zoom, height: r.h * s.zoom };
        return (
          <div key={job.id} className={`job ${job.status}`} data-testid="ai-job" data-status={job.status}>
            {job.path ? (
              <svg className="lasso-overlay">
                <polygon points={job.path.map(toScreen).join(' ')} className="lasso-halo" />
                <polygon points={job.path.map(toScreen).join(' ')} className={`lasso-line ${job.status === 'running' ? 'busy' : ''}`} />
              </svg>
            ) : (
              <div className={`marquee ${job.status === 'running' ? 'busy' : ''}`} style={box}>
                {job.status === 'running' && <div className="shimmer" />}
              </div>
            )}
            <div className={`ai-job ${job.status}`} style={{ left: Math.max(8, box.left), top: box.top + box.height + 8 }} onPointerDown={(e) => e.stopPropagation()}>
              {job.status === 'running' ? (
                <button type="button" className="ai-cancel" onClick={() => editor.cancelJob(job.id)} title="Cancel" aria-label="Cancel generation">
                  <span className="spinner" />
                </button>
              ) : (
                <Icon name="sparkle" size={13} className="ai-icon" />
              )}
              <span className="ai-job-prompt" title={job.prompt}>{job.prompt}</span>
              {job.status === 'error' ? (
                <>
                  <span className="ai-job-error" role="alert" data-testid="ai-status">{job.message}</span>
                  <button type="button" className="ai-cancel" onClick={() => editor.dismissJob(job.id)} aria-label="Dismiss">
                    <Icon name="close" size={12} />
                  </button>
                </>
              ) : (
                <span className="ai-job-status" data-testid="ai-status">{job.message}</span>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}

/* ---------- text tool overlay ---------- */

function TextBoxOverlay(): JSX.Element | null {
  const editor = useEditor();
  const s = useEditorState();
  const tb = s.textBox;
  const ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ta.current?.focus();
  }, []);
  if (!tb) return null;
  const px = tb.size * s.zoom;
  const lines = tb.text.split('\n');
  const cols = Math.max(12, ...lines.map((l) => l.length + 2));
  return (
    <div
      className="textbox"
      style={{ left: s.panX + tb.x * s.zoom, top: s.panY + tb.y * s.zoom }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="text-toolbar">
        <select value={tb.size} onChange={(e) => editor.updateText({ size: Number(e.target.value) })} aria-label="Font size">
          {[8, 10, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <button type="button" className={`text-style ${tb.bold ? 'active' : ''}`} onClick={() => editor.updateText({ bold: !tb.bold })} aria-pressed={tb.bold}><b>B</b></button>
        <button type="button" className={`text-style ${tb.italic ? 'active' : ''}`} onClick={() => editor.updateText({ italic: !tb.italic })} aria-pressed={tb.italic}><i>I</i></button>
        <button type="button" className="text-style ok" onClick={() => editor.commitText()} title="Apply (Ctrl+Enter)">OK</button>
      </div>
      <textarea
        ref={ta}
        value={tb.text}
        rows={Math.max(1, lines.length)}
        cols={cols}
        style={{ fontSize: px, lineHeight: `${Math.round(tb.size * 1.25) * s.zoom}px`, color: s.color1, fontFamily: TEXT_FONT, fontWeight: tb.bold ? 'bold' : 'normal', fontStyle: tb.italic ? 'italic' : 'normal' }}
        onChange={(e) => editor.updateText({ text: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            editor.cancelText();
          } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            editor.commitText();
          }
          e.stopPropagation();
        }}
        spellCheck={false}
        data-testid="text-input"
      />
    </div>
  );
}
