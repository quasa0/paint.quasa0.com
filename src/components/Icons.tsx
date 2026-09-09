import type { JSX } from 'react';

export type IconName =
  | 'freeSelect' | 'select' | 'eraser' | 'fill' | 'picker' | 'magnifier' | 'pencil' | 'brush' | 'airbrush' | 'text'
  | 'line' | 'curve' | 'rect' | 'polygon' | 'ellipse' | 'roundRect'
  | 'sparkle' | 'key' | 'check' | 'chevron' | 'undo' | 'redo' | 'close' | 'logo' | 'swap' | 'sun' | 'moon' | 'plus'
  | 'alignLeft' | 'alignCenterH' | 'alignRight' | 'alignTop' | 'alignMiddle' | 'alignBottom' | 'center' | 'flipH' | 'flipV' | 'rotateCw' | 'rotateCcw' | 'duplicate' | 'trash' | 'crop' | 'fit' | 'copyPng' | 'download';

const paths: Record<IconName, JSX.Element> = {
  freeSelect: <path d="M3.5 6.5c0-2 2-3.5 4.5-3.5s5 1.5 5 3.5c0 1.5-1.5 2-2.5 3S9 12.5 7.5 13 3.5 11 3.5 6.5z" strokeDasharray="2 1.5" />,
  select: <rect x="2.5" y="2.5" width="11" height="11" strokeDasharray="2.2 1.6" />,
  eraser: (
    <>
      <path d="M2.5 10.5l6-6a1.4 1.4 0 0 1 2 0l3 3a1.4 1.4 0 0 1 0 2l-3.5 3.5H6l-3.5-3.5z" />
      <path d="M6 7l5 5" />
      <path d="M8 14h6" />
    </>
  ),
  fill: (
    <>
      <path d="M6 2.5l6.5 6.5-4.5 4.5L2.5 8z" />
      <path d="M2.5 8h7" />
      <path d="M13 10c0 0 1.5 1.8 1.5 2.6a1.5 1.5 0 0 1-3 0C11.5 11.8 13 10 13 10z" />
    </>
  ),
  picker: (
    <>
      <path d="M9.5 4.5l2 2-6 6-3 1 1-3z" />
      <path d="M10.5 3.5l1-1a1.4 1.4 0 0 1 2 2l-1 1" />
    </>
  ),
  magnifier: (
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L14 14" />
    </>
  ),
  pencil: (
    <>
      <path d="M2.5 13.5l1-4 7.5-7.5 3 3-7.5 7.5z" />
      <path d="M9.5 3.5l3 3" />
    </>
  ),
  brush: (
    <>
      <path d="M13.5 2.5l-6.5 7 1.5 1.5 7-6.5z" />
      <path d="M7 9.5c-2 0-3 1-3 2.5 0 1-0.5 1.5-1.5 2 3 0.5 5.5-0.5 5.5-3z" />
    </>
  ),
  airbrush: (
    <>
      <path d="M9 3.5h3v2H9zM10.5 5.5v8" />
      <path d="M8 8.5h5v4H8z" />
      <path d="M3 4.5h.01M5.5 3h.01M5 6h.01M3 8h.01M6 9h.01" strokeWidth="1.6" />
    </>
  ),
  text: <path d="M3 3.5h10M8 3.5v9M6 12.5h4" />,
  line: <path d="M2.5 13.5l11-11" />,
  curve: <path d="M2.5 13.5c1-8 4-8 5.5-4s4 4 5.5-7" />,
  rect: <rect x="2.5" y="3.5" width="11" height="9" />,
  polygon: <path d="M3 11.5l2.5-8 5 3 3-1.5-1 8.5z" />,
  ellipse: <ellipse cx="8" cy="8" rx="5.5" ry="4.2" />,
  roundRect: <rect x="2.5" y="3.5" width="11" height="9" rx="2.5" />,
  sparkle: (
    <>
      <path d="M8 2l1.4 3.6L13 7l-3.6 1.4L8 12l-1.4-3.6L3 7l3.6-1.4z" />
      <path d="M13 11l.6 1.4 1.4.6-1.4.6L13 15l-.6-1.4-1.4-.6 1.4-.6z" />
    </>
  ),
  key: (
    <>
      <circle cx="6" cy="6.5" r="3.5" />
      <path d="M8.5 9l5 5M11.5 12l1.5-1.5" />
    </>
  ),
  check: <path d="M3 8.5l3 3 7-7" />,
  chevron: <path d="M4 6l4 4 4-4" />,
  undo: <path d="M3 6.5h6.5a3 3 0 0 1 0 6H6M5.5 3.5l-3 3 3 3" />,
  redo: <path d="M13 6.5H6.5a3 3 0 0 0 0 6H10M10.5 3.5l3 3-3 3" />,
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  logo: <path d="M8 2.5l6 11H2z" fill="currentColor" stroke="none" />,
  swap: <path d="M3 5.5h8l-2.5-2.5M13 10.5H5l2.5 2.5" />,
  sun: (
    <>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
    </>
  ),
  moon: <path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z" />,
  plus: <path d="M8 3v10M3 8h10" strokeWidth="1.5" />,
  alignLeft: (<><path d="M2.5 2v12" strokeWidth="1.5" /><rect x="4.5" y="4" width="8" height="3" /><rect x="4.5" y="9" width="5" height="3" /></>),
  alignCenterH: (<><path d="M8 2v12" strokeWidth="1.5" /><rect x="3" y="4" width="10" height="3" /><rect x="5" y="9" width="6" height="3" /></>),
  alignRight: (<><path d="M13.5 2v12" strokeWidth="1.5" /><rect x="3.5" y="4" width="8" height="3" /><rect x="6.5" y="9" width="5" height="3" /></>),
  alignTop: (<><path d="M2 2.5h12" strokeWidth="1.5" /><rect x="4" y="4.5" width="3" height="8" /><rect x="9" y="4.5" width="3" height="5" /></>),
  alignMiddle: (<><path d="M2 8h12" strokeWidth="1.5" /><rect x="4" y="3" width="3" height="10" /><rect x="9" y="5" width="3" height="6" /></>),
  alignBottom: (<><path d="M2 13.5h12" strokeWidth="1.5" /><rect x="4" y="3.5" width="3" height="8" /><rect x="9" y="6.5" width="3" height="5" /></>),
  center: (<><rect x="2.5" y="2.5" width="11" height="11" /><rect x="6" y="6" width="4" height="4" fill="currentColor" stroke="none" /></>),
  flipH: (<><path d="M8 2v12" strokeDasharray="2 1.5" /><path d="M6 4L2.5 8 6 12z" /><path d="M10 4l3.5 4L10 12z" fill="currentColor" /></>),
  flipV: (<><path d="M2 8h12" strokeDasharray="2 1.5" /><path d="M4 6L8 2.5 12 6z" /><path d="M4 10l4 3.5 4-3.5z" fill="currentColor" /></>),
  rotateCw: (<><path d="M12.5 8A4.5 4.5 0 1 1 8 3.5h2" /><path d="M8.5 1.5l2 2-2 2" /></>),
  rotateCcw: (<><path d="M3.5 8A4.5 4.5 0 1 0 8 3.5H6" /><path d="M7.5 1.5l-2 2 2 2" /></>),
  duplicate: (<><rect x="2.5" y="2.5" width="8" height="8" /><path d="M5.5 13.5h8v-8" /></>),
  trash: (<><path d="M3 4.5h10M6 4.5v-2h4v2M4.5 4.5l.7 9h5.6l.7-9" /></>),
  crop: <path d="M5 1v10h10M1 5h10v10" />,
  copyPng: (<><rect x="2.5" y="2.5" width="8" height="8" rx="1" /><path d="M5.5 13.5h8v-8" /><path d="M4 8.5l2-2 2 2 1.5-1.5 1 1" /></>),
  download: <path d="M8 2v8M4.5 6.5L8 10l3.5-3.5M3 13.5h10" />,
  fit: (<><rect x="2.5" y="2.5" width="11" height="11" /><path d="M5.5 5.5h5v5h-5z" strokeDasharray="1.5 1" /></>),
};

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}
