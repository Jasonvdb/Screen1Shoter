// Hatched placeholder shown where a capture should be. Prints the path the
// capture step is expected to write so the fix is obvious in the preview.
import { captureRelPath } from '../../config/resolve.ts';
import type { CaptureSource } from '../../config/types.ts';

export interface MissingCaptureProps {
  source: CaptureSource;
  failed?: boolean | undefined;
  /** Replaces the default `s1s capture ...` command line. */
  hint?: string | undefined;
}

export function MissingCapture({ source, failed = false, hint }: MissingCaptureProps) {
  const expected = captureRelPath(source.locale, source.family, source.requested);
  const title = failed ? 'Capture failed to load' : 'Missing capture';
  return (
    <div
      data-s1s-id="missing-capture"
      data-s1s-capture-missing={source.requested}
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.6em',
        padding: '8%',
        textAlign: 'center',
        color: 'rgba(255,255,255,0.85)',
        background:
          'repeating-linear-gradient(45deg, rgba(255,255,255,0.05) 0 12px, rgba(255,255,255,0.12) 12px 24px), #2a2a2e',
        fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
        fontSize: 'clamp(11px, 3cqw, 18px)',
        lineHeight: 1.4,
        overflowWrap: 'anywhere',
      }}
    >
      <div style={{ fontWeight: 700, fontSize: '1.15em' }}>{title}</div>
      <div>{failed && source.resolvedPath ? source.resolvedPath : expected}</div>
      <div style={{ opacity: 0.7 }}>{hint ?? `s1s capture --name ${source.requested} --device ${source.family} --locale ${source.locale}`}</div>
    </div>
  );
}
