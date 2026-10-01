import type {
  AgentToolExecutionResult,
  ComputerAction,
  ComputerObservation,
} from "@rakazo/adapter-kit";

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

export function parseComputerActions(value: unknown): ComputerAction[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("computer_act requires at least one action");
  }
  if (value.length > 24) throw new Error("computer_act accepts at most 24 actions");
  const actions = value.flatMap((raw): ComputerAction[] => {
    if (!raw || typeof raw !== "object") throw new Error("computer action must be an object");
    const action = raw as Record<string, unknown>;
    const kind = String(action.kind ?? "");
    if (kind === "click" || kind === "move" || kind === "down" || kind === "up") {
      const point = pointOf(action, kind);
      const x = toScreen(finiteCoordinate(point.x, "x"), frame.width);
      const y = toScreen(finiteCoordinate(point.y, "y"), frame.height);
      const pointer: ComputerAction = {
        kind: "pointer",
        x,
        y,
        type: kind,
        button: action.button === "right" ? "right" : "left",
      };
      return action.double === true && kind === "click" ? [pointer, pointer] : [pointer];
    }
    if (kind === "type") {
      return [{ kind: "clipboard", text: String(action.text ?? action.key ?? "") }];
    }
    if (kind === "key") {
      return [
        {
          kind: "key",
          key: String(action.key ?? action.text ?? ""),
          modifiers: Array.isArray(action.modifiers) ? action.modifiers.map(String) : undefined,
        },
      ];
    }
    if (kind === "scroll") {
      return [
        {
          kind: "scroll",
          direction: action.direction === "up" ? "up" : "down",
          amount: boundedNumber(action.amount, 1, 20, 3),
        },
      ];
    }
    if (kind === "wait") {
      return [{ kind: "wait", ms: boundedNumber(action.ms, 0, 5_000, 350) }];
    }
    throw new Error(`unsupported computer action ${kind || "(missing)"}`);
  });
  if (actions.length > 24) {
    throw new Error("computer_act expands to more than 24 actions; split the batch");
  }
  return actions;
}

export function observationToolResult(
  observation: ComputerObservation,
  note = "computer observed",
  previousFrameId?: string,
): AgentToolExecutionResult {
  if (observation.width > 0 && observation.height > 0) {
    frame = { width: observation.width, height: observation.height };
  }
  const details = {
    frameId: observation.frameId,
    capturedAt: observation.capturedAt,
    width: observation.width,
    height: observation.height,
    cursor: observation.cursor,
    activeWindow: observation.activeWindow,
  };
  const unchanged = previousFrameId === observation.frameId;
  return {
    kind: "agent_tool_result",
    content: [
      {
        type: "text",
        text: `${note}${unchanged ? " (screen unchanged)" : ""}\n${JSON.stringify(modelDetails(details))}`,
      },
      ...(unchanged
        ? []
        : [
            {
              type: "image" as const,
              data: Buffer.from(observation.image).toString("base64"),
              mimeType: observation.mimeType,
            },
          ]),
    ],
    details,
  };
}

function finiteCoordinate(value: unknown, name: string) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number) || number < 0 || number > 100_000) {
    throw new Error(`computer action ${name} must be a non-negative coordinate`);
  }
  return number;
}

function boundedNumber(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.round(number), min), max);
}
