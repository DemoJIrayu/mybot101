# Builds hotfix/computer-tools.ts from the v0.1.6 original (computer-tools.orig.ts). Re-runnable.
import sys
src = "/home/rakazo/rakazo/hotfix/computer-tools.orig.ts"
dst = "/home/rakazo/rakazo/hotfix/computer-tools.ts"
debug = "--debug" in sys.argv
s = open(src).read()

def sub(old, new):
    global s
    assert s.count(old) == 1, old
    s = s.replace(old, new)

sub('} from "@rakazo/adapter-kit";\n', '''} from "@rakazo/adapter-kit";

// Local hotfix (BotTeam) for Gemma 4 driving the desktop:
// - Gemma points on a 0..1000 grid, not in pixels. With RAKAZO_COMPUTER_COORDINATE_GRID=1000 the model is told
//   the screen is that grid and x/y are scaled to the last observed frame.
// - Gemma often nests coordinates ({click:{x,y}}) or puts typed text in `key`; accept those shapes.
// ponytail: frame size is process-wide; every bot desktop here is the same 1280x800 Xvfb.
const GRID = Number(process.env.RAKAZO_COMPUTER_COORDINATE_GRID || 0);
let frame = { width: 1280, height: 800 };
const toScreen = (value: number, size: number) =>
  GRID > 0 ? Math.min(Math.round((Math.min(value, GRID) * size) / GRID), size - 1) : value;
const toGrid = (value: unknown, size: number) =>
  typeof value === "number" && size > 0 ? Math.round((value * GRID) / size) : value;
function pointOf(action: Record<string, unknown>, kind: string): Record<string, unknown> {
  if (action.x !== undefined) return action;
  const nested = action[kind] ?? action.coordinate ?? action.coordinates ?? action.position ?? action.point;
  if (Array.isArray(nested)) return { x: nested[0], y: nested[1] };
  return nested && typeof nested === "object" ? (nested as Record<string, unknown>) : action;
}
function modelDetails(details: { width: number; height: number; cursor?: unknown }) {
  if (!(GRID > 0)) return details;
  const cursor = details.cursor as { x?: unknown; y?: unknown } | undefined;
  return {
    ...details,
    width: GRID,
    height: GRID,
    cursor: cursor && typeof cursor === "object"
      ? { ...cursor, x: toGrid(cursor.x, details.width), y: toGrid(cursor.y, details.height) }
      : details.cursor,
    coordinates: `x,y for computer_act are on a 0..${GRID} grid over the whole screen`,
  };
}
''')
if debug:
    sub('  if (value.length > 24) throw new Error("computer_act accepts at most 24 actions");\n',
        '  if (value.length > 24) throw new Error("computer_act accepts at most 24 actions");\n'
        '  // DEBUG-CU (temporary): log action shapes, never typed text\n'
        '  console.log("DEBUG-CU", JSON.stringify(value.map((a: any) => ({ ...a, text: a && typeof a.text === "string" ? `<${a.text.length} chars>` : undefined, key: a && a.kind === "type" && typeof a.key === "string" ? `<${a.key.length} chars>` : a?.key }))));\n')
sub('''      const x = finiteCoordinate(action.x, "x");
      const y = finiteCoordinate(action.y, "y");''', '''      const point = pointOf(action, kind);
      const x = toScreen(finiteCoordinate(point.x, "x"), frame.width);
      const y = toScreen(finiteCoordinate(point.y, "y"), frame.height);''')
sub('return [{ kind: "clipboard", text: String(action.text ?? "") }];',
    'return [{ kind: "clipboard", text: String(action.text ?? action.key ?? "") }];')
sub('key: String(action.key ?? ""),', 'key: String(action.key ?? action.text ?? ""),')
sub('''  const details = {
    frameId: observation.frameId,''', '''  if (observation.width > 0 && observation.height > 0) {
    frame = { width: observation.width, height: observation.height };
  }
  const details = {
    frameId: observation.frameId,''')
sub('\\n${JSON.stringify(details)}', '\\n${JSON.stringify(modelDetails(details))}')
open(dst, "w").write(s)
print("patched", "(debug)" if debug else "")
