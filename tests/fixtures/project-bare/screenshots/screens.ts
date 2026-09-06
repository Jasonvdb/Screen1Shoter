// Minimal fixture without a manifest.json: loadProject must fall back to a
// default manifest so layout work can start before `s1s init` bookkeeping.
import { defineScreens } from '../../../../src/config/index.ts';

export default defineScreens({
  screens: [{ id: 'home' }, { id: 'detail' }],
});
