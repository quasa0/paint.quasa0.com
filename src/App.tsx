import { useEffect, useMemo, useRef, type JSX } from 'react';
import { ColorBox } from './components/ColorBox';
import { Dialogs } from './components/Dialogs';
import { Library } from './components/Library';
import { MenuBar } from './components/MenuBar';
import { StatusBar } from './components/StatusBar';
import { Toolbox } from './components/Toolbox';
import { Workspace, type WorkspaceHandle } from './components/Workspace';
import { EditorContext, useEditorState } from './hooks';
import { Editor } from './paint/editor';
import { TOOLS } from './paint/tools';
import { resolvedTheme } from './theme';

declare global {
  interface Window {
    /** Exposed for automated testing. */
    __paint?: Editor;
  }
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function LibraryPane(): JSX.Element | null {
  const show = useEditorState().showLibrary;
  return show ? <Library /> : null;
}

export default function App(): JSX.Element {
  const editor = useMemo(() => new Editor(), []);
  const workspace = useRef<WorkspaceHandle>(null);

  useEffect(() => {
    window.__paint = editor;
    document.title = `${editor.state.fileName} – Paint`;
    const applyTheme = () => {
      document.documentElement.dataset.theme = resolvedTheme(editor.state.theme);
    };
    applyTheme();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', applyTheme);
    const unsub = editor.subscribe(() => {
      const t = `${editor.state.fileName} – Paint`;
      if (document.title !== t) document.title = t;
      applyTheme();
    });

    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'Shift') editor.setShiftHeld(true);
      if (e.code === 'Space' && !isTyping(e.target)) {
        editor.setSpaceHeld(true);
        e.preventDefault();
        return;
      }
      if (isTyping(e.target)) {
        // Inputs own their editing shortcuts (Ctrl+Z inside the prompt edits the text, not the canvas).
        if (mod && e.key.toLowerCase() === 's') {
          e.preventDefault();
          void editor.save();
        }
        return;
      }
      const k = e.key.toLowerCase();
      if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); editor.undo(); }
      else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); editor.redo(); }
      else if (mod && k === 'a') { e.preventDefault(); editor.selectAll(); }
      else if (mod && k === 's') { e.preventDefault(); void editor.save(); }
      else if (mod && k === 'n' && e.shiftKey) { e.preventDefault(); editor.clearImage(); }
      else if (mod && k === 'n') { e.preventDefault(); editor.newDocument(); workspace.current?.fit(); }
      else if (mod && e.shiftKey && k === 'c') { e.preventDefault(); void editor.copyAsPng(); }
      else if (mod && e.shiftKey && k === 'e') { e.preventDefault(); editor.exportImage({ format: 'png', scale: 2 }); }
      else if (mod && k === 'e') { e.preventDefault(); editor.openDialog('attributes'); }
      else if (mod && k === 'w') { e.preventDefault(); editor.openDialog('stretch'); }
      else if (mod && k === 'r') { e.preventDefault(); editor.openDialog('flip'); }
      else if (mod && k === 'i') { e.preventDefault(); editor.invertColors(); }
      else if (mod && k === 'x' && e.shiftKey) { e.preventDefault(); editor.crop(); }
      else if (mod && k === 'x') { e.preventDefault(); editor.cut(); }
      else if (mod && k === 'c') { e.preventDefault(); editor.copy(); }
      else if (mod && k === 'd') { e.preventDefault(); editor.duplicateSelection(); }
      else if (!mod && e.key === '?') { e.preventDefault(); editor.openDialog('shortcuts'); }
      else if (!mod && e.shiftKey && k === 'h' && editor.state.selection) { e.preventDefault(); editor.flipSelection('h'); }
      else if (!mod && e.shiftKey && k === 'v' && editor.state.selection) { e.preventDefault(); editor.flipSelection('v'); }
      else if (!mod && k === '[' && editor.state.selection) { e.preventDefault(); editor.rotateSelection(270); }
      else if (!mod && k === ']' && editor.state.selection) { e.preventDefault(); editor.rotateSelection(90); }
      else if (!mod && e.shiftKey && e.code === 'Digit1') { e.preventDefault(); workspace.current?.fit(); }
      else if (!mod && e.shiftKey && e.code === 'Digit2') { e.preventDefault(); workspace.current?.zoomToSelection(); }
      else if (!mod && e.shiftKey && e.code === 'Digit0') { e.preventDefault(); workspace.current?.fit(1); }
      else if (mod && (k === '=' || k === '+')) { e.preventDefault(); workspace.current?.zoomBy(1.25); }
      else if (mod && k === '-') { e.preventDefault(); workspace.current?.zoomBy(0.8); }
      else if (mod && k === '0') { e.preventDefault(); workspace.current?.fit(e.shiftKey ? undefined : 1); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { if (editor.state.selection) { e.preventDefault(); editor.deleteSelection(); } }
      else if (e.key === 'Escape') {
        if (editor.state.dialog !== 'none') editor.openDialog('none');
        else if (editor.state.ai.status === 'running') editor.cancelGenerate();
        else if (editor.state.pending) editor.undo();
        else editor.deselect();
      } else if (e.key === 'Enter' && editor.state.pending === 'polygon') {
        editor.doubleClick();
      } else if (e.key === 'Enter' && editor.state.floating) {
        editor.deselect();
      } else if (e.key.startsWith('Arrow') && editor.state.selection && !mod) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        editor.nudgeSelection(e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0);
      } else if (!mod && !e.altKey) {
        const t = TOOLS.find((t) => t.key?.toLowerCase() === k && !t.disabled);
        if (t) editor.setTool(t.id);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') editor.setSpaceHeld(false);
      if (e.key === 'Shift') editor.setShiftHeld(false);
    };
    let pasteEventSeen = 0;
    const onPaste = (e: ClipboardEvent) => {
      pasteEventSeen = Date.now();
      if (isTyping(e.target) && (e.target as HTMLElement).tagName !== 'BODY') return;
      e.preventDefault();
      const at = workspace.current?.viewCenter();
      void editor.pasteFromEvent(e, at).then((ok) => {
        if (!ok) void editor.pasteFromSystem(at);
      });
    };
    // Some setups never deliver a paste event to the page (focus quirks); fall back to the async clipboard.
    const onPasteKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'v' || isTyping(e.target)) return;
      const t = Date.now();
      window.setTimeout(() => {
        if (pasteEventSeen < t) void editor.pasteFromSystem(workspace.current?.viewCenter());
      }, 200);
    };
    const onBlur = () => {
      editor.setSpaceHeld(false);
      editor.setShiftHeld(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('paste', onPaste);
    window.addEventListener('keydown', onPasteKey);
    window.addEventListener('blur', onBlur);
    return () => {
      unsub();
      mq.removeEventListener('change', applyTheme);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('keydown', onPasteKey);
      window.removeEventListener('blur', onBlur);
    };
  }, [editor]);

  return (
    <EditorContext.Provider value={editor}>
      <div className="app">
        <MenuBar workspace={workspace} />
        <div className="main">
          <Toolbox />
          <Workspace ref={workspace} />
          <LibraryPane />
        </div>
        <ColorBox />
        <StatusBar workspace={workspace} />
        <Dialogs />
      </div>
    </EditorContext.Provider>
  );
}
