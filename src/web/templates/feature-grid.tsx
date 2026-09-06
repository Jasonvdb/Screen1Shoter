// iPad only: text block on top, the device (56% of the canvas width) on the
// left, up to three Callout cards from copy.callouts on the right. Missing
// callouts render a hatched hint card flagged as an error-level overflow so
// the render cannot pass silently; more than MAX_CALLOUTS flags the column
// the same way (Node reports it too, on the same element).
import { templateMeta } from '../../config/template-meta.ts';
import type { TemplateModule, TemplateProps } from '../../runtime/index.ts';
import { Background, backgroundSpecFrom } from '../components/Background.tsx';
import { Callout, type CalloutSizes } from '../components/Callout.tsx';
import { layoutScale } from '../components/Canvas.tsx';
import { DeviceFrame } from '../components/DeviceFrame.tsx';
import { placeholderCapture } from '../hooks/useCapture.ts';
import { TextBlock, textAlignOf, type TextLayout } from './two-device.tsx';

export const MAX_CALLOUTS = templateMeta('feature-grid')?.callouts ?? 3;

export interface FeatureGridLayout extends TextLayout {
  padX: number;
  padTop: number;
  padBottom: number;
  /** Gap between the text block and the device row. */
  gap: number;
  /** Gap between the device column and the cards column. */
  columnGap: number;
  /** Device width as a fraction of the canvas width. */
  deviceWidth: number;
  cardGap: number;
  /** Card numbers in pt; the card radius comes from theme.radius. */
  card: Omit<CalloutSizes, 'radius'>;
}

export const LAYOUT: Record<'ipad', FeatureGridLayout> = {
  ipad: {
    padX: 56,
    padTop: 76,
    padBottom: 56,
    textHeight: 258,
    gap: 30,
    textGap: 14,
    headline: { min: 40, max: 72, maxLines: 2 },
    subline: { min: 22, max: 32, maxLines: 2 },
    badge: 17,
    columnGap: 40,
    deviceWidth: 0.56,
    cardGap: 24,
    card: { title: { min: 20, max: 28 }, body: { min: 15, max: 20 }, marker: 36, padding: 28, gap: 14 },
  },
};

function MissingCallouts({ copyKey, locale }: { copyKey: string; locale: string }) {
  return (
    <div
      data-s1s-id="missing-callouts"
      data-s1s-overflow="overflow"
      style={{
        padding: '8%',
        textAlign: 'center',
        color: 'rgba(255,255,255,0.85)',
        background:
          'repeating-linear-gradient(45deg, rgba(255,255,255,0.05) 0 12px, rgba(255,255,255,0.12) 12px 24px), #2a2a2e',
        fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
        fontSize: 18,
        lineHeight: 1.4,
        overflowWrap: 'anywhere',
      }}
    >
      {`Missing callouts: copy/${locale}.json screens.${copyKey}.callouts needs 1-${MAX_CALLOUTS} { title, body } entries for feature-grid`}
    </div>
  );
}

function FeatureGridScreen(props: TemplateProps) {
  const { screen, preset, theme, copy } = props;
  const layout = LAYOUT.ipad;
  const s = layoutScale(preset);
  const px = (value: number) => Math.round(value * s);
  const capture = screen.captures[0] ?? placeholderCapture(screen.id, preset.family, screen.locale);
  const allCallouts = copy?.callouts ?? [];
  const callouts = allCallouts.slice(0, MAX_CALLOUTS);
  const tooMany = allCallouts.length > MAX_CALLOUTS;
  const side = screen.props['side'] === 'right' ? 'right' : 'left';
  const widthProp = screen.props['deviceMaxWidth'];
  const deviceWidth = typeof widthProp === 'number' && widthProp > 0 && widthProp <= 1 ? widthProp : layout.deviceWidth;
  const deviceColumn = Math.round(deviceWidth * preset.pt.width);
  const sizes: CalloutSizes = {
    title: { min: px(layout.card.title.min), max: px(layout.card.title.max) },
    body: { min: px(layout.card.body.min), max: px(layout.card.body.max) },
    marker: px(layout.card.marker),
    padding: px(layout.card.padding),
    gap: px(layout.card.gap),
    radius: px(theme.radius),
  };

  return (
    <>
      <Background spec={backgroundSpecFrom(screen.props['background'], theme.background)} />
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: px(layout.gap),
          padding: `${px(layout.padTop)}px ${px(layout.padX)}px ${px(layout.padBottom)}px`,
        }}
      >
        <TextBlock props={props} layout={layout} align={textAlignOf(props)} />
        <div
          style={{
            flex: '1 1 0px',
            minHeight: 0,
            display: 'flex',
            flexDirection: side === 'right' ? 'row-reverse' : 'row',
            alignItems: 'stretch',
            gap: px(layout.columnGap),
          }}
        >
          {/* Fixed-width column; the frame fills it in slot mode (largest device that fits). */}
          <div data-s1s-id="device-column" style={{ flex: 'none', width: deviceColumn, display: 'flex' }}>
            <DeviceFrame captures={[capture]} preset={preset} theme={theme} align="center" />
          </div>
          <div
            data-s1s-slot=""
            data-s1s-id="callouts"
            data-s1s-overflow={tooMany ? 'overflow' : undefined}
            data-s1s-overflow-why={
              tooMany ? `copy/${screen.locale}.json screens.${screen.copyKey}.callouts has ${allCallouts.length} entries; feature-grid shows at most ${MAX_CALLOUTS}` : undefined
            }
            style={{
              flex: '1 1 0px',
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              gap: px(layout.cardGap),
            }}
          >
            {callouts.length > 0 ? (
              callouts.map((callout, index) => <Callout key={index} callout={callout} index={index} theme={theme} sizes={sizes} />)
            ) : (
              <MissingCallouts copyKey={screen.copyKey} locale={screen.locale} />
            )}
          </div>
        </div>
      </div>
    </>
  );
}

const featureGrid: TemplateModule = {
  id: 'feature-grid',
  families: ['ipad'],
  compliant: true,
  Component: (props) => <FeatureGridScreen {...props} />,
};

export default featureGrid;
