import { useEffect, useRef, type JSX } from 'react';
import { useEditor, useEditorState } from '../hooks';

function fmtTime(t: number): string {
  return new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** History of the open drawing, newest first: V1, V2, … with thumbnails. Click to jump; nothing is ever lost. */
export function Versions(): JSX.Element | null {
  const editor = useEditor();
  const s = useEditorState();
  const list = useRef<HTMLDivElement>(null);
  const head = s.versions.find((v) => v.id === s.headId);
  const byId = new Map(s.versions.map((v) => [v.id, v]));
  const ancestry = new Set<string>();
  for (let id: string | null = s.headId; id; id = byId.get(id)?.parentId ?? null) ancestry.add(id);
  const newestFirst = s.versions.slice().sort((a, b) => b.seq - a.seq);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>('.ver.head')?.scrollIntoView({ block: 'nearest' });
  }, [s.headId, s.versions.length]);

  return (
    <div className="versions" data-testid="versions" aria-label="History">
      <div className="library-head">
        <span>History</span>
        <span className="versions-count mono">{head ? `V${head.seq}` : '—'} · {s.versions.length}</span>
      </div>
      <div className="versions-list" ref={list} role="list">
        {s.versions.length === 0 && <div className="library-empty">Every action on this drawing is saved here.</div>}
        {newestFirst.map((v) => (
          <button
            type="button"
            key={v.id}
            role="listitem"
            className={`ver ${v.id === s.headId ? 'head' : ''} ${ancestry.has(v.id) ? 'on-path' : ''}`}
            onClick={() => void editor.setHead(v.id)}
            data-testid="ver"
            data-seq={v.seq}
          >
            <img src={v.thumb} alt="" width={28} height={28} draggable={false} />
            <span className="ver-label mono">V{v.seq}</span>
            <span className="ver-time mono">{fmtTime(v.createdAt)}</span>
            {v.parentId && byId.get(v.parentId) && byId.get(v.parentId)!.seq !== v.seq - 1 && (
              <span className="ver-from mono" title={`Branched from V${byId.get(v.parentId)!.seq}`}>← V{byId.get(v.parentId)!.seq}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
