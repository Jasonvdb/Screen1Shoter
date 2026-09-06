// The two-device stack must show the back device's whole status bar and
// Dynamic Island (the front device starts below them), leave at least half
// of the back device visible, and fit the row under the text block on every
// iPhone and iPad preset. Checked against the bezel facts in sources.ts.
import { describe, expect, it } from 'vitest';
import { SIZE_PRESETS } from '../../src/config/presets.ts';
import type { SizePreset } from '../../src/config/types.ts';
import { BEZEL_SOURCES, isBezelSourceId } from '../../src/core/bezels/sources.ts';
import { LAYOUT, stackGeometry } from '../../src/web/templates/two-device-layout.ts';

/** Same rule as layoutScale(): 1 at 440 pt (iPhone) / 1032 pt (iPad). */
const scaleOf = (preset: SizePreset): number => preset.pt.width / (preset.family === 'ipad' ? 1032 : 440);
/** Status bar height in pt of the capture (iOS 26 iPhone ~54, iPad ~24). */
const STATUS_BAR_PT = { iphone: 54, ipad: 24 };

describe('two-device stack geometry', () => {
  const presets = Object.values(SIZE_PRESETS).filter((p) => !p.aliasOf && (p.family === 'iphone' || p.family === 'ipad'));
  expect(presets.length).toBeGreaterThanOrEqual(5);

  for (const preset of presets) {
    const family = preset.family === 'ipad' ? 'ipad' : 'iphone';
    const bezelId = preset.bezel;
    if (!isBezelSourceId(bezelId)) continue;
    const facts = BEZEL_SOURCES[bezelId];
    const { deviceRect, islandRect } = facts.portrait;

    it(`${preset.id}: front device clears the island and status bar, back device at least half visible, pair fits the row`, () => {
      const g = stackGeometry(LAYOUT[family], preset.pt, scaleOf(preset), deviceRect.width / deviceRect.height);
      const k = g.deviceWidth / deviceRect.width; // CSS px per bezel px
      const islandBottom = islandRect ? (islandRect.y + islandRect.height - deviceRect.y) * k : 0;
      const statusBar = (facts.pxPerPt ?? 1) * STATUS_BAR_PT[family] * k;
      expect(g.offsetY, 'island').toBeGreaterThan(islandBottom + 8);
      expect(g.offsetY, 'status bar').toBeGreaterThan(statusBar + 8);
      expect(g.visible, 'visible fraction of the back device').toBeGreaterThanOrEqual(0.5);
      expect(g.pairHeight, 'pair height vs row').toBeLessThanOrEqual(g.rowHeight);
      // Not wastefully small either: the pair uses at least 80% of the row.
      expect(g.pairHeight / g.rowHeight, 'row usage').toBeGreaterThan(0.8);
    });
  }
});
