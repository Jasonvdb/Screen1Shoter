// `s1s model render`: a thin wrapper over src/core/model-render.ts. Writes a
// transparent studio render of a 3D model for creative asset key art.
import { Argument, Option, type Command } from 'commander';
import { resolve } from 'node:path';
import { S1sError } from '../../core/errors.ts';
import { MODEL_RENDER_DEFAULTS, renderModel } from '../../core/model-render.ts';
import { defineAction, type CommandOutput } from '../output.ts';

interface RenderFlags {
  out: string;
  color: string;
  metalness: string;
  roughness: string;
  yaw: string;
  pitch: string;
  up: 'z' | 'y';
  size: string;
  shadow: boolean;
}

function number(value: string, flag: string, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new S1sError('usage', `${flag} must be a number from ${min} to ${max} (got "${value}").`);
  return n;
}

async function renderCommand(inputs: string[], opts: RenderFlags): Promise<CommandOutput> {
  const size = number(opts.size, '--size', 512, 8192);
  const result = await renderModel({
    ...MODEL_RENDER_DEFAULTS,
    input: inputs.map((file) => resolve(file)),
    output: resolve(opts.out),
    color: opts.color,
    metalness: number(opts.metalness, '--metalness', 0, 1),
    roughness: number(opts.roughness, '--roughness', 0, 1),
    yaw: number(opts.yaw, '--yaw', -360, 360),
    pitch: number(opts.pitch, '--pitch', -89, 89),
    up: opts.up,
    size: { width: size, height: size },
    shadow: opts.shadow,
  });
  return {
    data: { ...result },
    text: `Rendered ${inputs.join(' + ')} -> ${opts.out} (${result.dims.width}x${result.dims.height}, transparent).`,
  };
}

export function registerModel(program: Command): void {
  const model = program.command('model').description('3D model helpers for creative asset key art');

  defineAction<RenderFlags, [string[]]>(
    model
      .command('render')
      .description('Render a 3D model (STL, OBJ, USDZ) to a transparent studio PNG with SceneKit, trimmed to the object')
      .addArgument(new Argument('<files...>', 'model files ModelIO can read; several = the parts of one assembly, each in its own coordinates'))
      .requiredOption('--out <png>', 'output PNG, e.g. screenshots/assets/hero.png')
      .option('--color <hex>', 'material colour', MODEL_RENDER_DEFAULTS.color)
      .option('--metalness <0-1>', 'physically based metalness', String(MODEL_RENDER_DEFAULTS.metalness))
      .option('--roughness <0-1>', 'physically based roughness', String(MODEL_RENDER_DEFAULTS.roughness))
      .option('--yaw <deg>', 'turn about the vertical axis', String(MODEL_RENDER_DEFAULTS.yaw))
      .option('--pitch <deg>', 'camera height above the equator', String(MODEL_RENDER_DEFAULTS.pitch))
      .addOption(new Option('--up <axis>', "the file's up axis; CAD exports are z").choices(['z', 'y']).default(MODEL_RENDER_DEFAULTS.up))
      .option('--size <px>', 'square render size before the trim', String(MODEL_RENDER_DEFAULTS.size.width))
      .option('--no-shadow', 'no contact shadow under the object'),
    ({ args: [files], opts }) => renderCommand(files, opts),
  );
}
