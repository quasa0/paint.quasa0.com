import { createContext, useContext, useSyncExternalStore } from 'react';
import type { Editor, EditorState } from './paint/editor';

export const EditorContext = createContext<Editor | null>(null);

export function useEditor(): Editor {
  const e = useContext(EditorContext);
  if (!e) throw new Error('EditorContext missing');
  return e;
}

export function useEditorState(): EditorState {
  const e = useEditor();
  return useSyncExternalStore(e.subscribe, e.getState, e.getState);
}
