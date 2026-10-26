// Studio render of a 3D model (STL, OBJ, USDZ, any format ModelIO reads) to
// a transparent PNG, for key art on creative assets: the product itself as
// the hero object instead of another screenshot. A small Swift helper loads
// the file with ModelIO, gives it one physically based material, lights it
// with a soft studio environment plus a key light, optionally casts a contact
// shadow, and renders it offscreen with SceneKit. No 3D app is needed. Like
// the pose helper it is compiled once with `xcrun swiftc` into S1S_HOME/bin,
// keyed by a hash of its source. Node then trims the empty margin.
import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import type { Dims } from '../config/types.ts';
import { S1sError } from './errors.ts';
import { run } from './exec.ts';
import { pathExists } from './fs.ts';
import { S1S_HOME } from './paths.ts';
import { ensureDeveloperDir } from './sim.ts';

export interface ModelRenderOptions {
  /** One file, or the parts of one assembly: every file keeps its own coordinates. */
  input: string | string[];
  output: string;
  /** Render canvas before the trim, px. */
  size: Dims;
  /** sRGB hex of the material. */
  color: string;
  metalness: number;
  roughness: number;
  /** Turn about the vertical axis, degrees. */
  yaw: number;
  /** Camera height above the model's equator, degrees. */
  pitch: number;
  /** The file's up axis; CAD formats (STL, STEP exports) are Z-up. */
  up: 'z' | 'y';
  shadow: boolean;
  /** Clear border kept around the trimmed object, px. */
  pad: number;
}

export const MODEL_RENDER_DEFAULTS: Omit<ModelRenderOptions, 'input' | 'output'> = {
  size: { width: 3000, height: 3000 },
  color: '#B86E26',
  metalness: 0.35,
  roughness: 0.38,
  yaw: 35,
  pitch: 24,
  up: 'z',
  shadow: true,
  pad: 24,
};

/** Exit codes the helper uses; anything else is a crash. */
const HELPER_EXIT: Readonly<Record<number, string>> = {
  3: 'the model file could not be read',
  4: 'the file holds no mesh',
  5: 'SceneKit could not render (no Metal device?)',
  6: 'the PNG could not be written',
};

