export type ToolId =
  | 'freeSelect'
  | 'select'
  | 'eraser'
  | 'fill'
  | 'picker'
  | 'magnifier'
  | 'pencil'
  | 'brush'
  | 'airbrush'
  | 'text'
  | 'line'
  | 'curve'
  | 'rect'
  | 'polygon'
  | 'ellipse'
  | 'roundRect';

export interface ToolDef {
  id: ToolId;
  label: string;
  key?: string;
  hint: string;
  disabled?: boolean;
}

/** Classic Paint toolbox order (two columns, eight rows). */
export const TOOLS: ToolDef[] = [
  { id: 'freeSelect', label: 'Free-Form Select', key: 'W', hint: 'Draw around an area to select it. Then type a prompt to repaint it with AI, or drag it to move.' },
  { id: 'select', label: 'Select', key: 'S', hint: 'Drag to select a rectangle. Then type a prompt to repaint it with AI, or drag it to move.' },
  { id: 'eraser', label: 'Eraser', key: 'E', hint: 'Drag to erase to the background color.' },
  { id: 'fill', label: 'Fill With Color', key: 'F', hint: 'Click an area to fill it with the current color.' },
  { id: 'picker', label: 'Pick Color', key: 'I', hint: 'Click to pick up a color from the picture.' },
  { id: 'magnifier', label: 'Magnifier', key: 'M', hint: 'Click to zoom in; right-click to zoom out.' },
  { id: 'pencil', label: 'Pencil', key: 'P', hint: 'Drag to draw a one-pixel line.' },
  { id: 'brush', label: 'Brush', key: 'B', hint: 'Drag to paint with the selected brush shape.' },
  { id: 'airbrush', label: 'Airbrush', key: 'A', hint: 'Drag to spray paint.' },
  { id: 'text', label: 'Text', key: 'T', hint: 'Click where the text should start, then type. Ctrl+Enter to apply.' },
  { id: 'line', label: 'Line', key: 'L', hint: 'Drag to draw a straight line.' },
  { id: 'curve', label: 'Curve', key: 'C', hint: 'Drag a line, then drag up to two times to bend it.' },
  { id: 'rect', label: 'Rectangle', key: 'R', hint: 'Drag to draw a rectangle.' },
  { id: 'polygon', label: 'Polygon', key: 'G', hint: 'Drag the first side, click to add corners, double-click to finish.' },
  { id: 'ellipse', label: 'Ellipse', key: 'O', hint: 'Drag to draw an ellipse.' },
  { id: 'roundRect', label: 'Rounded Rectangle', key: 'U', hint: 'Drag to draw a rounded rectangle.' },
];

export type BrushShape = 'round' | 'square' | 'slash';
export const BRUSH_SIZES = [8, 5, 2] as const;
export const ERASER_SIZES = [4, 6, 8, 10] as const;
export const AIRBRUSH_SIZES = [8, 16, 24] as const;
export const LINE_WIDTHS = [1, 2, 3, 4, 5] as const;
export const MAGNIFIER_ZOOMS = [1, 2, 6, 8] as const;
export type FillMode = 'outline' | 'both' | 'fill';

export type ShapeKind = 'rect' | 'ellipse' | 'roundRect' | 'line';

/**
 * Default palette: 30 colors in two rows of fifteen. Row 1 is a neutral ramp plus a warm earth ramp,
 * row 2 walks the hue wheel at matched lightness (Tailwind's 500 tones, designed to sit well together).
 */
export const PALETTE_NAMED: { hex: string; name: string }[] = [
  { hex: '#000000', name: 'Black' }, { hex: '#171717', name: 'Ink' }, { hex: '#404040', name: 'Charcoal' }, { hex: '#737373', name: 'Gray' },
  { hex: '#a3a3a3', name: 'Silver' }, { hex: '#e5e5e5', name: 'Mist' }, { hex: '#ffffff', name: 'White' },
  { hex: '#451a03', name: 'Espresso' }, { hex: '#78350f', name: 'Walnut' }, { hex: '#b45309', name: 'Bronze' }, { hex: '#d97706', name: 'Ochre' },
  { hex: '#f59e0b', name: 'Amber' }, { hex: '#fcd34d', name: 'Honey' }, { hex: '#fde68a', name: 'Straw' }, { hex: '#fef3c7', name: 'Cream' },
  { hex: '#ef4444', name: 'Red' }, { hex: '#f43f5e', name: 'Rose' }, { hex: '#ec4899', name: 'Pink' }, { hex: '#d946ef', name: 'Fuchsia' },
  { hex: '#a855f7', name: 'Purple' }, { hex: '#8b5cf6', name: 'Violet' }, { hex: '#6366f1', name: 'Indigo' }, { hex: '#3b82f6', name: 'Blue' },
  { hex: '#0ea5e9', name: 'Sky' }, { hex: '#06b6d4', name: 'Cyan' }, { hex: '#14b8a6', name: 'Teal' }, { hex: '#10b981', name: 'Emerald' },
  { hex: '#22c55e', name: 'Green' }, { hex: '#84cc16', name: 'Lime' }, { hex: '#f97316', name: 'Orange' },
];
export const PALETTE: string[] = PALETTE_NAMED.map((c) => c.hex);

export const ZOOM_MIN = 0.125;
export const ZOOM_MAX = 8;

export function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}
