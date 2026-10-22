// Shared helpers: ASDF's error type, JSON files, timestamps, and lenient lookups for documents that come from outside.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// Item state, config and signals are plain JSON that skills write, so they stay loosely typed.
export type Json = any;

// Every ASDF failure has a code (ASDF_<CODE>); the CLI prints it as {"error": code, "message": message}.
export class AsdfError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AsdfError';
    this.code = code;
  }
}

export function fail(code: string, message: string): never {
  throw new AsdfError(code, message);
}

export function readJson(path: string): Json {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

// A text file's lines, without the empty one after a final newline.
export function readLines(path: string): string[] {
  const text = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  if (text === '') return [];
  const lines = text.split(/\r\n|\n|\r/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

export function isObject(value: unknown): value is Record<string, Json> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// A property by name, falling back to a case-insensitive match (signals and tool calls are written by others).
export function prop(value: unknown, name: string): Json {
  if (!isObject(value)) return undefined;
  if (name in value) return value[name];
  const lower = name.toLowerCase();
  const key = Object.keys(value).find((k) => k.toLowerCase() === lower);
  return key === undefined ? undefined : value[key];
}

// A value as a list without nulls: arrays as they are, one value as a one-item list, nothing as an empty list.
export function toList(value: unknown): Json[] {
  const list = Array.isArray(value) ? value : [value];
  return list.filter((v) => v !== null && v !== undefined);
}

// Case-insensitive comparison for names and states, which Azure DevOps and people spell freely.
export function same(value: unknown, expected: unknown): boolean {
  return typeof value === 'string' && typeof expected === 'string' && value.toLowerCase() === expected.toLowerCase();
}

export function oneOf(value: unknown, options: readonly string[]): boolean {
  return options.some((option) => same(value, option));
}

// Flags that agents write into JSON by hand, compared the way PowerShell compares with $true and $false:
// booleans as they are, 1 and 0, and the text "true" and "false" in any case.
export function isTrue(value: unknown): boolean {
  return value === true || value === 1 || (typeof value === 'string' && value.trim().toLowerCase() === 'true');
}

export function isFalse(value: unknown): boolean {
  return value === false || value === 0 || (typeof value === 'string' && value.trim().toLowerCase() === 'false');
}

// Timestamps are stored as UTC 'yyyy-MM-ddTHH:mm:ssZ'.
export function stamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// A time from JSON: null when empty; an unreadable value is an error.
export function parseTime(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) fail('ASDF_BAD_ARGUMENT', `not a date: ${String(value)}`);
  return date;
}

// The current time, or the -Now a caller passed (tests and replays).
export function now(value?: string | Date): Date {
  if (value instanceof Date) return value;
  return parseTime(value) ?? new Date();
}

// Runs git in a folder. stdout only; a missing git counts as a failed command.
export function git(folder: string, args: string[]): { code: number; out: string; error: string } {
  const result = spawnSync('git', ['-C', folder, ...args], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  return { code: result.status ?? 1, out: result.stdout ?? '', error: result.error?.message ?? result.stderr ?? '' };
}
