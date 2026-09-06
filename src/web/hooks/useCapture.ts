// Capture image state: URL under /project/, load failure, and a pending token
// while a mounted <img> is in flight so the renderer waits for it. The token
// is held only while an <img> element exists: a frame that decides not to
// mount one (collapsed slot, bezel still loading) must never block readiness.
import { useLayoutEffect, useState, type RefCallback } from 'react';
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
  /** Pass as the <img> ref: the hook learns when the element mounts and unmounts. */
  ref: RefCallback<HTMLImageElement>;
  onLoad: () => void;
  onError: () => void;
}

export function useCapture(source: CaptureSource): CaptureState {
  const url = captureUrl(source);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [status, setStatus] = useState<{ url: string | null; failed: boolean }>({ url: null, failed: false });
  const settled = status.url === url;
  const failed = settled && status.failed;

  // Layout effect: the token exists before the settle loop can observe the
  // freshly mounted <img> (React ran the ref callback in the same commit).
  useLayoutEffect(() => {
    if (!url || settled || !img) return;
    if (img.complete) {
      setStatus({ url, failed: img.naturalWidth === 0 });
      return;
    }
    return acquire('capture');
  }, [url, settled, img]);

  return {
    url,
    failed,
    ref: setImg,
    onLoad: () => setStatus({ url, failed: false }),
    onError: () => setStatus({ url, failed: true }),
  };
}
