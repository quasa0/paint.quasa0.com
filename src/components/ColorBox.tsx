import { useRef, useState, type JSX } from 'react';
import { useEditor, useEditorState } from '../hooks';
import { PALETTE_NAMED } from '../paint/tools';
import { Icon } from './Icons';

const normalizeHex = (v: string): string | null => {
  const t = v.trim().replace(/^#?/, '#');
  if (/^#[0-9a-f]{6}$/i.test(t)) return t.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(t)) return ('#' + t.slice(1).split('').map((c) => c + c).join('')).toLowerCase();
  return null;
};

export function ColorBox(): JSX.Element {
  const editor = useEditor();
  const s = useEditorState();
  const colorInput = useRef<HTMLInputElement>(null);
  // Local draft while typing; falls back to the live color when not editing.
  const [draft, setDraft] = useState<string | null>(null);
  const hex = draft ?? s.color1;
  const commitHex = () => {
    const v = normalizeHex(hex);
    if (v) editor.addCustomColor(v);
    setDraft(null);
  };
  const swatch = (c: string, key: string, name?: string) => (
    <button
      key={key}
      type="button"
      className={`swatch ${s.color1 === c ? 'active' : ''}`}
      style={{ background: c }}
      data-tip={`${name ? `${name} ` : ''}${c} · right-click for Color 2`}
      aria-label={name ? `${name} ${c}` : c}
      onClick={(e) => editor.pickPalette(c, e.button)}
      onContextMenu={(e) => {
        e.preventDefault();
        editor.pickPalette(c, 2);
      }}
    />
  );
  return (
    <div className="colorbox" data-testid="colorbox">
      <button type="button" className="current-colors" data-tip="Color 1 over Color 2 · click to swap" onClick={() => editor.swapColors()} data-testid="current-colors">
        <span className="cur bg" style={{ background: s.color2 }} data-testid="color2" />
        <span className="cur fg" style={{ background: s.color1 }} data-testid="color1" />
      </button>
      <div className="palette" role="group" aria-label="Colors">
        {PALETTE_NAMED.map((c, i) => swatch(c.hex, `p${i}`, c.name))}
      </div>
      <div className="palette custom" role="group" aria-label="Your colors">
        {s.customColors.map((c, i) => swatch(c, `c${i}`))}
        <button type="button" className="swatch add" data-tip="Add a color" aria-label="Add a custom color" onClick={() => colorInput.current?.click()}>
          <Icon name="plus" size={12} />
        </button>
      </div>
      <input ref={colorInput} type="color" className="hidden-color" value={s.color1} onChange={(e) => editor.addCustomColor(e.target.value)} aria-label="Custom color" />
      <div className="colorbox-hex" data-testid="color-hex">
        <input
          className="hex-input mono"
          value={hex}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitHex}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          aria-label="Color 1 hex"
          spellCheck={false}
          data-testid="hex-input"
        />
        <span className="dim">{s.color2}</span>
      </div>
    </div>
  );
}
