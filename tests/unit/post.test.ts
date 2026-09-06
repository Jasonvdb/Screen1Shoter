// The hard rule: output PNGs are exactly preset.px, 3 channels, no alpha.
// postProcess flattens alpha against theme.background, never resizes, and
// hashes deterministically; writePreview scales to one third. sharp only.
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { SIZE_PRESETS } from '../../src/config/presets.ts';
import { defineTheme, type Dims } from '../../src/config/types.ts';
import { PREVIEW_SCALE, postProcess, writePreview } from '../../src/render/post.ts';
import { catchS1sError, makeTempDir } from '../fixtures/helpers.ts';

const iphone69 = SIZE_PRESETS['iphone-6.9'];
const ipad13 = SIZE_PRESETS['ipad-13'];
const theme = defineTheme({ background: '#102030', accent: '#6c8cff', text: '#ffffff' });

/** Opaque red RGBA PNG of `dims` whose top-left pixel is fully transparent. */
async function rgbaPng(dims: Dims): Promise<Buffer> {
  const raw = Buffer.alloc(dims.width * dims.height * 4);
  for (let i = 0; i < raw.length; i += 4) {
    raw[i] = 255;
    raw[i + 3] = 255;
  }
  raw[3] = 0; // pixel (0,0): alpha 0
  return sharp(raw, { raw: { width: dims.width, height: dims.height, channels: 4 } }).png().toBuffer();
}

describe('postProcess', () => {
  it('keeps the exact size, drops alpha and flattens transparent pixels to theme.background', async () => {
    const input = await rgbaPng(iphone69.px);
    expect((await sharp(input).metadata()).hasAlpha).toBe(true);

    const { png, dims, hash } = await postProcess(input, iphone69, theme);
    expect(dims).toEqual({ width: 1320, height: 2868 });
    const meta = await sharp(png).metadata();
    expect([meta.width, meta.height]).toEqual([1320, 2868]);
    expect(meta.channels).toBe(3);
    expect(meta.hasAlpha).toBe(false);
    expect(hash).toMatch(/^[0-9a-f]{40}$/);

    const pixels = await sharp(png).raw().toBuffer();
    expect([...pixels.subarray(0, 3)]).toEqual([0x10, 0x20, 0x30]); // flattened
    expect([...pixels.subarray(3, 6)]).toEqual([255, 0, 0]); // untouched
  });

  it('is deterministic: the same input hashes the same twice', async () => {
    const input = await rgbaPng(iphone69.px);
    const a = await postProcess(input, iphone69, theme);
    const b = await postProcess(input, iphone69, theme);
    expect(a.hash).toBe(b.hash);
    expect(a.png.equals(b.png)).toBe(true);
  });

  it('rejects a one-pixel size mismatch with dims-mismatch instead of resizing', async () => {
    const input = await rgbaPng({ width: 1320, height: 2867 });
    const error = await catchS1sError(postProcess(input, iphone69, theme));
    expect(error.code).toBe('dims-mismatch');
    expect(error.message).toContain('1320x2867');
    expect(error.message).toContain('1320x2868');
  });

  it('handles the iPad preset the same way', async () => {
    const { dims, png } = await postProcess(await rgbaPng(ipad13.px), ipad13, theme);
    expect(dims).toEqual({ width: 2064, height: 2752 });
    expect((await sharp(png).metadata()).channels).toBe(3);
  });

  it('rejects bytes that are not an image', async () => {
    const error = await catchS1sError(postProcess(Buffer.from('nope'), iphone69, theme));
    expect(error.code).toBe('render-failed');
  });
});

describe('writePreview', () => {
  it('writes a one-third-width PNG by default and rejects a zero scale', async () => {
    const tmp = await makeTempDir();
    try {
      const { png } = await postProcess(await rgbaPng(iphone69.px), iphone69, theme);
      const path = join(tmp.dir, 'preview', '01-home.png');
      await writePreview(png, path);
      const meta = await sharp(path).metadata();
      expect(PREVIEW_SCALE).toBeCloseTo(1 / 3);
      expect(meta.width).toBe(Math.round(1320 * PREVIEW_SCALE));
      expect(meta.height).toBe(956);
      expect(meta.hasAlpha).toBe(false);

      const error = await catchS1sError(writePreview(png, join(tmp.dir, 'zero.png'), 0));
      expect(error.code).toBe('usage');
    } finally {
      await tmp.cleanup();
    }
  });
});
