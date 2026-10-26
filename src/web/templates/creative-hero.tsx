// Creative asset canvas (product page header, search results, universal):
// a full-bleed background, an optional app icon and short headline inside
// Apple's Art Safe Area (preset.creative), and up to three whole devices side
// by side (creative-hero-layout.ts). The safe area is an invisible
// data-s1s-safe-area box; checks.ts reports a data-s1s-safe element outside
// it, a data-s1s-device box that overlaps another, leaves the canvas or is
// small. Each device is drawn with its own size's preset: `iphone-6.9:home`
// frames an iPhone, `ipad-13:home` an iPad. Key art (`props.art`, such as
// an `s1s model render` of the product) takes a place in the same row.
import { useEffect, useState } from 'react';
import { captureRefPreset } from '../../config/resolve.ts';
import { SIZE_PRESETS, safeAreaPt } from '../../config/presets.ts';
import type { CaptureSource, Rect, SizePreset } from '../../config/types.ts';
import type { TemplateModule, TemplateProps } from '../../runtime/index.ts';
import { Background, BackgroundImage, assetUrl, backgroundSpecFrom } from '../components/Background.tsx';
import { Caption } from '../components/Caption.tsx';
import { DeviceFrame } from '../components/DeviceFrame.tsx';
import { Headline } from '../components/Headline.tsx';
import { deviceAspect } from '../hooks/bezel.ts';
import { useBezel } from '../hooks/useBezel.ts';
import { acquire } from '../runtime/ready.ts';
import { CREATIVE_LAYOUT, artItems, creativeGeometry, type CreativeDevice, type CreativeTextMode } from './creative-hero-layout.ts';

export { CREATIVE_LAYOUT, creativeGeometry } from './creative-hero-layout.ts';

const MAX_DEVICES = 3;

function textMode(props: TemplateProps): CreativeTextMode {
  const value = props.screen.props['text'];
  return value === 'top' || value === 'none' ? value : 'left';
}

/** `props.icon`: project-relative image (the app icon) drawn above the headline. */
function iconSrc(props: TemplateProps): string | null {
  const value = props.screen.props['icon'];
  return typeof value === 'string' && value.length > 0 ? assetUrl(value) : null;
}

