import { createContext, useContext, useEffect, useRef, useState, type JSX, type ReactNode, type RefObject } from 'react';
import { useEditor, useEditorState } from '../hooks';
import { MODELS, type ModelId, type Quality } from '../paint/ai';
import { Icon } from './Icons';
import type { WorkspaceHandle } from './Workspace';
import { resolvedTheme } from '../theme';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** One dropdown for model × quality keeps the top-right compact. */
const MODEL_PRESETS: { value: string; label: string }[] = [
  { value: 'gpt-image-2.5-flare|medium', label: 'Flare · fast' },
  { value: 'gpt-image-2.5-flare|high', label: 'Flare · high quality' },
  { value: 'gpt-image-2.5-sunburst|medium', label: 'Sunburst · precise' },
  { value: 'gpt-image-2.5-sunburst|high', label: 'Sunburst · best' },
];


const MOD = isMac ? '⌘' : 'Ctrl+';

interface MenuCtx {
  open: string | null;
  setOpen: (id: string | null) => void;
}
const Ctx = createContext<MenuCtx>({ open: null, setOpen: () => {} });

const MENU_IDS = ['file', 'edit', 'view', 'image', 'colors', 'help'];

function Menu({ id, label, children }: { id: string; label: string; children: ReactNode }): JSX.Element {
  const { open, setOpen } = useContext(Ctx);
  const isOpen = open === id;
  const popup = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const items = () => Array.from(popup.current?.querySelectorAll<HTMLButtonElement>('.menu-item:not(:disabled)') ?? []);
  useEffect(() => {
    if (isOpen) items()[0]?.focus();
  }, [isOpen]);
  const onKey = (e: React.KeyboardEvent) => {
    const list = items();
    const idx = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) setOpen(id);
      else list[(idx + 1) % list.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (isOpen) list[(idx - 1 + list.length) % list.length]?.focus();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const i = MENU_IDS.indexOf(id);
      const next = MENU_IDS[(i + (e.key === 'ArrowRight' ? 1 : MENU_IDS.length - 1)) % MENU_IDS.length];
      setOpen(next);
      (document.querySelector(`[data-menu="${next}"]`) as HTMLButtonElement | null)?.focus();
    } else if (e.key === 'Escape') {
      setOpen(null);
      btn.current?.focus();
    } else if ((e.key === 'Enter' || e.key === ' ') && e.target === btn.current) {
      e.preventDefault();
      setOpen(isOpen ? null : id);
    }
  };
  return (
    <div className={`menu ${isOpen ? 'open' : ''}`} onKeyDown={onKey}>
      <button
        ref={btn}
        type="button"
        className="menu-btn"
        data-menu={id}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onPointerDown={(e) => {
          e.preventDefault();
          setOpen(isOpen ? null : id);
        }}
        onPointerEnter={() => {
          if (open && !isOpen) setOpen(id);
        }}
      >
        {label}
      </button>
      {isOpen && (
        <div className="menu-popup" role="menu" ref={popup}>
          {children}
        </div>
      )}
    </div>
  );
}

function Item({ label, shortcut, onSelect, disabled, checked }: { label: string; shortcut?: string; onSelect: () => void; disabled?: boolean; checked?: boolean }): JSX.Element {
  const { setOpen } = useContext(Ctx);
  return (
    <button
      type="button"
      role="menuitem"
      className="menu-item"
      disabled={disabled}
      onClick={() => {
        setOpen(null);
        onSelect();
      }}
    >
      <span className="menu-check">{checked ? <Icon name="check" size={12} /> : null}</span>
      <span className="menu-label">{label}</span>
      {shortcut && <span className="menu-shortcut">{shortcut}</span>}
    </button>
  );
}

const Sep = () => <div className="menu-sep" role="separator" />;

