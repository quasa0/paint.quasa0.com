import { useEffect, useState, type JSX } from 'react';
import { useEditor, useEditorState } from '../hooks';
import { Icon } from './Icons';
import { Versions } from './Versions';

function fmtDate(t: number): { day: string; time: string } {
  const d = new Date(t);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const day = sameDay ? 'Today' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return { day, time };
}

/** Right-hand drawings library: thumbnails, timestamps, new (+), two-click delete on hover. */
export function Library(): JSX.Element {
  const editor = useEditor();
  const s = useEditorState();
  const [armed, setArmed] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);

  // Disarm a pending delete after a moment.
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(null), 2500);
    return () => window.clearTimeout(t);
  }, [armed]);

  const onDelete = (id: string) => {
    if (armed === id) {
      setArmed(null);
      void editor.deleteDrawing(id);
    } else {
      setArmed(id);
    }
  };

  return (
    <aside className="library" data-testid="library" aria-label="Drawings">
      <div className="library-top">
      <div className="library-head">
        <span>Drawings</span>
        <button type="button" className="lib-btn" onClick={() => editor.newDocument()} title="New drawing (⌘N)" aria-label="New drawing" data-testid="lib-new">
          <Icon name="plus" size={14} />
        </button>
      </div>
      <div className="library-list" role="list">
        {s.drawings.length === 0 && <div className="library-empty">Your drawings appear here as you draw.</div>}
        {s.drawings.map((d) => {
          const { day, time } = fmtDate(d.updatedAt);
          const active = d.id === s.currentId;
          const isArmed = armed === d.id;
          return (
            <div
              key={d.id}
              role="listitem"
              className={`lib-item ${active ? 'active' : ''} ${isArmed ? 'armed' : ''}`}
              onClick={() => void editor.openDrawing(d.id)}
              onDoubleClick={() => setEditing({ id: d.id, value: d.name ?? '' })}
              onMouseLeave={() => isArmed && setArmed(null)}
              data-testid="lib-item"
              data-active={active}
            >
              <img className="lib-thumb" src={d.thumb} alt="" width={40} height={40} draggable={false} />
              <div className="lib-meta">
                {editing?.id === d.id ? (
                  <input
                    className="lib-rename"
                    value={editing.value}
                    autoFocus
                    placeholder="Name"
                    onChange={(e) => setEditing({ id: d.id, value: e.target.value })}
                    onBlur={() => { void editor.renameDrawing(d.id, editing.value); setEditing(null); }}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') setEditing(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    data-testid="lib-rename"
                  />
                ) : (
                  <span className="lib-day" title="Double-click to rename">{d.name || day}</span>
                )}
                <span className="lib-time mono">{d.name ? `${day} ` : ''}{time} · {d.w}×{d.h}</span>
              </div>
              <button
                type="button"
                className={`lib-del ${isArmed ? 'armed' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(d.id);
                }}
                title={isArmed ? 'Click again to delete' : 'Delete'}
                aria-label={isArmed ? 'Confirm delete' : 'Delete drawing'}
                data-testid="lib-delete"
              >
                {isArmed ? 'Delete?' : <Icon name="close" size={12} />}
              </button>
            </div>
          );
        })}
      </div>
      </div>
      {s.showVersions && <Versions />}
    </aside>
  );
}
