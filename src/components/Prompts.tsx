import { useEffect, useState, type JSX } from 'react';
import { useEditor, useEditorState } from '../hooks';
import { Icon } from './Icons';

function fmtWhen(t: number): string {
  const d = new Date(t);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Every prompt sent so far, newest first, shared across drawings. Click a line to drop it into the
 * prompt box under the current selection (then ↵), copy it, or delete it (two clicks).
 */
export function Prompts(): JSX.Element {
  const editor = useEditor();
  const s = useEditorState();
  const [armed, setArmed] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(null), 2500);
    return () => window.clearTimeout(t);
  }, [armed]);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(null), 1200);
    return () => window.clearTimeout(t);
  }, [copied]);

  const onDelete = (id: string) => {
    if (armed === id) {
      setArmed(null);
      editor.deletePrompt(id);
    } else {
      setArmed(id);
    }
  };

  const onCopy = async (p: { id: string; text: string }) => {
    if (await editor.copyPrompt(p.text)) setCopied(p.id);
  };

  return (
    <div className="prompts" data-testid="prompts" aria-label="Prompts">
      <div className="library-head">
        <span>Prompts</span>
        <span className="versions-count mono">{s.prompts.length}</span>
      </div>
      <div className="prompts-list" role="list">
        {s.prompts.length === 0 && <div className="library-empty">Prompts you send appear here. Click one to reuse it.</div>}
        {s.prompts.map((p) => {
          const isArmed = armed === p.id;
          return (
            <div
              key={p.id}
              role="listitem"
              className={`prompt-item ${isArmed ? 'armed' : ''}`}
              onClick={() => editor.usePrompt(p.text)}
              onMouseLeave={() => isArmed && setArmed(null)}
              title={s.selection ? 'Click to put this prompt in the prompt box' : 'Select an area first, then click to reuse'}
              data-testid="prompt-item"
            >
              <span className="prompt-text">{p.text}</span>
              <span className="prompt-when mono">{p.uses > 1 ? `×${p.uses} · ` : ''}{fmtWhen(p.usedAt)}</span>
              <span className="prompt-actions">
                <button
                  type="button"
                  className={`prompt-btn ${copied === p.id ? 'ok' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void onCopy(p);
                  }}
                  title="Copy prompt"
                  aria-label="Copy prompt"
                  data-testid="prompt-copy"
                >
                  {copied === p.id ? <Icon name="check" size={12} /> : <Icon name="copy" size={12} />}
                </button>
                <button
                  type="button"
                  className={`prompt-btn del ${isArmed ? 'armed' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(p.id);
                  }}
                  title={isArmed ? 'Click again to delete' : 'Delete'}
                  aria-label={isArmed ? 'Confirm delete' : 'Delete prompt'}
                  data-testid="prompt-delete"
                >
                  {isArmed ? 'Delete?' : <Icon name="close" size={12} />}
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
