// Capture image state: URL under /project/, load failure, and a pending token
// while the image is in flight so the renderer waits for it.
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { CaptureRef, CaptureSource, DeviceFamily } from '../../config/types.ts';
import { acquire } from '../runtime/ready.ts';

export function captureUrl(source: CaptureSource): string | null {
  if (!source.resolvedPath) return null;
  return `/project/${source.resolvedPath.split('/').map(encodeURIComponent).join('/')}`;
}

export function placeholderCapture(ref: CaptureRef, family: DeviceFamily, locale: string): CaptureSource {
  return { requested: ref, family, locale, resolvedPath: null, usedLocale: locale, fallback: 'placeholder', dims: null };
}

export interface CaptureState {
  url: string | null;
  failed: boolean;
  ref: RefObject<HTMLImageElement | null>;
  onLoad: () => void;
  onError: () => void;
}

export function useCapture(source: CaptureSource): CaptureState {
  const url = captureUrl(source);
  const ref = useRef<HTMLImageElement>(null);
  const [status, setStatus] = useState<{ url: string | null; failed: boolean }>({ url: null, failed: false });
  const settled = status.url === url;
  const failed = settled && status.failed;

  useEffect(() => {
    if (!url || settled) return;
    const img = ref.current;
    if (img && img.complete) {
      setStatus({ url, failed: img.naturalWidth === 0 });
      return;
    }
    return acquire('capture');
  }, [url, settled]);

  return {
    url,
    failed,
    ref,
    onLoad: () => setStatus({ url, failed: false }),
    onError: () => setStatus({ url, failed: true }),
  };
}
