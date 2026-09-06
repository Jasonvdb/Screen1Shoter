// screens.ts capture refs follow the same file-safe rule as `s1s capture --name`.
import { describe, expect, it } from 'vitest';
import { CAPTURE_NAME_RE } from '../../src/config/resolve.ts';
import { screenDefSchema, screenOverrideSchema } from '../../src/core/schemas.ts';

describe('capture refs in screens.ts', () => {
  it.each(['home', 'detail-2', 'lap_times.v2'])('accepts "%s"', (ref) => {
    expect(CAPTURE_NAME_RE.test(ref)).toBe(true);
    expect(screenDefSchema.safeParse({ id: 'x', capture: ref }).success).toBe(true);
    expect(screenDefSchema.safeParse({ id: 'x', capture: { iphone: [ref] } }).success).toBe(true);
    expect(screenOverrideSchema.safeParse({ capture: ref }).success).toBe(true);
  });

  it.each(['Home Screen', 'flows/home', '../x', '', '-lead'])('rejects "%s" (what `s1s capture --name` refuses)', (ref) => {
    expect(CAPTURE_NAME_RE.test(ref)).toBe(false);
    expect(screenDefSchema.safeParse({ id: 'x', capture: ref }).success).toBe(false);
    expect(screenDefSchema.safeParse({ id: 'x', capture: [ref] }).success).toBe(false);
    expect(screenOverrideSchema.safeParse({ capture: ref }).success).toBe(false);
  });
});
