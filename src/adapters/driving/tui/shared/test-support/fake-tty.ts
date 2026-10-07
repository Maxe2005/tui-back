// tui/shared/test-support/fake-tty: a fake-TTY stdout/stdin pair that drives Ink's real
// interactive machinery (alternate screen, resize, real useInput keypresses) without a pty, so
// every real-keypress test shares the same fakes.
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';

export class FakeTtyStdout extends Writable {
  isTTY = true;
  columns = 80;
  rows = 24;
  private chunks: string[] = [];
  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(chunk.toString());
    callback();
  }
  get output(): string {
    return this.chunks.join('');
  }
  get chunkCount(): number {
    return this.chunks.length;
  }
  // Each render also emits synchronized-update toggle sequences ("\x1b[?2026h"/"l") and an
  // empty flush marker around the actual frame — filter down to chunks that carry an
  // actual frame (Ink clears the screen with "\x1b[2J" before writing new content, in
  // alternate-screen mode).
  contentFramesSince(count: number): string[] {
    return this.chunks.slice(count).filter((chunk) => chunk.includes('[2J'));
  }
}

// A resize/alt-screen-only fake stdin: reports isTTY but never emits input data — `read()`
// always returns null, so Ink's input pipeline never has bytes to parse. Fine for tests that
// only exercise mount/unmount/resize.
export function fakeTtyStdin(): NodeJS.ReadStream {
  const stdin = new EventEmitter() as unknown as NodeJS.ReadStream;
  Object.assign(stdin, {
    isTTY: true,
    setRawMode: () => {},
    setEncoding: () => {},
    ref: () => {},
    unref: () => {},
    read: () => null,
    pause: () => stdin,
    resume: () => stdin,
  });
  return stdin;
}

// A *real* keypress-capable fake stdin. Ink's `App` attaches a `'readable'` listener and pulls
// bytes via `stdin.read()`/`stdin.setEncoding('utf8')` — exactly what a `node:stream.PassThrough`
// implements, so `stdin.write(...)` with a raw escape sequence or character round-trips through
// Ink's keypress parser (`parse-keypress.js`) into a real `useInput` callback.
export function fakeInteractiveTtyStdin(): NodeJS.ReadStream {
  const stdin = new PassThrough();
  Object.assign(stdin, {
    isTTY: true,
    setRawMode: () => {},
    ref: () => {},
    unref: () => {},
  });
  return stdin as unknown as NodeJS.ReadStream;
}

// Raw escape sequences for the canonical navigation contract's non-printable keys
// (`parse-keypress.js`'s control-char and CSI mappings) — named so a test reads as
// `pressKey(instance, stdin, KEYS.enter)` rather than a bare escape-code literal.
export const KEYS = {
  enter: '\r',
  escape: '\x1b',
  tab: '\t',
  shiftTab: '\x1b[Z',
  space: ' ',
  backspace: '\x7f',
  up: '\x1b[A',
  down: '\x1b[B',
  left: '\x1b[D',
  right: '\x1b[C',
  home: '\x1b[H',
  end: '\x1b[F',
  // PgUp/PgDn (CSI `5~`/`6~`, decoded by ink's parse-keypress.js into `key.pageUp`/
  // `key.pageDown`).
  pageUp: '\x1b[5~',
  pageDown: '\x1b[6~',
  // Ctrl+letter comes over the wire as its codepoint-1..26 control byte (ink's
  // parse-keypress.js) — Ctrl+W is 'w' (0x77) - 'a' (0x61) + 1 = 0x17.
  ctrlW: '\x17',
  // Ctrl+Left/Right (unlike Ctrl+letter) is a CSI sequence with an explicit modifier parameter —
  // xterm's encoding, `5` = 1 + ctrl's bit (4) — which ink's parse-keypress.js decodes into
  // `key.ctrl: true` alongside `key.leftArrow`/`key.rightArrow`.
  ctrlLeft: '\x1b[1;5D',
  ctrlRight: '\x1b[1;5C',
  // The create wizard's Ctrl+N / Ctrl+P step-navigation fallbacks ('n' = 0x0e, 'p' = 0x10, same
  // codepoint-1..26 encoding as ctrlW above).
  ctrlN: '\x0e',
  ctrlP: '\x10',
  // The create wizard's override-box revert ('r' = 0x12).
  ctrlR: '\x12',
  // The switch discard confirmation's explicit confirm key ('e' = 0x05).
  ctrlE: '\x05',
} as const;
