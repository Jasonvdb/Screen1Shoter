// chooseSize: the pure core of useFitText. Binary search for the largest
// integer pt in [minPt, maxPt] at which a measurer reports the text fits.
// Contract (src/web/hooks/fit.ts, DOM-free so this Node test can import it):
//   chooseSize({ minPt, maxPt, fits: (pt) => boolean })
//     -> { pt, overflow, measurements }
//   - pt: largest fitting size; minPt when nothing fits
//   - overflow: true only when even minPt does not fit (-> data-s1s-overflow="text-min-size")
//   - measurements: how many times `fits` was called
import { describe, expect, it, vi } from 'vitest';
import { chooseSize } from '../../src/web/hooks/fit.ts';

/** Measurer that fits at or below `threshold` pt. */
const fitsUpTo = (threshold: number) => (pt: number): boolean => pt <= threshold;

describe('chooseSize', () => {
  it('returns maxPt when the text already fits at the maximum, measuring max first', () => {
    const fits = vi.fn(fitsUpTo(100));
    const result = chooseSize({ minPt: 20, maxPt: 64, fits });
    expect(result).toMatchObject({ pt: 64, overflow: false });
    expect(fits.mock.calls[0]?.[0]).toBe(64);
    expect(result.measurements).toBe(fits.mock.calls.length);
    expect(result.measurements).toBeLessThanOrEqual(2);
  });

  it('shrinks to the largest fitting integer size', () => {
    const fits = vi.fn(fitsUpTo(37));
    const result = chooseSize({ minPt: 20, maxPt: 64, fits });
    expect(result.pt).toBe(37);
    expect(result.overflow).toBe(false);
    expect(fits).toHaveBeenCalledWith(37);
  });

  it('uses a binary search: about log2(range) layouts, not a linear scan', () => {
    const fits = vi.fn(fitsUpTo(23));
    const result = chooseSize({ minPt: 12, maxPt: 140, fits });
    expect(result.pt).toBe(23);
    const bound = Math.ceil(Math.log2(140 - 12 + 1)) + 2;
    expect(result.measurements).toBeLessThanOrEqual(bound);
    expect(fits).toHaveBeenCalledTimes(result.measurements);
  });

  it('hits minPt and reports overflow when nothing fits, after actually measuring minPt', () => {
    const fits = vi.fn(fitsUpTo(5));
    const result = chooseSize({ minPt: 20, maxPt: 64, fits });
    expect(result).toMatchObject({ pt: 20, overflow: true });
    expect(fits).toHaveBeenCalledWith(20);
  });

  it('returns minPt without overflow when only minPt fits', () => {
    const result = chooseSize({ minPt: 20, maxPt: 64, fits: fitsUpTo(20) });
    expect(result).toMatchObject({ pt: 20, overflow: false });
  });

  it('handles a degenerate range (minPt === maxPt)', () => {
    expect(chooseSize({ minPt: 30, maxPt: 30, fits: fitsUpTo(30) })).toMatchObject({ pt: 30, overflow: false });
    expect(chooseSize({ minPt: 30, maxPt: 30, fits: fitsUpTo(29) })).toMatchObject({ pt: 30, overflow: true });
  });

  it('only measures integer sizes inside [minPt, maxPt]', () => {
    const seen: number[] = [];
    chooseSize({
      minPt: 17,
      maxPt: 91,
      fits: (pt: number) => {
        seen.push(pt);
        return pt <= 40;
      },
    });
    expect(seen.length).toBeGreaterThan(0);
    for (const pt of seen) {
      expect(Number.isInteger(pt)).toBe(true);
      expect(pt).toBeGreaterThanOrEqual(17);
      expect(pt).toBeLessThanOrEqual(91);
    }
  });

  it('matches a brute-force search for every threshold in and around the range', () => {
    const minPt = 14;
    const maxPt = 72;
    for (let threshold = minPt - 1; threshold <= maxPt + 1; threshold += 1) {
      const result = chooseSize({ minPt, maxPt, fits: fitsUpTo(threshold) });
      const expectedPt = Math.max(minPt, Math.min(maxPt, threshold));
      const expectedOverflow = threshold < minPt;
      expect(result.pt, `threshold ${threshold}`).toBe(expectedPt);
      expect(result.overflow, `threshold ${threshold}`).toBe(expectedOverflow);
    }
  });
});