/** Natural aspect of each image, null until all have loaded; holds a readiness token meanwhile. */
function useAspects(urls: readonly string[]): (number | null)[] | null {
  const key = urls.join('|');
  const [aspects, setAspects] = useState<{ key: string; values: (number | null)[] } | null>(null);
  useEffect(() => {
    if (urls.length === 0) return;
    const release = acquire('creative-art');
    let alive = true;
    Promise.all(
      urls.map(
        (url) =>
          new Promise<number | null>((done) => {
            const img = new Image();
            img.onload = () => done(img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : null);
            img.onerror = () => done(null);
            img.src = url;
          }),
      ),
    )
      .then((values) => {
        if (alive) setAspects({ key, values });
      })
      .finally(release);
    return () => {
      alive = false;
      release();
    };
    // `key` carries the urls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (urls.length === 0) return [];
  return aspects?.key === key ? aspects.values : null;
}

/** `props.glow`: a colour for a soft spotlight behind the subjects. */
function glowColor(props: TemplateProps): string | null {
  const value = props.screen.props['glow'];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

const box = (rect: Rect) => ({ position: 'absolute' as const, left: rect.x, top: rect.y, width: rect.width, height: rect.height });

function CreativeHero(props: TemplateProps) {
  const { screen, preset, theme, copy } = props;
  // Fixed hook count: one bezel lookup per possible device slot.
  const sources = screen.captures.slice(0, MAX_DEVICES);
  const presets: SizePreset[] = Array.from({ length: MAX_DEVICES }, (_, i) => {
    const source = sources[i];
    return source ? captureRefPreset(source.requested, preset) : SIZE_PRESETS['iphone-6.9'];
  });
  const bezels = [useBezel(presets[0]!, theme), useBezel(presets[1]!, theme), useBezel(presets[2]!, theme)];
  const art = artItems(screen.props['art']);
  const artUrls = art.map((item) => assetUrl(item.src));
  const artAspects = useAspects(artUrls);

  const safe = safeAreaPt(preset) ?? { x: 0, y: 0, width: preset.pt.width, height: preset.pt.height };
  const background = <Background spec={backgroundSpecFrom(screen.props['background'], theme.background)} />;
  const safeBox = <div data-s1s-safe-area="" style={{ ...box(safe), pointerEvents: 'none' }} />;
  if (bezels.slice(0, sources.length).some((b) => b.status !== 'ready') || artAspects === null) {
    return (
      <>
        {background}
        {safeBox}
      </>
    );
  }

  const devices = sources.map((_source: CaptureSource, i): CreativeDevice => {
    const lookup = bezels[i];
    const aspect = lookup && lookup.status === 'ready' ? deviceAspect(lookup.geometry) : 0.46;
    const family = presets[i]?.family;
    return { aspect, tablet: family === 'ipad' || family === 'duo' };
  });
  // Key art first: the hero object leads, the app follows. A broken image keeps a square slot and reports image-missing.
  const subjects: CreativeDevice[] = [
    ...art.map((item, i) => ({ aspect: artAspects[i] ?? 1, tablet: false, art: { scale: item.scale } })),
    ...devices,
  ];
  const mode = textMode(props);
  const geometry = creativeGeometry({ canvas: preset.pt, safe, text: mode, devices: subjects });
  const artRects = geometry.devices.slice(0, art.length);
  const deviceRects = geometry.devices.slice(art.length);
  const layout = CREATIVE_LAYOUT;
  const unit = safe.height;
  const align = mode === 'left' ? 'left' : 'center';
  const icon = iconSrc(props);
  const glow = glowColor(props);
  const union = geometry.devices.reduce<Rect | null>((acc, r) => {
    if (acc === null) return { ...r };
    const x = Math.min(acc.x, r.x);
    const y = Math.min(acc.y, r.y);
    return { x, y, width: Math.max(acc.x + acc.width, r.x + r.width) - x, height: Math.max(acc.y + acc.height, r.y + r.height) - y };
  }, null);

  return (
    <>
      {background}
      {safeBox}
      {glow && union ? (
        <div
          data-s1s-id="glow"
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            background: `radial-gradient(ellipse ${Math.round(union.width * 0.75)}px ${Math.round(union.height * 0.7)}px at ${Math.round(union.x + union.width / 2)}px ${Math.round(union.y + union.height * 0.55)}px, ${glow}, transparent)`,
          }}
        />
      ) : null}
      {artRects.map((rect, i) => (
        <div key={`art-${i}`} data-s1s-art="" data-s1s-check="" data-s1s-id={`art-${i + 1}`} style={{ ...box(rect), display: 'flex', justifyContent: 'center', alignItems: 'flex-end' }}>
          <BackgroundImage src={artUrls[i]!} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        </div>
      ))}
      {deviceRects.map((rect, i) => (
        <div key={i} data-s1s-device="" data-s1s-id={`device-${i + 1}`} style={{ ...box(rect), display: 'flex', justifyContent: 'center', alignItems: 'flex-end' }}>
          <DeviceFrame captures={sources.slice(i, i + 1)} preset={presets[i]!} theme={theme} fit={{ width: rect.width, height: rect.height }} />
        </div>
      ))}
      {geometry.text ? (
        <div
          data-s1s-slot=""
          data-s1s-safe=""
          data-s1s-id="text"
          style={{
            ...box(geometry.text),
            zIndex: 10,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: align === 'left' ? 'flex-start' : 'center',
            gap: Math.round(unit * layout.textGap),
            textAlign: align,
          }}
        >
          {icon ? (
            <BackgroundImage
              src={icon}
              style={{ width: Math.round(unit * 0.2), height: Math.round(unit * 0.2), borderRadius: Math.round(unit * 0.045), flex: 'none' }}
            />
          ) : null}
          <Headline
            text={copy?.headline ?? `[copy missing: ${screen.copyKey}]`}
            highlight={copy?.highlight}
            theme={theme}
            locale={screen.locale}
            minPt={Math.round(unit * layout.headline.min)}
            maxPt={Math.round(unit * layout.headline.max)}
            maxLines={layout.headline.maxLines}
            align={align}
          />
          {copy?.subline ? (
            <Caption
              text={copy.subline}
              theme={theme}
              minPt={Math.round(unit * layout.subline.min)}
              maxPt={Math.round(unit * layout.subline.max)}
              maxLines={layout.subline.maxLines}
              align={align}
            />
          ) : null}
        </div>
      ) : null}
    </>
  );
}

const creativeHero: TemplateModule = {
  id: 'creative-hero',
  families: ['creative'],
  compliant: true,
  Component: CreativeHero,
};

export default creativeHero;
