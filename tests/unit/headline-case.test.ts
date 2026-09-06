// applyCase (src/web/components/Headline.tsx) is the only place theme
// headlineCase turns copy into rendered text, and it is handed the render
// locale. The small-word list of `title` is an English convention: applying
// it to a German or French headline capitalises function words.
//
// Imported through a computed specifier so the .tsx never enters the Node
// tsconfig program (same reason as tests/unit/templates.test.ts).
import { describe, expect, it } from 'vitest';
import type { HeadlineCase } from '../../src/config/types.ts';

interface HeadlineModule {
  applyCase: (text: string, mode: HeadlineCase, locale: string) => string;
}

async function loadHeadline(): Promise<HeadlineModule> {
  const name = 'Headline';
  return (await import(`../../src/web/components/${name}.tsx`)) as HeadlineModule;
}

describe('applyCase title', () => {
  it('keeps the English small words lower-case mid-line', async () => {
    const { applyCase } = await loadHeadline();
    expect(applyCase('every ride on the map', 'title', 'en-US')).toBe('Every Ride on the Map');
    expect(applyCase('a lap at a time', 'title', 'en-GB')).toBe('A Lap at a Time');
  });

  it('never lowercases, so an acronym survives', async () => {
    const { applyCase } = await loadHeadline();
    expect(applyCase('GPS for the whole ride', 'title', 'en-US')).toBe('GPS for the Whole Ride');
  });

  it('leaves a non-English headline in the case the translator wrote', async () => {
    const { applyCase } = await loadHeadline();
    expect(applyCase('Auf der Karte', 'title', 'de-DE')).toBe('Auf der Karte');
    expect(applyCase('Einmal setzen und fahren', 'title', 'de-DE')).toBe('Einmal setzen und fahren');
    expect(applyCase('sur la carte', 'title', 'fr-FR')).toBe('Sur la carte');
  });

  it('does not re-case a continuation line of a non-English array headline', async () => {
    const { applyCase } = await loadHeadline();
    expect(applyCase('Jede Runde\nauf der Karte', 'title', 'de-DE')).toBe('Jede Runde\nauf der Karte');
    // English keeps the per-line convention: each line reads as its own title.
    expect(applyCase('Every Ride\non the map', 'title', 'en-US')).toBe('Every Ride\nOn the Map');
  });
});
