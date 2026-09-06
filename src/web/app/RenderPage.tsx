// /#/render/<locale>/<sizeId>/<screenId>: exactly one Canvas at preset.pt, at (0,0).
import { getPreset, isSizeId } from '../../config/presets.ts';
import { Canvas } from '../components/Canvas.tsx';
import { ErrorPanel } from '../components/ErrorPanel.tsx';
import { mode, resolveFor, useProjectData } from '../runtime/project.ts';
import { getTemplate, templateIds } from '../templates/index.tsx';

export interface RenderPageProps {
  locale: string;
  sizeId: string;
  screenId: string;
}

export { ErrorPanel };

export function RenderPage({ locale, sizeId, screenId }: RenderPageProps) {
  // Deterministic Math.random for templates: the sequence restarts from the
  // route's seed on every render pass (render mode installs the hook).
  window.__s1sSeed?.(`${locale}/${sizeId}/${screenId}`);
  const project = useProjectData();
  if (project.status === 'loading') return null;
  if (project.status === 'error') return <ErrorPanel title="Project data failed to load" message={project.error} />;
  const { data } = project;

  if (!isSizeId(sizeId)) return <ErrorPanel title="Unknown size" message={sizeId} />;
  const preset = getPreset(sizeId);
  const def = data.screens.screens.find((screen) => screen.id === screenId);
  if (!def) {
    return <ErrorPanel title="Unknown screen" message={`"${screenId}" is not in screens.ts (${data.screens.screens.map((s) => s.id).join(', ')})`} />;
  }
  const resolved = resolveFor(data, locale, preset, def);
  const template = getTemplate(resolved.template);
  if (!template) {
    return <ErrorPanel title="Unknown template" message={`"${resolved.template}" for screen "${screenId}". Known: ${templateIds().join(', ')}`} />;
  }
  if (!template.families.includes(preset.family)) {
    return <ErrorPanel title="Template does not support this family" message={`"${template.id}" supports ${template.families.join(', ')}; ${sizeId} is ${preset.family}`} />;
  }
  const Component = template.Component;
  return (
    <div className="s1s-render-root">
      <Canvas
        preset={preset}
        theme={data.theme}
        id={`${locale}/${sizeId}/${screenId}`}
        noncompliant={template.compliant === false ? template.id : undefined}
      >
        <Component screen={resolved} preset={preset} theme={data.theme} copy={resolved.copy} mode={mode()} />
      </Canvas>
    </div>
  );
}