export function MenuBar({ workspace }: { workspace: RefObject<WorkspaceHandle | null> }): JSX.Element {
  const editor = useEditor();
  const s = useEditorState();
  const [open, setOpen] = useState<string | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const colorInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (bar.current && !bar.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <Ctx.Provider value={{ open, setOpen }}>
      <div className="menubar" ref={bar}>
        <div className="brand" title="Paint">
          <Icon name="logo" size={14} />
          <span>Paint</span>
        </div>
        <Menu id="file" label="File">
          <Item label="New" shortcut={`${MOD}N`} onSelect={() => { editor.newDocument(); workspace.current?.fit(); }} />
          <Item label="Open…" shortcut={`${MOD}O`} onSelect={() => fileInput.current?.click()} />
          <Item label="Save as PNG" shortcut={`${MOD}S`} onSelect={() => void editor.save()} />
          <Item label="Export PNG @2x" shortcut={`${MOD}⇧E`} onSelect={() => editor.exportImage({ format: 'png', scale: 2 })} />
          <Item label="Export JPEG" onSelect={() => editor.exportImage({ format: 'jpeg', quality: 0.92 })} />
          <Item label="Export WebP" onSelect={() => editor.exportImage({ format: 'webp', quality: 0.9 })} />
          <Item label="Export Selection as PNG" disabled={!s.selection} onSelect={() => editor.exportImage({ format: 'png', selectionOnly: true })} />
          <Sep />
          <Item label="Attributes…" shortcut={`${MOD}E`} onSelect={() => editor.openDialog('attributes')} />
          <Item label="OpenAI API key…" onSelect={() => editor.openDialog('key')} />
        </Menu>
        <Menu id="edit" label="Edit">
          <Item label="Undo" shortcut={`${MOD}Z`} disabled={!s.canUndo && !s.pending} onSelect={() => editor.undo()} />
          <Item label="Redo" shortcut={isMac ? '⌘⇧Z' : 'Ctrl+Y'} disabled={!s.canRedo} onSelect={() => editor.redo()} />
          <Sep />
          <Item label="Cut" shortcut={`${MOD}X`} disabled={!s.selection} onSelect={() => editor.cut()} />
          <Item label="Copy" shortcut={`${MOD}C`} disabled={!s.selection} onSelect={() => editor.copy()} />
          <Item label="Copy as PNG" shortcut={`${MOD}⇧C`} onSelect={() => void editor.copyAsPng()} />
          <Item label="Paste" shortcut={`${MOD}V`} onSelect={() => void editor.pasteFromSystem(workspace.current?.viewCenter())} />
          <Item label="Clear Selection" shortcut="Del" disabled={!s.selection} onSelect={() => editor.deleteSelection()} />
          <Item label="Select All" shortcut={`${MOD}A`} onSelect={() => editor.selectAll()} />
          <Sep />
          <Item label="Crop to Selection" shortcut={`${MOD}⇧X`} disabled={!s.selection} onSelect={() => editor.crop()} />
        </Menu>
        <Menu id="view" label="View">
          <Item label="Zoom In" shortcut={`${MOD}+`} onSelect={() => workspace.current?.zoomBy(1.25)} />
          <Item label="Zoom Out" shortcut={`${MOD}−`} onSelect={() => workspace.current?.zoomBy(0.8)} />
          <Item label="Actual Size" shortcut={`${MOD}0`} onSelect={() => workspace.current?.fit(1)} />
          <Item label="Fit to Window" shortcut="⇧1" onSelect={() => workspace.current?.fit()} />
          <Item label="Zoom to Selection" shortcut="⇧2" disabled={!s.selection} onSelect={() => workspace.current?.zoomToSelection()} />
          <Sep />
          <Item label="Gridlines" checked={s.gridlines} onSelect={() => editor.setGridlines(!s.gridlines)} />
          <Item label="Drawings sidebar" checked={s.showLibrary} onSelect={() => editor.setShowLibrary(!s.showLibrary)} />
          <Item label="History strip" checked={s.showVersions} onSelect={() => editor.setShowVersions(!s.showVersions)} />
          <Sep />
          <Item label="Appearance: System" checked={s.theme === 'system'} onSelect={() => editor.setTheme('system')} />
          <Item label="Appearance: Light" checked={s.theme === 'light'} onSelect={() => editor.setTheme('light')} />
          <Item label="Appearance: Dark" checked={s.theme === 'dark'} onSelect={() => editor.setTheme('dark')} />
        </Menu>
        <Menu id="image" label="Image">
          <Item label="Flip/Rotate…" shortcut={`${MOD}R`} onSelect={() => editor.openDialog('flip')} />
          <Item label="Stretch…" shortcut={`${MOD}W`} onSelect={() => editor.openDialog('stretch')} />
          <Item label="Invert Colors" shortcut={`${MOD}I`} onSelect={() => editor.invertColors()} />
          <Item label="Attributes…" shortcut={`${MOD}E`} onSelect={() => editor.openDialog('attributes')} />
          <Item label="Clear Image" shortcut={`${MOD}⇧N`} onSelect={() => editor.clearImage()} />
          <Item label="Trim to Content" onSelect={() => editor.trimToContent()} />
          <Sep />
          <Item label="AI sees only the selection" checked={s.editMode === 'selection'} onSelect={() => editor.setEditMode('selection')} />
          <Item label="AI sees surroundings too" checked={s.editMode !== 'selection'} onSelect={() => editor.setEditMode('maskref')} />
        </Menu>
        <Menu id="colors" label="Colors">
          <Item label="Edit Colors…" onSelect={() => colorInput.current?.click()} />
          <Item label="Swap Colors" onSelect={() => editor.swapColors()} />
        </Menu>
        <Menu id="help" label="Help">
          <Item label="Keyboard Shortcuts" shortcut="?" onSelect={() => editor.openDialog('shortcuts')} />
          <Item label="About Paint" onSelect={() => editor.openDialog('about')} />
        </Menu>

        <div className="menubar-spacer" />

        <label className="model-select" title={MODELS.find((m) => m.id === s.model)?.hint}>
          <Icon name="sparkle" size={13} />
          <select value={`${s.model}|${s.quality}`} onChange={(e) => { const [m, q] = e.target.value.split('|'); editor.setModel(m as ModelId); editor.setQuality(q as Quality); }} aria-label="Image model and quality" data-testid="model-select">
            {MODEL_PRESETS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          <Icon name="chevron" size={12} className="chev" />
        </label>
        <button type="button" className="icon-btn" onClick={() => editor.setTheme(resolvedTheme(s.theme) === 'dark' ? 'light' : 'dark')} title="Toggle light / dark" aria-label="Toggle appearance" data-testid="theme-toggle">
          <Icon name={resolvedTheme(s.theme) === 'dark' ? 'sun' : 'moon'} size={14} />
        </button>
        <button type="button" className={`key-btn ${s.apiKey ? 'set' : ''}`} onClick={() => editor.openDialog('key')} title="OpenAI API key (stored only in this browser)" data-testid="key-btn">
          <Icon name="key" size={13} />
          {s.apiKey ? 'API key set' : 'Add API key'}
        </button>

        <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void editor.openFile(f).then(() => workspace.current?.fit()); e.target.value = ''; }} />
        <input ref={colorInput} type="color" className="hidden-color" value={s.color1} onChange={(e) => editor.addCustomColor(e.target.value)} aria-label="Edit colors" />
      </div>
    </Ctx.Provider>
  );
}
