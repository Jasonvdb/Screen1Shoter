// The built-in template registry (src/web/templates/index.tsx) and the
// DOM-free metadata (src/config/template-meta.ts) must agree: same set of
// implemented ids, same family declarations, same compliance flag. Node
// validates screens.ts against the metadata, so a drift here would let a
// screen pass loadProject and then fail in the browser (or the reverse).
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILTIN_TEMPLATES, implementedTemplateIds, templateMeta } from '../../src/config/template-meta.ts';
import type { DeviceFamily, Dims } from '../../src/config/types.ts';
import { loadProject } from '../../src/core/project.ts';
import { REPO_ROOT, catchS1sError, makeTempDir, must, writeTempProject } from '../fixtures/helpers.ts';

const WEB_TEMPLATES = join(REPO_ROOT, 'src', 'web', 'templates');

const W6_IDS = ['bleed-bottom', 'tilted', 'watch-caption'] as const;

/** The part of TemplateModule (src/runtime/index.ts) this test reads; not imported so the Node tsconfig stays DOM-free. */
interface TemplateModule {
  id: string;
  families: DeviceFamily[];
  compliant?: boolean;
  Component: unknown;
}

/** The pure geometry `tilted.tsx` exports; same dynamic import, same reason. */
interface TiltedGeometry {
  MAX_TILT: number;
  clampTilt: (value: unknown, fallback: number) => number;
  rotatedBounds: (box: Dims, degrees: number) => Dims;
  fitRotated: (avail: Dims, aspect: number, degrees: number) => Dims;
}

/** The props a template reads; enough of TemplateProps for the pure helpers below. */
interface PropsOnly {
  screen: { props: Record<string, unknown> };
}

const withProps = (props: Record<string, unknown>): PropsOnly => ({ screen: { props } });

interface BleedBottomModule {
  deviceWidthOf: (props: PropsOnly, fallback: number) => number;
}

interface WatchCaptionModule {
  captionSideOf: (props: PropsOnly) => 'top' | 'bottom';
  captureFitOf: (props: PropsOnly) => 'cover' | 'contain';
}

/** Ids listed in BUILTIN_TEMPLATE_MODULES, resolved through the file's default imports. */
async function registeredIds(): Promise<string[]> {
  const source = await readFile(join(WEB_TEMPLATES, 'index.tsx'), 'utf8');
  const byLocalName = new Map<string, string>();
  for (const match of source.matchAll(/import\s+(\w+)\s+from\s+'\.\/([\w-]+)\.tsx'/g)) {
    byLocalName.set(match[1] ?? '', match[2] ?? '');
  }
  const list = /BUILTIN_TEMPLATE_MODULES[^=]*=\s*\[([^\]]*)\]/.exec(source)?.[1] ?? '';
  return list
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
    .map((name) => {
      const id = byLocalName.get(name);
      if (id === undefined) throw new Error(`index.tsx registers "${name}" without a default import from ./<id>.tsx`);
      return id;
    });
}

async function loadTemplate(id: string): Promise<TemplateModule> {
  const mod = (await import(`../../src/web/templates/${id}.tsx`)) as { default: TemplateModule };
  return mod.default;
}

async function loadTiltedGeometry(): Promise<TiltedGeometry> {
  const id = 'tilted';
  return (await import(`../../src/web/templates/${id}.tsx`)) as TiltedGeometry;
}

async function loadBleedBottom(): Promise<BleedBottomModule> {
  const id = 'bleed-bottom';
  return (await import(`../../src/web/templates/${id}.tsx`)) as BleedBottomModule;
}

async function loadWatchCaption(): Promise<WatchCaptionModule> {
  const id = 'watch-caption';
  return (await import(`../../src/web/templates/${id}.tsx`)) as WatchCaptionModule;
}

