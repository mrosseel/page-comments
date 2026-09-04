/**
 * Lets a fixed box be pulled about the page.
 *
 * The comment tools must never hide the thing the person wants to talk
 * about, so the dock and the box for a new comment can both be moved. A
 * press on a button, a box to type in or a link is not a pull, so every
 * control still works by mouse and by key.
 */
import { type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
export interface Point {
    x: number;
    y: number;
}
export interface Draggable {
    ref: RefObject<HTMLDivElement | null>;
    /** Put these on every part that may pull the box. */
    handle: {
        onPointerDown: (event: ReactPointerEvent) => void;
        onPointerMove: (event: ReactPointerEvent) => void;
        onPointerUp: (event: ReactPointerEvent) => void;
        onPointerCancel: (event: ReactPointerEvent) => void;
    };
    /** Left and top once the box was moved. Nothing while it sits at rest. */
    style: CSSProperties | undefined;
    moved: boolean;
    reset: () => void;
    /** Pulls the box back on screen after it grew or the window changed. */
    refit: () => void;
}
/**
 * Lets a fixed box be pulled about, so it never hides the thing the person
 * wants to talk about. A press on a button, a box to type in or a link is
 * not a pull, so every control still works by mouse and by key. With a key,
 * the place is kept for the next visit.
 *
 * `onDragEnd`, when given, hears the point a pull let go of — a caller that
 * keeps its own place for the box, such as an offset sent elsewhere rather
 * than kept under a key here, reads the point there instead of a key.
 */
export declare function useDraggable(key?: string, onDragEnd?: (point: Point) => void): Draggable;
//# sourceMappingURL=useDraggable.d.ts.map