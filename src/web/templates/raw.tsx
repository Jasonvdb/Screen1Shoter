// Unframed capture filling the canvas. Default for watch (which Node copies
// through without the browser); useful for full-bleed iPhone/iPad shots too.
import type { TemplateModule, TemplateProps } from '../../runtime/index.ts';
import { Background, backgroundSpecFrom } from '../components/Background.tsx';
import { MissingCapture } from '../components/MissingCapture.tsx';
import { placeholderCapture, useCapture } from '../hooks/useCapture.ts';

function RawScreen({ screen, preset, theme }: TemplateProps) {
  const capture = screen.captures[0] ?? placeholderCapture(screen.id, preset.family, screen.locale);
  const cap = useCapture(capture);
  const fit = screen.props['fit'] === 'contain' ? 'contain' : 'cover';
  return (
    <>
      <Background spec={backgroundSpecFrom(screen.props['background'], theme.background)} />
      <div data-s1s-id="raw" style={{ position: 'absolute', inset: 0, zIndex: 1 }}>
        {cap.url ? (
          <img
            ref={cap.ref}
            src={cap.url}
            alt=""
            onLoad={cap.onLoad}
            onError={cap.onError}
            style={{ width: '100%', height: '100%', objectFit: fit, objectPosition: 'top center' }}
          />
        ) : null}
        {cap.url === null || cap.failed ? <MissingCapture source={capture} failed={cap.failed} /> : null}
      </div>
    </>
  );
}

const raw: TemplateModule = {
  id: 'raw',
  families: ['iphone', 'ipad', 'watch'],
  compliant: true,
  Component: (props) => <RawScreen {...props} />,
};

export default raw;
