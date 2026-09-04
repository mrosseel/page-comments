/**
 * Lets a fixed box be pulled about the page.
 *
 * The comment tools must never hide the thing the person wants to talk
 * about, so the dock and the box for a new comment can both be moved. A
 * press on a button, a box to type in or a link is not a pull, so every
 * control still works by mouse and by key.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';

const EDGE = 6;

export interface Point {
  x: number;
  y: number;
}

export interface Draggable {
  /* React 19 types a ref made with useRef<T>(null) as holding T or null. The
     union says the same thing under React 18, where the current field was
     nullable already. */
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

function readPoint(key: string): Point | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const point = JSON.parse(raw) as Partial<Point>;
    if (typeof point?.x !== 'number' || typeof point?.y !== 'number') return null;
    return { x: point.x, y: point.y };
  } catch {
    return null;
  }
}

/** Keeps the whole box on the screen, whatever the window size is. */
function clampPoint(point: Point, width: number, height: number): Point {
  return {
    x: Math.min(Math.max(EDGE, point.x), Math.max(EDGE, window.innerWidth - width - EDGE)),
    y: Math.min(Math.max(EDGE, point.y), Math.max(EDGE, window.innerHeight - height - EDGE)),
  };
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
export function useDraggable(key?: string, onDragEnd?: (point: Point) => void): Draggable {
  const ref = useRef<HTMLDivElement>(null);
  const grab = useRef<{ dx: number; dy: number } | null>(null);
  /* Where the pull put the box last. The DOM may not have caught up yet. */
  const latest = useRef<Point | null>(null);
  const [point, setPoint] = useState<Point | null>(() => {
    const kept = key && typeof window !== 'undefined' ? readPoint(key) : null;
    latest.current = kept;
    return kept;
  });

  const save = useCallback(
    (next: Point | null) => {
      setPoint(next);
      if (!key) return;
      try {
        if (next) window.localStorage.setItem(key, JSON.stringify(next));
        else window.localStorage.removeItem(key);
      } catch {
        /* A browser with no storage forgets the place on the next visit. */
      }
    },
    [key],
  );

  const onPointerDown = (event: ReactPointerEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('button:not(.fb-grip), textarea, input, select, a')) return;
    const box = ref.current;
    if (!box || event.button !== 0) return;
    const rect = box.getBoundingClientRect();
    grab.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
    latest.current = clampPoint({ x: rect.left, y: rect.top }, rect.width, rect.height);
    setPoint(latest.current);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* Without capture the move still follows, as long as the pointer stays. */
    }
    event.preventDefault();
  };

  const onPointerMove = (event: ReactPointerEvent) => {
    const hold = grab.current;
    const box = ref.current;
    if (!hold || !box) return;
    const rect = box.getBoundingClientRect();
    latest.current = clampPoint(
      { x: event.clientX - hold.dx, y: event.clientY - hold.dy },
      rect.width,
      rect.height,
    );
    setPoint(latest.current);
  };

  const endDrag = (event: ReactPointerEvent) => {
    if (!grab.current) return;
    grab.current = null;
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      /* The pointer was already let go. */
    }
    if (latest.current) {
      save(latest.current);
      onDragEnd?.(latest.current);
    }
  };

  /*
   * A smaller window, or a taller box once the list opens, must not push the
   * box off the screen. Both are watched while the box sits where it was put.
   */
  const anchored = point !== null;
  const refit = useCallback(() => {
    const box = ref.current;
    if (!box || !latest.current) return;
    const rect = box.getBoundingClientRect();
    const next = clampPoint({ x: rect.left, y: rect.top }, rect.width, rect.height);
    if (Math.abs(next.x - rect.left) > 0.5 || Math.abs(next.y - rect.top) > 0.5) {
      latest.current = next;
      save(next);
    }
  }, [save]);

  useEffect(() => {
    if (!anchored) return;
    const box = ref.current;
    if (!box) return;
    window.addEventListener('resize', refit);
    const watcher = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(refit);
    watcher?.observe(box);
    return () => {
      window.removeEventListener('resize', refit);
      watcher?.disconnect();
    };
  }, [anchored, refit]);

  return {
    ref,
    handle: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    },
    style: point ? { left: point.x, top: point.y } : undefined,
    moved: point !== null,
    reset: () => {
      latest.current = null;
      save(null);
    },
    refit,
  };
}
