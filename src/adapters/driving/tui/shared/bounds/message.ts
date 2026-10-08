// tui/shared/bounds: turns arbitrary error/message text into one capped line. The full text
// stays wherever it already lives (logs, the CLI JSON line) — this is display-only.
const ANSI_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b./g;
// eslint-disable-next-line no-control-regex
const CONTROL_PATTERN = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

export const DEFAULT_MESSAGE_MAX_CHARS = 300;

// Strips ANSI escapes and control characters (keeping spaces and newlines) — for paragraphs.
export function stripControl(text: string): string {
  return text.replace(ANSI_PATTERN, '').replace(CONTROL_PATTERN, '').replace(/\r\n?/g, '\n');
}

export function normalizeMessage(text: unknown, maxChars = DEFAULT_MESSAGE_MAX_CHARS): string {
  const raw = typeof text === 'string' ? text : text instanceof Error ? text.message : String(text ?? '');
  const flat = raw.replace(ANSI_PATTERN, '').replace(CONTROL_PATTERN, '').replace(/\s+/g, ' ').trim();
  const limit = Math.max(1, Math.floor(maxChars));
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}