describe('template registry vs template-meta', () => {
  it('registers exactly the implemented ids', async () => {
    const registered = await registeredIds();
    expect([...registered].sort()).toEqual([...implementedTemplateIds()].sort());
    expect(new Set(registered).size).toBe(registered.length);
  });

  it('every implemented module declares the id, families and compliance of its metadata', async () => {
    for (const meta of BUILTIN_TEMPLATES.filter((t) => t.implemented)) {
      const module = await loadTemplate(meta.id);
      expect(module.id, meta.id).toBe(meta.id);
      expect(module.families, meta.id).toEqual(meta.families);
      expect(module.compliant ?? true, meta.id).toBe(meta.compliant);
      expect(typeof module.Component, meta.id).toBe('function');
    }
  });

  it('W2 templates: two-device is iPhone + iPad, feature-grid is iPad only', () => {
    expect(templateMeta('two-device')).toMatchObject({ implemented: true, phase: 'W2', families: ['iphone', 'ipad'] });
    expect(templateMeta('feature-grid')).toMatchObject({ implemented: true, phase: 'W2', families: ['ipad'] });
  });

  it('W6 templates: bleed-bottom and tilted are opt-in, watch-caption is watch only', () => {
    expect(templateMeta('bleed-bottom')).toMatchObject({ implemented: true, phase: 'W6', compliant: false, families: ['iphone', 'ipad'] });
    expect(templateMeta('tilted')).toMatchObject({ implemented: true, phase: 'W6', compliant: false, families: ['iphone', 'ipad'] });
    expect(templateMeta('watch-caption')).toMatchObject({ implemented: true, phase: 'W6', compliant: true, families: ['watch'] });
  });

  it('the registry exposes the three W6 templates with their metadata families and compliance', async () => {
    const registered = await registeredIds();
    for (const id of W6_IDS) {
      expect(registered, id).toContain(id);
      const meta = must(templateMeta(id), id);
      const module = await loadTemplate(id);
      expect(module.id, id).toBe(id);
      expect(module.families, id).toEqual(meta.families);
      expect(module.compliant ?? true, id).toBe(meta.compliant);
    }
  });
});

