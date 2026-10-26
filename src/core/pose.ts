// iPhone Duo pose (Closed / Partially Open / Open) and Rotate Right for a
// booted simulator. Xcode 27.1 offers no simctl, devicectl or XcodeBuildMCP
// command for it; the only switch is a button in Device Hub's device window
// (Xcode.app/Contents/Applications/DeviceHub.app). A small Swift helper
// presses it through the macOS Accessibility API, never with the Mac mouse:
// it sets AXManualAccessibility (Device Hub hides its tree until a client
// does), selects the sidebar row `TableRow.Device.<udid>`, and AXPresses the
// window button whose AXDescription names the pose. The helper is compiled
// once with `xcrun swiftc` into S1S_HOME/bin, keyed by a hash of its source.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { S1sError } from './errors.ts';
import { run } from './exec.ts';
import { pathExists } from './fs.ts';
import { S1S_HOME } from './paths.ts';
import { ensureDeveloperDir } from './sim.ts';

export const POSES = ['closed', 'partially-open', 'open', 'rotate-right'] as const;
export type Pose = (typeof POSES)[number];

/** AXDescription of each Device Hub button, as Xcode 27.1 names them. */
export const POSE_BUTTON: Readonly<Record<Pose, string>> = {
  closed: 'Closed',
  'partially-open': 'Partially Open',
  open: 'Open',
  'rotate-right': 'Rotate Right',
};

const ACCESS_HINT =
  'Allow the terminal in System Settings > Privacy & Security > Device Control and Data Access (Accessibility before macOS 27), then run the command again.';

/** Exit codes the helper uses; anything else is a crash. */
const HELPER_EXIT: Readonly<Record<number, string>> = {
  3: 'the terminal is not allowed to use Accessibility',
  4: 'Device Hub lists no row for this simulator',
  5: 'the device window has no such button (is this an iPhone Duo?)',
  6: 'Device Hub refused the press',
};

export const POSE_HELPER_SOURCE = String.raw`// s1s Device Hub pose helper: <pid> <udid> <button description>
import AppKit
import ApplicationServices

let args = CommandLine.arguments
guard args.count == 4, let pid = pid_t(args[1]) else { exit(2) }
let udid = args[2]
let wanted = args[3]
guard AXIsProcessTrusted() else { exit(3) }
let app = AXUIElementCreateApplication(pid)
AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)
Thread.sleep(forTimeInterval: 0.3)

func attr(_ el: AXUIElement, _ name: String) -> AnyObject? {
    var value: AnyObject?
    return AXUIElementCopyAttributeValue(el, name as CFString, &value) == .success ? value : nil
}
func kids(_ el: AXUIElement) -> [AXUIElement] { (attr(el, "AXChildren") as? [AXUIElement]) ?? [] }
func find(_ el: AXUIElement, _ depth: Int, _ match: (AXUIElement) -> Bool) -> AXUIElement? {
    if match(el) { return el }
    if depth > 30 { return nil }
    for child in kids(el) { if let hit = find(child, depth + 1, match) { return hit } }
    return nil
}
let rowId = "TableRow.Device." + udid
func isRow(_ el: AXUIElement) -> Bool {
    guard (attr(el, "AXRole") as? String) == "AXRow" else { return false }
    return find(el, 25, { (attr($0, "AXIdentifier") as? String) == rowId }) != nil
}
guard let row = find(app, 0, isRow) else { exit(4) }
AXUIElementSetAttributeValue(row, "AXSelected" as CFString, kCFBooleanTrue)
var button: AXUIElement?
for _ in 0..<20 {
    button = find(app, 0, { (attr($0, "AXRole") as? String) == "AXButton" && (attr($0, "AXDescription") as? String) == wanted })
    if button != nil { break }
    Thread.sleep(forTimeInterval: 0.25)
}
guard let button else { exit(5) }
exit(AXUIElementPerformAction(button, kAXPressAction as CFString) == .success ? 0 : 6)
`;

function helperPath(): string {
  const hash = createHash('sha256').update(POSE_HELPER_SOURCE).digest('hex').slice(0, 12);
  return join(S1S_HOME, 'bin', `devicehub-pose-${hash}`);
}

/** Compiles the helper once per source version; returns its path. */
export async function poseHelper(): Promise<string> {
  const binary = helperPath();
  if (await pathExists(binary)) return binary;
  await ensureDeveloperDir();
  await mkdir(dirname(binary), { recursive: true });
  const source = `${binary}.swift`;
  await writeFile(source, POSE_HELPER_SOURCE);
  const result = await run('xcrun', ['swiftc', '-O', source, '-o', binary], { timeoutMs: 300_000 });
  if (result.code !== 0) {
    throw new S1sError('tool-missing', `Could not compile the Device Hub pose helper: ${result.stderr.trim().split('\n')[0] ?? ''}`, {
      hint: 'Install Xcode 27.1 or later and select it with xcode-select.',
    });
  }
  return binary;
}

/** Device Hub's pid, opening it first when it is not running. */
async function deviceHubPid(): Promise<number> {
  const pidOf = async () => {
    const result = await run('pgrep', ['-f', 'DeviceHub.app/Contents/MacOS/DeviceHub']);
    const pid = Number.parseInt(result.stdout.trim().split('\n')[0] ?? '', 10);
    return Number.isFinite(pid) ? pid : null;
  };
  const running = await pidOf();
  if (running !== null) return running;
  const developer = await ensureDeveloperDir();
  await run('open', ['-g', '-a', join(developer, '..', 'Applications', 'DeviceHub.app')]);
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const pid = await pidOf();
    if (pid !== null) return pid;
  }
  throw new S1sError('sim-failed', 'Device Hub did not start.', { hint: 'Open Xcode > Open Developer Tool > Device Hub, then retry.' });
}

/** Presses the pose button for `udid` and waits `settleMs` for the display to switch. */
export async function setPose(udid: string, pose: Pose, settleMs = 4000): Promise<void> {
  const helper = await poseHelper();
  const pid = await deviceHubPid();
  const result = await run(helper, [String(pid), udid, POSE_BUTTON[pose]], { timeoutMs: 60_000 });
  if (result.code !== 0) {
    const why = HELPER_EXIT[result.code] ?? `the helper exited ${result.code}`;
    throw new S1sError('sim-failed', `Could not set ${pose} on ${udid}: ${why}.`, {
      hint: result.code === 3 ? ACCESS_HINT : 'Boot the simulator and keep Device Hub open, then retry.',
    });
  }
  if (settleMs > 0) await new Promise((resolve) => setTimeout(resolve, settleMs));
}
