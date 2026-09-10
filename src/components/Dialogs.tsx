import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import { useEditor, useEditorState } from '../hooks';
import { Icon } from './Icons';
import { VERIFY_URL } from '../paint/oauth';

function Modal({ title, children, onClose, actions, width }: { title: string; children: ReactNode; onClose: () => void; actions: ReactNode; width?: number }): JSX.Element {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const focusables = () => Array.from(box.current?.querySelectorAll<HTMLElement>('input, button, select, textarea, [tabindex]:not([tabindex="-1"])') ?? []).filter((el) => !el.hasAttribute('disabled'));
    if (!box.current?.contains(document.activeElement)) focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        // Keep focus inside the dialog.
        const list = focusables();
        if (list.length === 0) return;
        const first = list[0];
        const last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={width ? { width } : undefined} ref={box}>
        <div className="modal-title">
          <span>{title}</span>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close"><Icon name="close" size={14} /></button>
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-actions">{actions}</div>
      </div>
    </div>
  );
}

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
const SHORTCUTS: [string, string][] = [
  ['W S E F I M P B A T L C R G O U', 'Tools: free-form, select, eraser, fill, picker, magnifier, pencil, brush, airbrush, text, line, curve, rectangle, polygon, ellipse, rounded rectangle'],
  ['⇧+drag', 'Constrain lines to 45°, shapes to squares/circles'],
  ['⌥+click', 'Pick color while using a paint tool'],
  ['⌥+drag', 'Move a copy of the selection'],
  ['↑ ↓ ← →', 'Nudge selection 1 px (⇧ for 10 px)'],
  [`${MOD}+drag`, 'Disable snapping while moving'],
  [`${MOD}+D`, 'Duplicate selection'],
  ['⇧+H ⇧+V', 'Flip selection horizontally / vertically'],
  ['[ ]', 'Rotate selection left / right'],
  ['↵', 'Place a floating selection; start a repaint from the prompt'],
  ['Esc', 'Deselect, cancel a generation, close a dialog'],
  [`${MOD}+A`, 'Select all'],
  [`${MOD}+C ${MOD}+X ${MOD}+V`, 'Copy, cut, paste (images from anywhere)'],
  [`${MOD}+⇧+C`, 'Copy selection or canvas as PNG'],
  [`${MOD}+⇧+X`, 'Crop canvas to selection'],
  [`${MOD}+Z ${MOD}+⇧+Z`, 'Undo, redo'],
  [`${MOD}+S`, 'Download PNG'],
  [`${MOD}+⇧+E`, 'Export PNG at 2×'],
  [`${MOD}+N`, 'New drawing'],
  [`${MOD}+E ${MOD}+W ${MOD}+R ${MOD}+I`, 'Attributes, stretch, flip/rotate, invert colors'],
  ['Space+drag', 'Pan'],
  [`${MOD}+wheel`, 'Zoom at cursor'],
  ['⇧+1 ⇧+2 ⇧+0', 'Fit to window, zoom to selection, actual size'],
  ['?', 'This sheet'],
];

export function Dialogs(): JSX.Element | null {
  const s = useEditorState();
  const editor = useEditor();
  const close = () => editor.openDialog('none');
  switch (s.dialog) {
    case 'key':
      return <KeyDialog onClose={close} />;
    case 'attributes':
      return <AttributesDialog onClose={close} />;
    case 'stretch':
      return <StretchDialog onClose={close} />;
    case 'flip':
      return <FlipDialog onClose={close} />;
    case 'shortcuts':
      return (
        <Modal title="Keyboard shortcuts" onClose={close} width={520} actions={<button type="button" className="btn primary" onClick={close}>Done</button>}>
          <div className="kbd-grid">
            {SHORTCUTS.map(([keys, what]) => (
              <div className="kbd-row" key={what}>
                <span className="kbd-keys">{keys.split(' ').map((k) => <kbd key={k}>{k}</kbd>)}</span>
                <span>{what}</span>
              </div>
            ))}
          </div>
        </Modal>
      );
    case 'about':
      return (
        <Modal title="About Paint" onClose={close} actions={<button type="button" className="btn primary" onClick={close}>OK</button>}>
          <p>A minimal Paint with an AI repaint tool.</p>
          <p>Select an area, type what should be there, and OpenAI's <code>gpt-image-2.5</code> repaints only that rectangle, using the surrounding drawing as context so lines, angles and colors continue naturally.</p>
          <p>Everything runs in your browser. Your API key is kept in local storage and only ever sent to <code>api.openai.com</code>.</p>
        </Modal>
      );
    default:
      return null;
  }
}

function KeyDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const editor = useEditor();
  const s = useEditorState();
  const [mode, setMode] = useState<'choose' | 'key'>(s.apiKey && !s.oauth ? 'key' : 'choose');
  const [value, setValue] = useState(s.apiKey);
  const [show, setShow] = useState(false);
  const save = () => {
    editor.setApiKey(value);
    onClose();
  };
  const close = () => {
    editor.cancelSignIn();
    onClose();
  };

  if (s.oauth) {
    return (
      <Modal title="OpenAI account" onClose={close} actions={<button type="button" className="btn primary" onClick={close}>Done</button>}>
        <div className="acct">
          <span className="acct-dot" />
          <div>
            <div className="acct-name">{s.oauth.email ?? 'Signed in with OpenAI'}</div>
            <div className="hint">ChatGPT {s.oauth.plan ? s.oauth.plan.charAt(0).toUpperCase() + s.oauth.plan.slice(1) : ''} plan · edits use your plan's included usage</div>
          </div>
          <button type="button" className="btn" onClick={() => editor.signOutOpenAI()} data-testid="signout">Sign out</button>
        </div>
        {s.apiKey && <p className="hint">An API key is also saved; the OpenAI sign-in is used while you are signed in.</p>}
      </Modal>
    );
  }

  if (s.signIn) {
    const { code, status, message } = s.signIn;
    return (
      <Modal title="Sign in with OpenAI" onClose={close} actions={<button type="button" className="btn" onClick={close}>Cancel</button>}>
        <p>Open the OpenAI device page and enter this code. This window completes on its own once you approve.</p>
        <div className="device-code mono" data-testid="device-code" onClick={() => void navigator.clipboard?.writeText(code.userCode)} title="Click to copy">{code.userCode}</div>
        <div className="device-actions">
          <a className="btn primary" href={`${VERIFY_URL}?user_code=${encodeURIComponent(code.userCode)}`} target="_blank" rel="noopener" data-testid="device-open">Open auth.openai.com</a>
          <span className={`device-status ${status}`}>{status === 'waiting' ? <><span className="spinner" /> Waiting for approval…</> : message}</span>
        </div>
        {status === 'error' && <p className="hint"><button type="button" className="link" onClick={() => void editor.signInWithOpenAI()}>Try again</button></p>}
      </Modal>
    );
  }

  if (mode === 'key') {
    return (
      <Modal
        title="OpenAI API key"
        onClose={close}
        actions={
          <>
            {s.apiKey && <button type="button" className="btn" onClick={() => { editor.setApiKey(''); onClose(); }}>Remove</button>}
            <button type="button" className="btn" onClick={() => setMode('choose')}>Back</button>
            <button type="button" className="btn primary" onClick={save} data-testid="key-save">Save</button>
          </>
        }
      >
        <p>Paste a key with access to the Images API. It stays in this browser's local storage and goes directly to <code>api.openai.com</code> when you generate. Edits are billed to your OpenAI account.</p>
        <div className="field">
          <input
            type={show ? 'text' : 'password'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="sk-…"
            aria-label="OpenAI API key"
            autoFocus
            spellCheck={false}
            autoComplete="off"
            onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
            data-testid="key-input"
          />
          <label className="check"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show</label>
        </div>
        <p className="hint">Create one at platform.openai.com → API keys.</p>
      </Modal>
    );
  }

  return (
    <Modal title="Connect OpenAI" onClose={close} actions={<button type="button" className="btn" onClick={close}>Cancel</button>} width={460}>
      <p>AI repaints need an OpenAI account. Pick one:</p>
      <div className="connect-options">
        <button type="button" className="connect-card" onClick={() => void editor.signInWithOpenAI()} data-testid="signin-openai">
          <Icon name="logo" size={16} />
          <div>
            <div className="connect-title">Sign in with OpenAI</div>
            <div className="hint">Use your ChatGPT Plus, Pro or Team plan. No key to paste; edits count toward your plan's usage.</div>
          </div>
        </button>
        <button type="button" className="connect-card" onClick={() => setMode('key')} data-testid="use-key">
          <Icon name="key" size={16} />
          <div>
            <div className="connect-title">Use an API key</div>
            <div className="hint">Pay per image on your OpenAI API account. The key never leaves this browser.</div>
          </div>
        </button>
      </div>
    </Modal>
  );
}

function AttributesDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const editor = useEditor();
  const s = useEditorState();
  const [w, setW] = useState(String(s.docW));
  const [h, setH] = useState(String(s.docH));
  const apply = () => {
    const nw = Math.max(1, Math.min(8000, Math.round(Number(w)) || s.docW));
    const nh = Math.max(1, Math.min(8000, Math.round(Number(h)) || s.docH));
    editor.resizeCanvas(nw, nh);
    onClose();
  };
  return (
    <Modal
      title="Attributes"
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn" onClick={() => { setW('1080'); setH('1080'); }}>Default</button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" onClick={apply} data-testid="attr-ok">OK</button>
        </>
      }
    >
      <div className="field-row">
        <label>Width <input type="number" min={1} max={8000} value={w} onChange={(e) => setW(e.target.value)} data-testid="attr-width" autoFocus /></label>
        <label>Height <input type="number" min={1} max={8000} value={h} onChange={(e) => setH(e.target.value)} data-testid="attr-height" /></label>
        <span className="hint">px</span>
      </div>
      <p className="hint">Changes the canvas size without scaling the picture. You can also drag the handles on the canvas edge.</p>
    </Modal>
  );
}

function StretchDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const editor = useEditor();
  const s = useEditorState();
  const [hv, setHv] = useState('100');
  const [vv, setVv] = useState('100');
  const [keep, setKeep] = useState(true);
  const onH = (v: string) => {
    setHv(v);
    if (keep) setVv(v);
  };
  const onV = (v: string) => {
    setVv(v);
    if (keep) setHv(v);
  };
  const apply = () => {
    const w = (s.docW * Number(hv)) / 100;
    const h = (s.docH * Number(vv)) / 100;
    if (!(w >= 1) || !(h >= 1)) return;
    editor.scaleImage(Math.min(8000, w), Math.min(8000, h));
    onClose();
  };
  return (
    <Modal
      title="Stretch"
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" onClick={apply} data-testid="stretch-ok">OK</button>
        </>
      }
    >
      <div className="field-row">
        <label>Horizontal <input type="number" min={1} value={hv} onChange={(e) => onH(e.target.value)} data-testid="stretch-h" autoFocus /> %</label>
        <label>Vertical <input type="number" min={1} value={vv} onChange={(e) => onV(e.target.value)} data-testid="stretch-v" /> %</label>
      </div>
      <label className="check"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> Maintain aspect ratio</label>
      <p className="hint">Result: {Math.round((s.docW * Number(hv)) / 100) || 0} × {Math.round((s.docH * Number(vv)) / 100) || 0} px</p>
    </Modal>
  );
}

function FlipDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const editor = useEditor();
  const [mode, setMode] = useState<'fh' | 'fv' | 'r90' | 'r180' | 'r270'>('fh');
  const apply = () => {
    if (mode === 'fh') editor.flip('h');
    else if (mode === 'fv') editor.flip('v');
    else editor.rotate(mode === 'r90' ? 90 : mode === 'r180' ? 180 : 270);
    onClose();
  };
  const opt = (id: typeof mode, label: string) => (
    <label className="radio" key={id}>
      <input type="radio" name="flip" checked={mode === id} onChange={() => setMode(id)} /> {label}
    </label>
  );
  return (
    <Modal
      title="Flip and Rotate"
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" onClick={apply} data-testid="flip-ok">OK</button>
        </>
      }
    >
      <div className="radio-col">
        {opt('fh', 'Flip horizontal')}
        {opt('fv', 'Flip vertical')}
        {opt('r90', 'Rotate 90° clockwise')}
        {opt('r180', 'Rotate 180°')}
        {opt('r270', 'Rotate 90° counter-clockwise')}
      </div>
    </Modal>
  );
}
