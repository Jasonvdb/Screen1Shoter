// Ambient declarations for the browser side: Vite virtual modules and the
// window globals the Node renderer relies on. `virtual:s1s-templates` is typed
// as TemplateModule[] for the editor; the entries are still validated at
// runtime (isTemplateModule) because the project file is user-authored.

declare module 'virtual:s1s-screens' {
  const screens: import('../config/types.ts').ScreensConfig;
  export default screens;
}

declare module 'virtual:s1s-theme' {
  const theme: import('../config/types.ts').Theme;
  export default theme;
}

declare module 'virtual:s1s-templates' {
  /** Project templates from <project>/templates/index.ts; [] when absent. */
  const templates: readonly import('../runtime/index.ts').TemplateModule[];
  export default templates;
}

interface Window {
  /** Injected into index.html by the Vite plugin before any module runs. */
  __S1S_MODE: 'render' | 'dev';
  /** true once fonts, images and text fitting are settled for the current route. */
  __S1S_READY: boolean;
  __S1S: {
    /** Warnings derived from the DOM (data-s1s-* attributes). */
    check(): import('../config/types.ts').Warning[];
    /** Template id of a canvas tagged data-s1s-noncompliant, else null. */
    noncompliant(): string | null;
  };
  /** Render mode only (context init script): re-seeds Math.random from a route key. */
  __s1sSeed?: (route: string) => void;
}
