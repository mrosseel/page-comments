/**
 * Preview switches for proposed fixes.
 *
 * A proposal changes the page. The person must be able to see the change
 * switched ON and OFF before they accept it. This store keeps one switch per
 * comment id. The default is ON, which is the new look.
 *
 * HOW A HOST APPLICATION USES IT
 * 1. Give every fix a comment id and one line of text, then hand the map to
 *    `registerFixes()` once, or to the `fixes` property of `PageComments`.
 * 2. Wrap the change so that OFF gives back the old look exactly.
 *    - Style only: write the new value as before, then add a rule
 *      `html[data-fix-off~="cXXX"] .thing { ...old values... }`.
 *    - Markup or logic: read `useFixEnabled('cXXX')` and draw the old branch
 *      when it is false.
 *
 * The OFF set is mirrored onto `document.documentElement.dataset.fixOff` as a
 * space separated list, so a fix made only of styles needs no React code.
 */

import { useSyncExternalStore } from 'react';

export type FixId = string;

/** Comment ids that carry a fix, each with one line of text. */
let registry: Record<string, string> = {};

let storeKey = 'page-comments.fixes';

const listeners = new Set<() => void>();

let off: Set<string> = new Set();

function readOff(): Set<string> {
  try {
    const raw = window.sessionStorage.getItem(storeKey);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(list)) return new Set();
    return new Set(list.filter((id): id is string => typeof id === 'string'));
  } catch {
    return new Set();
  }
}

function mirror(): void {
  if (typeof document === 'undefined') return;
  const list = [...off].join(' ');
  if (list.length === 0) delete document.documentElement.dataset.fixOff;
  else document.documentElement.dataset.fixOff = list;
}

function persist(): void {
  try {
    window.sessionStorage.setItem(storeKey, JSON.stringify([...off]));
  } catch {
    /* A browser with no storage keeps the switches for this page only. */
  }
}

function announce(): void {
  for (const listener of listeners) listener();
}

if (typeof window !== 'undefined') {
  off = readOff();
  mirror();
}

/**
 * Names the fixes this site can switch off, and where the switches are kept.
 * Call it once, as early as the application starts.
 */
export function registerFixes(
  fixes: Record<string, string>,
  options: { storeKey?: string } = {},
): void {
  registry = { ...fixes };
  if (options.storeKey && options.storeKey !== storeKey) {
    storeKey = options.storeKey;
    if (typeof window !== 'undefined') {
      off = readOff();
      mirror();
    }
  }
  announce();
}

/** The fixes this site can switch off, with their text. */
export function fixRegistry(): Record<string, string> {
  return registry;
}

/** True when this comment has a fix the person can switch off. */
export function hasFix(id: FixId): boolean {
  return Object.prototype.hasOwnProperty.call(registry, id);
}

/** The one line of text for a fix, or an empty string. */
export function fixLabel(id: FixId): string {
  return registry[id] ?? '';
}

/** True when the fix for this comment is shown. */
export function isFixEnabled(id: FixId): boolean {
  return !off.has(id);
}

/** Shows or hides the fix for this comment. The page changes at once. */
export function setFixEnabled(id: FixId, on: boolean): void {
  if (on === isFixEnabled(id)) return;
  const next = new Set(off);
  if (on) next.delete(id);
  else next.add(id);
  off = next;
  mirror();
  persist();
  announce();
}

/** Switches the fix for this comment the other way. */
export function toggleFix(id: FixId): void {
  setFixEnabled(id, !isFixEnabled(id));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Reads the switch for this comment and follows every later change. */
export function useFixEnabled(id: FixId): boolean {
  return useSyncExternalStore(
    subscribe,
    () => isFixEnabled(id),
    () => true,
  );
}
