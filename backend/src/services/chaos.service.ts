import { setTimeout as wait } from 'node:timers/promises';
import { MAX_DELAY_MS } from '../models/ChaosEndpoint';
import { exceedsDepth } from '../utils/json';

/**
 * Pure chaos primitives. `random` is injectable (defaults to Math.random) so tests can be deterministic.
 */
export type RandomFn = () => number;

/** Latency injection. A named seam so tests can observe delays without faking timers other libraries use. */
export function sleep(ms: number): Promise<void> {
  return wait(ms);
}

/** Runtime cap on top of schema validation, so a bad DB value can never hold a request open for long. */
export function clampDelay(delayMs: number): number {
  if (!Number.isFinite(delayMs) || delayMs <= 0) return 0;
  return Math.min(Math.floor(delayMs), MAX_DELAY_MS);
}

/** 0 never fails, 100 always fails, anything in between fails with that probability. */
export function shouldInjectFailure(failureRate: number, random: RandomFn = Math.random): boolean {
  if (!Number.isFinite(failureRate) || failureRate <= 0) return false;
  if (failureRate >= 100) return true;
  return random() * 100 < failureRate;
}

const MAX_CORRUPTION_DEPTH = 32;
/** Beyond this nesting, cloning/serialising (both recursive in V8) could overflow the stack. */
export const MAX_CORRUPTIBLE_DEPTH = 256;
const MAX_CORRUPTION_CANDIDATES = 5_000;
const MAX_MUTATIONS = 10;
const MUTATION_RATIO = 0.25;

type JsonContainer = Record<string, unknown> | unknown[];

interface Slot {
  container: JsonContainer;
  key: string | number;
  path: string;
  parentSlot: number;
}

export interface CorruptionResult {
  value: unknown;
  /** Paths of fields that were mutated, e.g. ["user.email", "items[2]"]. */
  corruptedPaths: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectSlots(node: unknown, path: string, depth: number, parentSlot: number, slots: Slot[]): void {
  if (depth >= MAX_CORRUPTION_DEPTH) return;
  const entries: Array<[string | number, string]> = Array.isArray(node)
    ? node.map((_, index) => [index, `${path}[${index}]`])
    : isPlainObject(node)
      ? Object.keys(node).map((key) => [key, path ? `${path}.${key}` : key])
      : [];

  for (const [key, childPath] of entries) {
    if (slots.length >= MAX_CORRUPTION_CANDIDATES) return;
    const container = node as JsonContainer;
    slots.push({ container, key, path: childPath, parentSlot });
    collectSlots((container as Record<string | number, unknown>)[key], childPath, depth + 1, slots.length - 1, slots);
  }
}

/** Index in [0, length), safe even if a stubbed `random` returns exactly 1. */
function randomIndex(length: number, random: RandomFn): number {
  return Math.min(length - 1, Math.max(0, Math.floor(random() * length)));
}

function pick<T>(items: readonly T[], random: RandomFn): T {
  return items[randomIndex(items.length, random)] as T;
}

/** `count` distinct indices from [0, length) via a partial Fisher-Yates shuffle (terminates for any `random`). */
function sampleIndices(length: number, count: number, random: RandomFn): Set<number> {
  const order = Array.from({ length }, (_, index) => index);
  for (let i = 0; i < count; i += 1) {
    const j = i + randomIndex(length - i, random);
    [order[i], order[j]] = [order[j] as number, order[i] as number];
  }
  return new Set(order.slice(0, count));
}

/** A value of the "wrong" type for the original, mimicking real backend contract drift. */
function wrongTypeFor(value: unknown, random: RandomFn): unknown {
  if (typeof value === 'string') return pick([12345, true, {}], random);
  if (typeof value === 'number') return pick([String(value), 'NaN', true], random);
  if (typeof value === 'boolean') return pick([String(value), value ? 1 : 0], random);
  if (value === null) return pick(['null', 0, {}], random);
  if (Array.isArray(value)) return pick([{}, '[]', 0], random);
  return pick(['[object Object]', [], 0], random);
}

/**
 * Returns a corrupted deep copy of `input`; the original is never mutated.
 * Roughly 25% of fields (1..10) are set to null, swapped to a wrong type, or removed (object keys only).
 * Bodies with no fields at all ({}, [], or a bare primitive) are returned unchanged, and so are bodies
 * nested deeper than MAX_CORRUPTIBLE_DEPTH (returned as the same reference, never cloned).
 */
export function corruptJson(input: unknown, random: RandomFn = Math.random): CorruptionResult {
  if (exceedsDepth(input, MAX_CORRUPTIBLE_DEPTH)) return { value: input, corruptedPaths: [] };
  const root = structuredClone(input);
  const slots: Slot[] = [];
  collectSlots(root, '', 0, -1, slots);
  if (slots.length === 0) return { value: root, corruptedPaths: [] };

  const target = Math.min(MAX_MUTATIONS, Math.max(1, Math.ceil(slots.length * MUTATION_RATIO)));
  const chosen = sampleIndices(slots.length, target, random);

  // Skip a field whose ancestor is also being replaced: its own mutation would be overwritten anyway.
  const hasChosenAncestor = (index: number): boolean => {
    for (let parent = slots[index]?.parentSlot ?? -1; parent !== -1; parent = slots[parent]?.parentSlot ?? -1) {
      if (chosen.has(parent)) return true;
    }
    return false;
  };

  const corruptedPaths: string[] = [];
  for (const index of chosen) {
    const slot = slots[index];
    if (!slot || hasChosenAncestor(index)) continue;
    const container = slot.container as Record<string | number, unknown>;
    const original = container[slot.key];
    const strategies = Array.isArray(slot.container) ? ['null', 'wrongType'] : ['null', 'wrongType', 'remove'];
    // Nulling a field that is already null would be reported as corrupted while changing nothing.
    const strategy = pick(original === null ? strategies.filter((s) => s !== 'null') : strategies, random);

    if (strategy === 'remove') delete container[slot.key];
    else container[slot.key] = strategy === 'null' ? null : wrongTypeFor(original, random);
    corruptedPaths.push(slot.path);
  }

  return { value: root, corruptedPaths };
}
