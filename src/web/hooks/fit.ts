// Pure core of useFitText (DOM-free; unit-tested under Node).
//
// Binary search for the largest integer pt in [minPt, maxPt] that `fits`
// accepts. `fits` must be monotonic: if pt fits, every smaller pt fits.
// Measures maxPt first (the common case costs one layout), then minPt, then
// bisects: about log2(range) + 2 layouts.

export interface ChooseSizeInput {
  minPt: number;
  maxPt: number;
  fits: (pt: number) => boolean;
}

export interface ChooseSizeResult {
  /** Largest fitting size; minPt when nothing fits. */
  pt: number;
  /** true only when even minPt does not fit (-> data-s1s-overflow="text-min-size"). */
  overflow: boolean;
  /** How many times `fits` was called. */
  measurements: number;
}

export function chooseSize({ minPt, maxPt, fits }: ChooseSizeInput): ChooseSizeResult {
  const min = Math.round(Math.min(minPt, maxPt));
  const max = Math.round(Math.max(minPt, maxPt));
  let measurements = 0;
  const measure = (pt: number): boolean => {
    measurements += 1;
    return fits(pt);
  };
  if (measure(max)) return { pt: max, overflow: false, measurements };
  if (max === min || !measure(min)) return { pt: min, overflow: true, measurements };
  let lo = min; // fits
  let hi = max - 1; // max does not fit
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(mid)) lo = mid;
    else hi = mid - 1;
  }
  return { pt: lo, overflow: false, measurements };
}