export const MODEL_HELPER_SOURCE = String.raw`// s1s model render helper: <config.json>
import AppKit
import ModelIO
import SceneKit
import SceneKit.ModelIO

struct Config: Decodable {
    let inputs: [String]; let output: String
    let width: Int; let height: Int
    let color: [Double]; let metalness: Double; let roughness: Double
    let yaw: Double; let pitch: Double; let zUp: Bool; let shadow: Bool
}
guard CommandLine.arguments.count == 2,
      let data = FileManager.default.contents(atPath: CommandLine.arguments[1]),
      let cfg = try? JSONDecoder().decode(Config.self, from: data) else { exit(2) }

var meshes: [MDLMesh] = []
for input in cfg.inputs {
    let asset = MDLAsset(url: URL(fileURLWithPath: input))
    if asset.count == 0 { exit(3) }
    meshes += asset.childObjects(of: MDLMesh.self).compactMap { $0 as? MDLMesh }
}
if meshes.isEmpty { exit(4) }

let material = SCNMaterial()
material.lightingModel = .physicallyBased
material.diffuse.contents = NSColor(srgbRed: cfg.color[0], green: cfg.color[1], blue: cfg.color[2], alpha: 1)
material.metalness.contents = cfg.metalness
material.roughness.contents = cfg.roughness
// CAD exports do not always wind every triangle the same way; drawing both
// sides lights a flipped face from its other side instead of leaving it black.
material.isDoubleSided = true

let scene = SCNScene()
let model = SCNNode()

/// Smooth normals within 35 degrees, hard edges beyond, as a CAD viewer
/// shades: vertices are welded by position, and each corner averages only the
/// faces around it that bend less than the crease angle. A face wound the
/// other way bends past it, so it never darkens its neighbours.
func autoSmooth(_ mesh: MDLMesh) -> SCNGeometry? {
    guard let attribute = mesh.vertexAttributeData(forAttributeNamed: MDLVertexAttributePosition, as: .float3) else { return nil }
    func position(_ i: Int) -> SIMD3<Float> {
        let p = attribute.dataStart.advanced(by: i * attribute.stride).assumingMemoryBound(to: Float.self)
        return SIMD3(p[0], p[1], p[2])
    }
    var corners: [Int] = []
    for case let sub as MDLSubmesh in mesh.submeshes ?? [] where sub.geometryType == .triangles {
        let buffer = sub.indexBuffer.map().bytes
        for k in 0..<sub.indexCount {
            switch sub.indexType {
            case .uInt32: corners.append(Int(buffer.load(fromByteOffset: k * 4, as: UInt32.self)))
            case .uInt16: corners.append(Int(buffer.load(fromByteOffset: k * 2, as: UInt16.self)))
            default: corners.append(Int(buffer.load(fromByteOffset: k, as: UInt8.self)))
            }
        }
    }
    if corners.isEmpty { return nil }
    let points = corners.map(position)
    let faceCount = points.count / 3
    var faceNormals: [SIMD3<Float>] = []
    faceNormals.reserveCapacity(faceCount)
    for f in 0..<faceCount {
        let n = simd_cross(points[f * 3 + 1] - points[f * 3], points[f * 3 + 2] - points[f * 3])
        let len = simd_length(n)
        faceNormals.append(len > 0 ? n / len : SIMD3(0, 1, 0))
    }
    // Weld by position (1e-4 of the part's size).
    var lo = points[0], hi = points[0]
    for p in points { lo = simd_min(lo, p); hi = simd_max(hi, p) }
    let quantum = max(simd_length(hi - lo) * 1e-4, 1e-6)
    struct Key: Hashable { let x: Int32, y: Int32, z: Int32 }
    func key(_ p: SIMD3<Float>) -> Key { Key(x: Int32((p.x / quantum).rounded()), y: Int32((p.y / quantum).rounded()), z: Int32((p.z / quantum).rounded())) }
    var facesAt: [Key: [Int]] = [:]
    for (c, p) in points.enumerated() { facesAt[key(p), default: []].append(c / 3) }
    let crease: Float = cos(35 * .pi / 180)
    var normals: [SIMD3<Float>] = []
    normals.reserveCapacity(points.count)
    for (c, p) in points.enumerated() {
        let own = faceNormals[c / 3]
        var sum = SIMD3<Float>(0, 0, 0)
        for f in facesAt[key(p)] ?? [] where simd_dot(faceNormals[f], own) >= crease { sum += faceNormals[f] }
        let len = simd_length(sum)
        normals.append(len > 0 ? sum / len : own)
    }
    let vertexSource = SCNGeometrySource(vertices: points.map { SCNVector3($0.x, $0.y, $0.z) })
    let normalSource = SCNGeometrySource(normals: normals.map { SCNVector3($0.x, $0.y, $0.z) })
    let element = SCNGeometryElement(indices: (0..<UInt32(points.count)).map { $0 }, primitiveType: .triangles)
    return SCNGeometry(sources: [vertexSource, normalSource], elements: [element])
}

for mesh in meshes {
    guard let geometry = autoSmooth(mesh) else { continue }
    geometry.materials = [material]
    let node = SCNNode(geometry: geometry)
    node.simdTransform = mesh.transform?.matrix ?? matrix_identity_float4x4
    model.addChildNode(node)
}
if model.childNodes.isEmpty { exit(4) }
// CAD files are Z-up; SceneKit is Y-up. The yaw turns the part to face the camera.
let orient = SCNNode()
orient.addChildNode(model)
if cfg.zUp { model.eulerAngles.x = -.pi / 2 }
orient.eulerAngles.y = CGFloat(cfg.yaw * .pi / 180)
let holder = SCNNode()
holder.addChildNode(orient)
scene.rootNode.addChildNode(holder)

let (lo, hi) = holder.boundingBox
let center = SCNVector3((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, (lo.z + hi.z) / 2)
holder.position = SCNVector3(-center.x, -center.y, -center.z)
let ext = SCNVector3(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z)
let radius = Double(sqrt(ext.x * ext.x + ext.y * ext.y + ext.z * ext.z)) / 2

// A soft studio: a bright overhead softbox, a cooler fill, a dark floor.
func studio() -> NSImage {
    let size = NSSize(width: 1024, height: 512)
    let image = NSImage(size: size)
    image.lockFocus()
    let gradient = NSGradient(colors: [NSColor(white: 1.0, alpha: 1), NSColor(white: 0.62, alpha: 1), NSColor(white: 0.18, alpha: 1), NSColor(white: 0.08, alpha: 1)],
                              atLocations: [0, 0.32, 0.55, 1], colorSpace: .sRGB)!
    gradient.draw(in: NSRect(origin: .zero, size: size), angle: -90)
    NSColor(white: 1.0, alpha: 0.9).setFill()
    NSBezierPath(roundedRect: NSRect(x: 380, y: 400, width: 260, height: 80), xRadius: 30, yRadius: 30).fill()
    image.unlockFocus()
    return image
}
scene.lightingEnvironment.contents = studio()
scene.lightingEnvironment.intensity = 1.6
scene.background.contents = NSColor.clear

let key = SCNNode()
key.light = SCNLight()
key.light!.type = .directional
key.light!.intensity = 900
key.light!.castsShadow = cfg.shadow
key.light!.shadowMode = .forward
key.light!.shadowColor = NSColor(white: 0, alpha: 0.38)
key.light!.shadowRadius = 18
key.light!.shadowSampleCount = 32
key.light!.shadowMapSize = CGSize(width: 4096, height: 4096)
key.light!.orthographicScale = CGFloat(radius * 2.4)
key.light!.automaticallyAdjustsShadowProjection = true
key.eulerAngles = SCNVector3(-1.1, 0.55, 0)
scene.rootNode.addChildNode(key)

let rim = SCNNode()
rim.light = SCNLight()
rim.light!.type = .directional
rim.light!.intensity = 500
rim.eulerAngles = SCNVector3(-0.35, .pi * 0.85, 0)
scene.rootNode.addChildNode(rim)

let ambient = SCNNode()
ambient.light = SCNLight()
ambient.light!.type = .ambient
ambient.light!.intensity = 260
scene.rootNode.addChildNode(ambient)

if cfg.shadow {
    let floor = SCNNode(geometry: SCNPlane(width: CGFloat(radius * 8), height: CGFloat(radius * 8)))
    floor.eulerAngles.x = -.pi / 2
    floor.position = SCNVector3(0, CGFloat(-Double(ext.y) / 2 - radius * 0.002), 0)
    let catcher = SCNMaterial()
    catcher.lightingModel = .shadowOnly
    floor.geometry?.materials = [catcher]
    scene.rootNode.addChildNode(floor)
}

let camera = SCNNode()
camera.camera = SCNCamera()
camera.camera!.fieldOfView = 22
camera.camera!.zNear = radius * 0.05
camera.camera!.zFar = radius * 60
camera.camera!.wantsHDR = true
camera.camera!.wantsExposureAdaptation = false
let pitch = cfg.pitch * .pi / 180
let distance = radius / sin(11 * .pi / 180) * 1.08
camera.position = SCNVector3(0, CGFloat(distance * sin(pitch)), CGFloat(distance * cos(pitch)))
camera.look(at: SCNVector3(0, 0, 0))
scene.rootNode.addChildNode(camera)

guard let device = MTLCreateSystemDefaultDevice() else { exit(5) }
let renderer = SCNRenderer(device: device, options: nil)
renderer.scene = scene
renderer.pointOfView = camera
let image = renderer.snapshot(atTime: 0, with: CGSize(width: cfg.width, height: cfg.height), antialiasingMode: .multisampling4X)
guard let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
      let png = rep.representation(using: .png, properties: [:]) else { exit(6) }
do { try png.write(to: URL(fileURLWithPath: cfg.output)) } catch { exit(6) }
exit(0)
`;

