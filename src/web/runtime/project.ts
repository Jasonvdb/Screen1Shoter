// Project data for the browser: the virtual modules (screens, theme) plus
// /__s1s/project.json (copies, manifest, capture map, bezel index).
import { useEffect, useState } from 'react';
import screens from 'virtual:s1s-screens';
import theme from 'virtual:s1s-theme';
import { getPreset, presetsFor, renderTarget } from '../../config/presets.ts';
import { captureKey, resolveScreen, screenAppliesTo } from '../../config/resolve.ts';
import type {
  CaptureResolver,
  ProjectJson,
  ResolvedScreen,
  ScreenDef,
  ScreensConfig,
  SizePreset,
  Theme,
} from '../../config/types.ts';
import { placeholderCapture } from '../hooks/useCapture.ts';
import { acquire } from './ready.ts';

export interface ProjectData {
  json: ProjectJson;
  screens: ScreensConfig;
  theme: Theme;
}

export type ProjectState =
  | { status: 'loading' }
  | { status: 'ready'; data: ProjectData }
  | { status: 'error'; error: string };

/** Theme from the virtual module; available synchronously. */
export const projectTheme: Theme = theme;
export const projectScreens: ScreensConfig = screens;

export function mode(): 'render' | 'dev' {
  return window.__S1S_MODE === 'render' ? 'render' : 'dev';
}

let inflight: Promise<ProjectData> | null = null;
let resolved: ProjectData | null = null;

async function fetchProject(): Promise<ProjectData> {
  const res = await fetch('/__s1s/project.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`GET /__s1s/project.json -> ${res.status} ${res.statusText}`);
  const json = (await res.json()) as ProjectJson;
  resolved = { json, screens, theme };
  return resolved;
}

export function loadProjectData(force = false): Promise<ProjectData> {
  if (!inflight || force) {
    inflight = fetchProject().catch((error: unknown) => {
      inflight = null;
      throw error;
    });
  }
  return inflight;
}

export function useProjectData(): ProjectState {
  const [state, setState] = useState<ProjectState>(() =>
    resolved ? { status: 'ready', data: resolved } : { status: 'loading' },
  );
  useEffect(() => {
    if (state.status !== 'loading') return;
    const release = acquire('project');
    let alive = true;
    loadProjectData()
      .then((data) => alive && setState({ status: 'ready', data }))
      .catch((error: unknown) => alive && setState({ status: 'error', error: String(error) }))
      .finally(release);
    return () => {
      alive = false;
    };
  }, [state.status]);
  return state;
}

/** Maps capture refs through ProjectJson.captures; unknown keys become placeholders. */
export function captureResolverFor(json: ProjectJson): CaptureResolver {
  return (ref, preset, locale) =>
    json.captures[captureKey(locale, preset.family, ref)] ?? placeholderCapture(ref, preset.family, locale);
}

/** Render targets for the project's sizes (aliases collapsed, order kept). */
export function renderPresets(data: ProjectData): SizePreset[] {
  const seen = new Set<string>();
  const out: SizePreset[] = [];
  for (const preset of presetsFor(data.json.sizes)) {
    const target = renderTarget(preset);
    if (seen.has(target.id)) continue;
    seen.add(target.id);
    out.push(target);
  }
  return out;
}

export function screensFor(data: ProjectData, preset: SizePreset): ScreenDef[] {
  return data.screens.screens.filter((screen) => screenAppliesTo(screen, preset));
}

export function localesOf(data: ProjectData): string[] {
  const all = new Set([...data.json.locales, ...Object.keys(data.json.copies)]);
  return [...all];
}

/** The config goes in so a project-level `panorama` reaches the screen being drawn. */
export function resolveFor(data: ProjectData, locale: string, preset: SizePreset, screen: ScreenDef): ResolvedScreen {
  return resolveScreen(screen, preset, locale, data.json.copies[locale], captureResolverFor(data.json), {
    config: data.screens,
  });
}

export function presetForRoute(sizeId: string): SizePreset {
  return getPreset(sizeId);
}
