// Visible, error-level failure panel. data-s1s-id="error" lets the renderer
// fail the item at once and report the text; data-s1s-overflow makes
// window.__S1S.check() flag it in the sheet and gallery.
import type { CSSProperties } from 'react';

const STYLE: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  boxSizing: 'border-box',
  padding: 24,
  background: '#7f1d1d',
  color: '#fff',
  fontFamily: 'ui-monospace, Menlo, monospace',
  fontSize: 14,
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  zIndex: 10,
};

export function ErrorPanel({ title, message }: { title: string; message: string }) {
  console.error(`s1s: ${title}: ${message}`);
  return (
    <div data-s1s-id="error" data-s1s-overflow="overflow" style={STYLE}>
      <strong>{title}</strong>
      {'\n'}
      {message}
    </div>
  );
}
