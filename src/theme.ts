export type Theme = 'system' | 'light' | 'dark';

export function resolvedTheme(t: Theme): 'light' | 'dark' {
  if (t !== 'system') return t;
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