// The rotated device must stay inside the canvas: the template shrinks it
// until its rotated bounding box fits the slot, so the arithmetic is where a
// clipped render would come from.
describe('tilted geometry', () => {
  it('clampTilt keeps a number inside +-MAX_TILT and falls back otherwise', async () => {
    const { MAX_TILT, clampTilt } = await loadTiltedGeometry();
    expect(clampTilt(-8, -8)).toBe(-8);
    expect(clampTilt(0, -8)).toBe(0);
    expect(clampTilt(90, -8)).toBe(MAX_TILT);
    expect(clampTilt(-90, -8)).toBe(-MAX_TILT);
    for (const value of ['12', null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(clampTilt(value, -8), String(value)).toBe(-8);
    }
  });

  it('rotatedBounds grows both sides and ignores the sign of the angle', async () => {
    const { rotatedBounds } = await loadTiltedGeometry();
    const box = { width: 300, height: 600 };
    expect(rotatedBounds(box, 0)).toEqual(box);
    const tilted = rotatedBounds(box, -8);
    expect(tilted).toEqual(rotatedBounds(box, 8));
    expect(tilted.width).toBeGreaterThan(box.width);
    expect(tilted.height).toBeGreaterThan(box.height);
    // 90 degrees swaps the sides.
    const quarter = rotatedBounds(box, 90);
    expect(quarter.width).toBeCloseTo(box.height, 6);
    expect(quarter.height).toBeCloseTo(box.width, 6);
  });

  it('fitRotated returns a device whose rotated bounds fit the slot', async () => {
    const { fitRotated, rotatedBounds } = await loadTiltedGeometry();
    const avail = { width: 380, height: 700 };
    const aspect = 0.4603; // iPhone 17 Pro Max deviceRect
    for (const degrees of [0, -8, 8, -20, 20, 3.5]) {
      const device = fitRotated(avail, aspect, degrees);
      expect(device.width / device.height, `${degrees}`).toBeCloseTo(aspect, 6);
      const bounds = rotatedBounds(device, degrees);
      expect(bounds.width, `${degrees}`).toBeLessThanOrEqual(avail.width);
      expect(bounds.height, `${degrees}`).toBeLessThanOrEqual(avail.height);
      // Touches one side: the box is the largest that fits, not merely a safe one.
      expect(Math.max(bounds.width / avail.width, bounds.height / avail.height), `${degrees}`).toBeGreaterThan(0.99);
    }
  });

  it('fitRotated shrinks as the tilt grows and refuses a degenerate box', async () => {
    const { fitRotated } = await loadTiltedGeometry();
    const avail = { width: 380, height: 700 };
    const upright = fitRotated(avail, 0.4603, 0);
    expect(upright.width).toBe(Math.floor(0.4603 * avail.height)); // 0 degrees = a plain contain fit
    expect(fitRotated(avail, 0.4603, 8).width).toBeLessThan(upright.width);
    expect(fitRotated(avail, 0.4603, 20).width).toBeLessThan(fitRotated(avail, 0.4603, 8).width);
    expect(fitRotated(avail, 0, -8)).toEqual({ width: 0, height: 0 });
    expect(fitRotated({ width: Number.POSITIVE_INFINITY, height: 700 }, 0.4603, -8)).toEqual({ width: 0, height: 0 });
  });
});

describe('loadProject and the W6 templates', () => {
  it('accepts the three opt-in templates now that they are implemented', async () => {
    const tmp = await makeTempDir();
    try {
      const dir = await writeTempProject(join(tmp.dir, 'screenshots'), {
        screens: {
          sizes: ['iphone-6.9', 'ipad-13', 'watch-s10'],
          screens: [
            { id: 'bleed', template: 'bleed-bottom', only: ['iphone', 'ipad'] },
            { id: 'lean', template: 'tilted', props: { rotate: -12 }, only: ['iphone', 'ipad'] },
            { id: 'wrist', template: 'watch-caption', only: ['watch'] },
          ],
        },
      });
      const project = await loadProject({ projectDir: dir });
      expect(project.screens.screens.map((s) => s.template)).toEqual(['bleed-bottom', 'tilted', 'watch-caption']);
    } finally {
      await tmp.cleanup();
    }
  });

  it('rejects watch-caption on an iPhone size (watch layout only)', async () => {
    const tmp = await makeTempDir();
    try {
      const dir = await writeTempProject(join(tmp.dir, 'screenshots'), {
        screens: { sizes: ['iphone-6.9'], screens: [{ id: 'wrist', template: 'watch-caption' }] },
      });
      const error = await catchS1sError(loadProject({ projectDir: dir }));
      expect(error.code).toBe('config-invalid');
      expect(error.message).toContain('template "watch-caption" has no iphone layout');
    } finally {
      await tmp.cleanup();
    }
  });
});

describe('loadProject and the W2 templates', () => {
  it('rejects feature-grid as the base template of an iPhone + iPad screen', async () => {
    const tmp = await makeTempDir();
    try {
      const dir = await writeTempProject(join(tmp.dir, 'screenshots'), {
        screens: { sizes: ['iphone-6.9', 'ipad-13'], screens: [{ id: 'grid', template: 'feature-grid' }] },
      });
      const error = await catchS1sError(loadProject({ projectDir: dir }));
      expect(error.code).toBe('config-invalid');
      expect(error.message).toContain('template "feature-grid" has no iphone layout');
    } finally {
      await tmp.cleanup();
    }
  });

  it('accepts feature-grid through overrides.ipad and two-device with two captures', async () => {
    const tmp = await makeTempDir();
    try {
      const dir = await writeTempProject(join(tmp.dir, 'screenshots'), {
        screens: {
          sizes: ['iphone-6.9', 'ipad-13'],
          screens: [
            { id: 'grid', template: 'hero-top-text', overrides: { ipad: { template: 'feature-grid' } } },
            { id: 'pair', template: 'two-device', capture: ['home', 'detail'] },
          ],
        },
      });
      const project = await loadProject({ projectDir: dir });
      expect(project.screens.screens.map((s) => s.id)).toEqual(['grid', 'pair']);
    } finally {
      await tmp.cleanup();
    }
  });

  it('rejects a capture count the template cannot use (two-device with one, hero-top-text with two)', async () => {
    const tmp = await makeTempDir();
    try {
      const dir = await writeTempProject(join(tmp.dir, 'screenshots'), {
        screens: {
          sizes: ['iphone-6.9'],
          screens: [
            { id: 'compare', template: 'two-device' },
            { id: 'home', template: 'hero-top-text', capture: ['home', 'detail'] },
          ],
        },
      });
      const error = await catchS1sError(loadProject({ projectDir: dir }));
      expect(error.code).toBe('config-invalid');
      expect(error.message).toContain('screen "compare": template "two-device" needs capture: [a, b] (got 1)');
      expect(error.message).toContain('screen "home": template "hero-top-text" needs capture: "<name>" (got 2)');
    } finally {
      await tmp.cleanup();
    }
  });
});

// The bleed is the whole point of the template, and `deviceWidth` is the one
// knob that can lose it: below the threshold the frame fits inside the slot,
// so only a bottom-aligned frame still touches the canvas edge.
describe('bleed-bottom geometry', () => {
  /** iphone-6.9: canvas 440x956 pt, padTop 54, text slot 172, gap 24. */
  const SLOT_HEIGHT = 956 - 54 - 172 - 24;
  const CANVAS_WIDTH = 440;
  /** deviceRect aspect of the iPhone 17 Pro Max bezel. */
  const ASPECT = 0.4826;

  it('falls back to 1 for every deviceWidth outside (0, 1]', async () => {
    const { deviceWidthOf } = await loadBleedBottom();
    expect(deviceWidthOf(withProps({ deviceWidth: 0.6 }), 1)).toBe(0.6);
    expect(deviceWidthOf(withProps({ deviceWidth: 1 }), 1)).toBe(1);
    for (const value of [0, -1, 1.5, '0.6', null, Number.NaN]) {
      expect(deviceWidthOf(withProps({ deviceWidth: value }), 1), String(value)).toBe(1);
    }
    expect(deviceWidthOf(withProps({}), 1)).toBe(1);
  });

  it('fills the slot at deviceWidth 1 and no longer reaches its bottom below ~0.78', async () => {
    const { frameBox } = await import('../../src/web/hooks/bezel.ts');
    const geometry = {
      deviceRect: { x: 0, y: 0, width: ASPECT * 1000, height: 1000 },
      screenRect: { x: 10, y: 10, width: ASPECT * 1000 - 20, height: 980 },
      imageSize: { width: ASPECT * 1000, height: 1000 },
      cornerRadius: 40,
    };
    const boxAt = (deviceWidth: number): Dims =>
      frameBox(geometry, { width: Math.round(deviceWidth * CANVAS_WIDTH), height: SLOT_HEIGHT }, 'bottom');
    // Full width: the frame is taller than the slot, so it is clipped at the
    // slot's bottom edge (= the canvas edge) whatever the alignment.
    expect(boxAt(1).height).toBe(SLOT_HEIGHT);
    // The threshold: below it the frame fits, and only `align="end"` keeps it
    // on the canvas edge.
    const threshold = (SLOT_HEIGHT * ASPECT) / CANVAS_WIDTH;
    expect(threshold).toBeGreaterThan(0.75);
    expect(threshold).toBeLessThan(0.8);
    expect(boxAt(0.6).height).toBeLessThan(SLOT_HEIGHT);
  });
});

describe('watch-caption props', () => {
  it('reads captionSide, defaulting below the capture', async () => {
    const { captionSideOf } = await loadWatchCaption();
    expect(captionSideOf(withProps({ captionSide: 'top' }))).toBe('top');
    expect(captionSideOf(withProps({ captionSide: 'bottom' }))).toBe('bottom');
    expect(captionSideOf(withProps({}))).toBe('bottom');
  });

  // The capture box is wider than a 416x496 capture, so the default `cover`
  // cuts the bottom of the watch screen away; 'contain' is the escape hatch
  // `raw` has had all along.
  it('reads fit, defaulting to cover', async () => {
    const { captureFitOf } = await loadWatchCaption();
    expect(captureFitOf(withProps({ fit: 'contain' }))).toBe('contain');
    expect(captureFitOf(withProps({ fit: 'cover' }))).toBe('cover');
    expect(captureFitOf(withProps({ fit: 'nonsense' }))).toBe('cover');
    expect(captureFitOf(withProps({}))).toBe('cover');
  });
});