function helperPath(): string {
  const hash = createHash('sha256').update(MODEL_HELPER_SOURCE).digest('hex').slice(0, 12);
  return join(S1S_HOME, 'bin', `model-render-${hash}`);
}

/** Compiles the helper once per source version; returns its path. */
export async function modelHelper(): Promise<string> {
  const binary = helperPath();
  if (await pathExists(binary)) return binary;
  await ensureDeveloperDir();
  await mkdir(dirname(binary), { recursive: true });
  const source = `${binary}.swift`;
  await writeFile(source, MODEL_HELPER_SOURCE);
  const result = await run('xcrun', ['swiftc', '-O', source, '-o', binary], { timeoutMs: 300_000 });
  if (result.code !== 0) {
    throw new S1sError('tool-missing', `Could not compile the model render helper: ${result.stderr.trim().split('\n')[0] ?? ''}`, {
      hint: 'Install Xcode and select it with xcode-select.',
    });
  }
  return binary;
}

/** `#B86E26` -> [0.72, 0.43, 0.15]; throws `usage` on anything else. */
export function hexToRgb(hex: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match?.[1]) throw new S1sError('usage', `Colour "${hex}" is not a #RRGGBB hex.`);
  const value = Number.parseInt(match[1], 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

export interface ModelRenderResult {
  output: string;
  dims: Dims;
}

/** Renders `opts.input` to `opts.output`: a transparent PNG trimmed to the object (and its shadow) plus `pad`. */
export async function renderModel(opts: ModelRenderOptions): Promise<ModelRenderResult> {
  const inputs = Array.isArray(opts.input) ? opts.input : [opts.input];
  if (inputs.length === 0) throw new S1sError('usage', 'No model file given.');
  for (const input of inputs) {
    if (!(await pathExists(input))) throw new S1sError('usage', `No model file at ${input}.`);
  }
  const helper = await modelHelper();
  await mkdir(dirname(opts.output), { recursive: true });
  const raw = `${opts.output}.raw.png`;
  const config = `${opts.output}.json`;
  await writeFile(
    config,
    JSON.stringify({
      inputs,
      output: raw,
      width: opts.size.width,
      height: opts.size.height,
      color: hexToRgb(opts.color),
      metalness: opts.metalness,
      roughness: opts.roughness,
      yaw: opts.yaw,
      pitch: opts.pitch,
      zUp: opts.up === 'z',
      shadow: opts.shadow,
    }),
  );
  try {
    const result = await run(helper, [config], { timeoutMs: 300_000 });
    if (result.code !== 0) {
      const why = HELPER_EXIT[result.code] ?? `the helper exited ${result.code}`;
      throw new S1sError('render-failed', `Could not render ${inputs.join(', ')}: ${why}.`);
    }
    const trimmed = await sharp(raw).trim({ threshold: 1 }).extend({
      top: opts.pad,
      bottom: opts.pad,
      left: opts.pad,
      right: opts.pad,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    }).png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true });
    await writeFile(opts.output, trimmed.data);
    return { output: opts.output, dims: { width: trimmed.info.width, height: trimmed.info.height } };
  } finally {
    await rm(raw, { force: true });
    await rm(config, { force: true });
  }
}
