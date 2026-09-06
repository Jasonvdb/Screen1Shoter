// The Math.random seed is a pure function of the hash route.
import { describe, expect, it } from 'vitest';
import { seedFor } from '../../src/render/browser.ts';

describe('seedFor', () => {
  it('is stable per route and differs between routes', () => {
    const home = seedFor('#/render/en-US/iphone-6.9/home');
    expect(home).toBe(seedFor('#/render/en-US/iphone-6.9/home'));
    expect(home).not.toBe(seedFor('#/render/en-US/iphone-6.9/detail'));
    expect(home).not.toBe(seedFor('#/render/de-DE/iphone-6.9/home'));
    expect(Number.isInteger(home) && home >= 0 && home < 2 ** 32).toBe(true);
  });
});
