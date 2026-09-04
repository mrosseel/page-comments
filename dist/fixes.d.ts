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
export type FixId = string;
/**
 * Names the fixes this site can switch off, and where the switches are kept.
 * Call it once, as early as the application starts.
 */
export declare function registerFixes(fixes: Record<string, string>, options?: {
    storeKey?: string;
}): void;
/** The fixes this site can switch off, with their text. */
export declare function fixRegistry(): Record<string, string>;
/** True when this comment has a fix the person can switch off. */
export declare function hasFix(id: FixId): boolean;
/** The one line of text for a fix, or an empty string. */
export declare function fixLabel(id: FixId): string;
/** True when the fix for this comment is shown. */
export declare function isFixEnabled(id: FixId): boolean;
/** Shows or hides the fix for this comment. The page changes at once. */
export declare function setFixEnabled(id: FixId, on: boolean): void;
/** Switches the fix for this comment the other way. */
export declare function toggleFix(id: FixId): void;
/** Reads the switch for this comment and follows every later change. */
export declare function useFixEnabled(id: FixId): boolean;
//# sourceMappingURL=fixes.d.ts.map