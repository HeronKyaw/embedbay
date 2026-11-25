import type * as React from "react";

export interface AnsiSegment {
  text: string;
  style: React.CSSProperties;
}

const ANSI_STRIP_REGEX =
  // eslint-disable-next-line no-control-regex
  /\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[ -/]*[@-~]/g;

const ANSI_TOKEN_REGEX =
  // eslint-disable-next-line no-control-regex
  /\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b\[([0-9;]*)m|\x1b\[[0-9;?]*[ -/]*[@-~]/g;

const STANDARD_COLORS: readonly string[] = [
  "#1E293B", // 0 black
  "#F43F5E", // 1 red
  "#10B981", // 2 green
  "#F59E0B", // 3 yellow
  "#3B82F6", // 4 blue
  "#A855F7", // 5 magenta
  "#06B6D4", // 6 cyan
  "#CBD5E1", // 7 white
];

const BRIGHT_COLORS: readonly string[] = [
  "#64748B", // 8 bright black
  "#FB7185", // 9 bright red
  "#34D399", // 10 bright green
  "#FBBF24", // 11 bright yellow
  "#60A5FA", // 12 bright blue
  "#C084FC", // 13 bright magenta
  "#22D3EE", // 14 bright cyan
  "#F8FAFC", // 15 bright white
];

const CUBE_STEPS = [0, 95, 135, 175, 215, 255] as const;

function xterm256ToCss(index: number): string | undefined {
  if (!Number.isFinite(index) || index < 0 || index > 255) return undefined;
  if (index < 8) return STANDARD_COLORS[index];
  if (index < 16) return BRIGHT_COLORS[index - 8];
  if (index < 232) {
    const idx = index - 16;
    const r = CUBE_STEPS[Math.floor(idx / 36)];
    const g = CUBE_STEPS[Math.floor((idx % 36) / 6)];
    const b = CUBE_STEPS[idx % 6];
    return `rgb(${r}, ${g}, ${b})`;
  }
  const gray = 8 + (index - 232) * 10;
  return `rgb(${gray}, ${gray}, ${gray})`;
}

function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(255, value));
}

interface SgrState {
  color?: string;
  backgroundColor?: string;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
}

function stateToStyle(state: SgrState): React.CSSProperties {
  const style: React.CSSProperties = {};
  if (state.color) style.color = state.color;
  if (state.backgroundColor) style.backgroundColor = state.backgroundColor;
  if (state.bold) style.fontWeight = 600;
  if (state.dim) style.opacity = 0.6;
  if (state.italic) style.fontStyle = "italic";
  if (state.underline) style.textDecoration = "underline";
  return style;
}

function applySgrCodes(state: SgrState, rawParams: string): void {
  const parts = rawParams === "" ? ["0"] : rawParams.split(";");
  let i = 0;
  while (i < parts.length) {
    const code = parts[i] === "" ? 0 : Number.parseInt(parts[i], 10);
    if (Number.isNaN(code)) {
      i += 1;
      continue;
    }

    if (code === 0) {
      state.color = undefined;
      state.backgroundColor = undefined;
      state.bold = false;
      state.dim = false;
      state.italic = false;
      state.underline = false;
    } else if (code === 1) {
      state.bold = true;
    } else if (code === 2) {
      state.dim = true;
    } else if (code === 3) {
      state.italic = true;
    } else if (code === 4) {
      state.underline = true;
    } else if (code === 22) {
      state.bold = false;
      state.dim = false;
    } else if (code === 23) {
      state.italic = false;
    } else if (code === 24) {
      state.underline = false;
    } else if (code >= 30 && code <= 37) {
      state.color = STANDARD_COLORS[code - 30];
    } else if (code === 39) {
      state.color = undefined;
    } else if (code >= 40 && code <= 47) {
      state.backgroundColor = STANDARD_COLORS[code - 40];
    } else if (code === 49) {
      state.backgroundColor = undefined;
    } else if (code >= 90 && code <= 97) {
      state.color = BRIGHT_COLORS[code - 90];
    } else if (code >= 100 && code <= 107) {
      state.backgroundColor = BRIGHT_COLORS[code - 100];
    } else if (code === 38 || code === 48) {
      const isBg = code === 48;
      const mode = Number.parseInt(parts[i + 1] ?? "", 10);
      if (mode === 5 && i + 2 < parts.length) {
        const idx = Number.parseInt(parts[i + 2], 10);
        const css = xterm256ToCss(idx);
        if (css) {
          if (isBg) state.backgroundColor = css;
          else state.color = css;
        }
        i += 2;
      } else if (mode === 2 && i + 4 < parts.length) {
        const r = clampByte(Number.parseInt(parts[i + 2], 10));
        const g = clampByte(Number.parseInt(parts[i + 3], 10));
        const b = clampByte(Number.parseInt(parts[i + 4], 10));
        const css = `rgb(${r}, ${g}, ${b})`;
        if (isBg) state.backgroundColor = css;
        else state.color = css;
        i += 4;
      }
    }

    i += 1;
  }
}

export function stripAnsi(input: string): string {
  return input.replace(ANSI_STRIP_REGEX, "");
}

export function parseAnsi(input: string): AnsiSegment[] {
  const segments: AnsiSegment[] = [];
  const state: SgrState = {
    bold: false,
    dim: false,
    italic: false,
    underline: false,
  };

  ANSI_TOKEN_REGEX.lastIndex = 0;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = ANSI_TOKEN_REGEX.exec(input)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        text: input.slice(lastIndex, match.index),
        style: stateToStyle(state),
      });
    }
    if (match[1] !== undefined) {
      applySgrCodes(state, match[1]);
    }
    lastIndex = ANSI_TOKEN_REGEX.lastIndex;
  }

  if (lastIndex < input.length) {
    segments.push({
      text: input.slice(lastIndex),
      style: stateToStyle(state),
    });
  }

  return segments;
}
