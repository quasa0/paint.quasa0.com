import type { JSX } from 'react';
import { useEditor, useEditorState } from '../hooks';
import { AIRBRUSH_SIZES, BRUSH_SIZES, ERASER_SIZES, LINE_WIDTHS, MAGNIFIER_ZOOMS, TOOLS, type BrushShape, type FillMode } from '../paint/tools';
import { Icon } from './Icons';

export function Toolbox(): JSX.Element {
  const editor = useEditor();
  const s = useEditorState();
  return (
    <div className="toolbox" data-testid="toolbox">
      <div className="tools" role="toolbar" aria-label="Tools">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tool ${s.tool === t.id ? 'active' : ''}`}
            data-tip={t.key ? `${t.label} · ${t.key}` : t.label}
            aria-label={t.label}
            aria-pressed={s.tool === t.id}
            aria-disabled={t.disabled}
            data-tool={t.id}
            onClick={() => editor.setTool(t.id)}
          >
            <Icon name={t.id} />
          </button>
        ))}
      </div>
      <div className="tool-options" data-testid="tool-options">
        <ToolOptions />
      </div>
    </div>
  );
}

function ToolOptions(): JSX.Element | null {
  const editor = useEditor();
  const s = useEditorState();
  switch (s.tool) {
    case 'select':
    case 'freeSelect':
      return (
        <div className="opt-col">
          <button type="button" className={`opt ${!s.transparentSelection ? 'active' : ''}`} aria-pressed={!s.transparentSelection} onClick={() => editor.setTransparentSelection(false)} title="Opaque selection">
            <span className="opt-sel opaque" />
          </button>
          <button type="button" className={`opt ${s.transparentSelection ? 'active' : ''}`} aria-pressed={s.transparentSelection} onClick={() => editor.setTransparentSelection(true)} title="Transparent selection (background color becomes see-through)">
            <span className="opt-sel transparent" />
          </button>
        </div>
      );
    case 'eraser':
      return (
        <div className="opt-col">
          {ERASER_SIZES.map((px) => (
            <button key={px} type="button" className={`opt ${s.eraserSize === px ? 'active' : ''}`} aria-pressed={s.eraserSize === px} onClick={() => editor.setEraserSize(px)} title={`${px}px`} data-size={px}>
              <span className="opt-square" style={{ width: px + 2, height: px + 2 }} />
            </button>
          ))}
        </div>
      );
    case 'magnifier':
      return (
        <div className="opt-col">
          {MAGNIFIER_ZOOMS.map((z) => (
            <button key={z} type="button" className={`opt text ${s.magnifierZoom === z ? 'active' : ''}`} aria-pressed={s.magnifierZoom === z} onClick={() => editor.setMagnifierZoom(z)}>
              {z}x
            </button>
          ))}
        </div>
      );
    case 'brush':
      return (
        <div className="opt-grid3">
          {(['round', 'square', 'slash'] as BrushShape[]).map((shape) =>
            BRUSH_SIZES.map((px) => (
              <button key={`${shape}${px}`} type="button" className={`opt ${s.brushShape === shape && s.brushSize === px ? 'active' : ''}`} aria-pressed={s.brushShape === shape && s.brushSize === px} onClick={() => editor.setBrush(shape, px)} title={`${shape} ${px}px`} data-brush={`${shape}-${px}`}>
                <span className={`opt-brush ${shape}`} style={{ width: px, height: px }} />
              </button>
            )),
          )}
        </div>
      );
    case 'airbrush':
      return (
        <div className="opt-col">
          {AIRBRUSH_SIZES.map((px) => (
            <button key={px} type="button" className={`opt ${s.airbrushSize === px ? 'active' : ''}`} aria-pressed={s.airbrushSize === px} onClick={() => editor.setAirbrushSize(px)} title={`${px}px`}>
              <span className="opt-spray" style={{ width: px, height: px }} />
            </button>
          ))}
        </div>
      );
    case 'line':
    case 'curve':
      return (
        <div className="opt-col">
          {LINE_WIDTHS.map((w) => (
            <button key={w} type="button" className={`opt wide ${s.lineWidth === w ? 'active' : ''}`} aria-pressed={s.lineWidth === w} onClick={() => editor.setLineWidth(w)} title={`${w}px`} data-width={w}>
              <span className="opt-line" style={{ height: w }} />
            </button>
          ))}
        </div>
      );
    case 'rect':
    case 'polygon':
    case 'ellipse':
    case 'roundRect':
      return (
        <div className="opt-col">
          {(['outline', 'both', 'fill'] as FillMode[]).map((m) => (
            <button key={m} type="button" className={`opt wide ${s.fillMode === m ? 'active' : ''}`} aria-pressed={s.fillMode === m} onClick={() => editor.setFillMode(m)} title={m === 'outline' ? 'Outline' : m === 'both' ? 'Outline with fill' : 'Fill only'} data-fill={m}>
              <span className={`opt-fill ${m}`} />
            </button>
          ))}
          <div className="opt-divider" />
          {LINE_WIDTHS.slice(0, 3).map((w) => (
            <button key={w} type="button" className={`opt wide ${s.lineWidth === w ? 'active' : ''}`} aria-pressed={s.lineWidth === w} onClick={() => editor.setLineWidth(w)} title={`${w}px outline`}>
              <span className="opt-line" style={{ height: w }} />
            </button>
          ))}
        </div>
      );
    default:
      return null;
  }
}
