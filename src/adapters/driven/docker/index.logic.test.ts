// adapters/driven/docker/index.logic: direct unit tests for the pure line-parsing/merge logic
// extracted from index.ts (review fix). Before this split, this logic was only exercised by
// index.test.ts's `describe.skipIf(!dockerAvailable)` real-docker suite — meaning it had zero
// executed coverage in any environment without a reachable docker daemon (e.g. sandboxed CI).
// These tests need no docker daemon at all.
import { describe, expect, it } from 'vitest';
import { createLineSplitter, mergeSortAndTrimLogs, parseTimestampedOutput, splitTimestampedLine } from './index.logic.js';
import type { LogLine } from '../../../core/ports/docker.js';

describe('createLineSplitter', () => {
  it('reassembles a line split across two chunk boundaries', () => {
    const lines: string[] = [];
    const splitter = createLineSplitter((line) => lines.push(line));

    splitter('2026-01-01T00:00:00.000000000Z hel');
    splitter('lo world\n2026-01-01T00:00:01.000000000Z second');
    splitter(' line\n');

    expect(lines).toEqual(['2026-01-01T00:00:00.000000000Z hello world', '2026-01-01T00:00:01.000000000Z second line']);
  });

  it('strips a trailing \\r from a CRLF-terminated line without corrupting the buffered remainder', () => {
    const lines: string[] = [];
    const splitter = createLineSplitter((line) => lines.push(line));

    splitter('one\r\ntwo\r\n');

    expect(lines).toEqual(['one', 'two']);
    expect(lines.some((line) => line.includes('\r'))).toBe(false);
  });

  it('never emits an empty line for a bare trailing newline', () => {
    const lines: string[] = [];
    const splitter = createLineSplitter((line) => lines.push(line));

    splitter('only line\n');

    expect(lines).toEqual(['only line']);
  });
});

describe('splitTimestampedLine', () => {
  it('splits docker --timestamps RFC3339Nano prefix from the rest of the line', () => {
    const result = splitTimestampedLine('2026-01-01T00:00:00.123456789Z hello world', 'stdout');

    expect(result).toEqual({ timestamp: '2026-01-01T00:00:00.123456789Z', stream: 'stdout', text: 'hello world' });
  });

  it('tags the stream it was given', () => {
    const result = splitTimestampedLine('2026-01-01T00:00:00.000000000Z oops', 'stderr');

    expect(result.stream).toBe('stderr');
  });

  it('falls back to a fabricated receipt timestamp when the line has no space at all (no timestamp prefix to split off)', () => {
    const result = splitTimestampedLine('notimestamphere', 'stdout');

    expect(result.text).toBe('notimestamphere');
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

describe('parseTimestampedOutput', () => {
  it('splits a raw multi-line buffer into tagged LogLines, dropping the trailing empty entry', () => {
    const raw = '2026-01-01T00:00:00.000000000Z first\n2026-01-01T00:00:01.000000000Z second\n';

    const result = parseTimestampedOutput(raw, 'stdout');

    expect(result).toEqual([
      { timestamp: '2026-01-01T00:00:00.000000000Z', stream: 'stdout', text: 'first' },
      { timestamp: '2026-01-01T00:00:01.000000000Z', stream: 'stdout', text: 'second' },
    ]);
  });

  it('strips a trailing \\r from each line', () => {
    const raw = '2026-01-01T00:00:00.000000000Z first\r\n';

    const result = parseTimestampedOutput(raw, 'stdout');

    expect(result[0]?.text).toBe('first');
  });
});

describe('mergeSortAndTrimLogs', () => {
  function line(timestamp: string, text: string, stream: LogLine['stream'] = 'stdout'): LogLine {
    return { timestamp, stream, text };
  }

  it('merges stdout and stderr lines, sorted chronologically', () => {
    const stdout = [line('2026-01-01T00:00:00.000Z', 'out-0'), line('2026-01-01T00:00:02.000Z', 'out-1')];
    const stderr = [line('2026-01-01T00:00:01.000Z', 'err-0', 'stderr')];

    const result = mergeSortAndTrimLogs(stdout, stderr, 10);

    expect(result.map((l) => l.text)).toEqual(['out-0', 'err-0', 'out-1']);
  });

  it('trims the merged, sorted result back down to the most recent `count` lines, since --tail is applied independently per pipe', () => {
    const stdout = [line('2026-01-01T00:00:00.000Z', 'out-0'), line('2026-01-01T00:00:02.000Z', 'out-1')];
    const stderr = [line('2026-01-01T00:00:01.000Z', 'err-0', 'stderr'), line('2026-01-01T00:00:03.000Z', 'err-1', 'stderr')];

    const result = mergeSortAndTrimLogs(stdout, stderr, 2);

    expect(result.map((l) => l.text)).toEqual(['out-1', 'err-1']);
  });
});
