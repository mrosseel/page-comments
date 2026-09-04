import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * In page comments for any React site.
 *
 * The sticky button arms a picker. The next click anywhere on the page marks
 * that point, opens a text box beside it, and records what sits under the
 * click: viewport point, page point, viewport size, and the element with its
 * tag, id, class list and CSS path. A screen shot may be attached.
 *
 * Comments go to a small collector, by default the development server at
 * /__feedback/api. When no collector answers, they wait in this browser and
 * go out as soon as one does.
 *
 * A comment is open, proposed or resolved. A proposal that changes what the
 * person sees carries a switch, so the fix can be seen on and off before it
 * is accepted. See ./fixes.ts.
 *
 * The whole set of tools can be pulled about the page, so it never hides the
 * thing the person wants to talk about.
 */
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, } from 'react';
import { fixLabel, hasFix, registerFixes, setFixEnabled, toggleFix, useFixEnabled, } from './fixes.js';
import { useDraggable } from './useDraggable.js';
/* -------------------------------------------------------------------- */
/* Reading the page                                                     */
/* -------------------------------------------------------------------- */
function classesOf(el) {
    const raw = el.getAttribute('class') ?? '';
    return raw.split(/\s+/).filter(Boolean).slice(0, 20);
}
/** A readable CSS path, from the nearest identifier down to the element. */
function cssPath(el) {
    const parts = [];
    let node = el;
    for (let depth = 0; node && depth < 6 && node.nodeName !== 'BODY'; depth++) {
        let part = node.nodeName.toLowerCase();
        if (node.id) {
            parts.unshift(`${part}#${node.id}`);
            break;
        }
        const classes = classesOf(node);
        if (classes.length > 0)
            part += `.${classes.slice(0, 3).join('.')}`;
        const parent = node.parentElement;
        if (parent) {
            const twins = [...parent.children].filter((c) => c.nodeName === node.nodeName);
            if (twins.length > 1)
                part += `:nth-of-type(${twins.indexOf(node) + 1})`;
        }
        parts.unshift(part);
        node = parent;
    }
    return parts.join(' > ');
}
function describe(el) {
    const rect = el.getBoundingClientRect();
    return {
        tag: el.nodeName.toLowerCase(),
        id: el.id ?? '',
        classes: classesOf(el),
        selector: cssPath(el),
        text: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 200),
        rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
        },
    };
}
/** The element note, with whatever the host knows about it on top. */
function noteFor(el, annotate) {
    const base = describe(el);
    return annotate ? { ...base, ...annotate(el) } : base;
}
/* -------------------------------------------------------------------- */
/* Screen shots                                                         */
/* -------------------------------------------------------------------- */
/**
 * Grabs one frame of the shared screen. The browser asks the person once,
 * then the same track serves every later shot in the session.
 */
function useScreenShot() {
    const trackRef = useRef(null);
    const [ready, setReady] = useState(false);
    const stop = useCallback(() => {
        trackRef.current?.stop();
        trackRef.current = null;
        setReady(false);
    }, []);
    const grab = useCallback(async () => {
        try {
            if (!trackRef.current || trackRef.current.readyState === 'ended') {
                const media = navigator.mediaDevices;
                if (!media?.getDisplayMedia)
                    return null;
                const stream = await media.getDisplayMedia({
                    video: { frameRate: 1 },
                    audio: false,
                    preferCurrentTab: true,
                });
                trackRef.current = stream.getVideoTracks()[0] ?? null;
                setReady(Boolean(trackRef.current));
            }
            const track = trackRef.current;
            if (!track)
                return null;
            const video = document.createElement('video');
            video.srcObject = new MediaStream([track]);
            video.muted = true;
            await video.play();
            await new Promise((r) => requestAnimationFrame(() => r(null)));
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx)
                return null;
            ctx.drawImage(video, 0, 0);
            video.pause();
            video.srcObject = null;
            return canvas.toDataURL('image/jpeg', 0.72);
        }
        catch {
            return null;
        }
    }, []);
    useEffect(() => stop, [stop]);
    return { ready, grab, stop };
}
function parse(event) {
    try {
        return JSON.parse(String(event.data));
    }
    catch {
        return null;
    }
}
/**
 * Follows the collector's events channel and keeps two live counts: how
 * many comments are being worked on, and how many carry a fix waiting on a
 * check. Both come from the same status map, rebuilt from the whole store
 * on connect and kept current by every later event.
 */
function useLanded(on, url) {
    const [ready, setReady] = useState([]);
    const [codeChanged, setCodeChanged] = useState(false);
    const [working, setWorking] = useState(0);
    useEffect(() => {
        if (!on || typeof EventSource === 'undefined')
            return;
        const source = new EventSource(url);
        const statuses = new Map();
        const recompute = () => {
            let workingCount = 0;
            const readyIds = [];
            for (const [id, status] of statuses) {
                if (status === 'working')
                    workingCount += 1;
                else if (status === 'proposed')
                    readyIds.push(id);
            }
            setWorking(workingCount);
            setReady(readyIds);
        };
        const track = (value) => {
            const comment = value;
            if (comment?.id)
                statuses.set(comment.id, comment.status);
        };
        const onComment = (event) => {
            track(parse(event)?.comment);
            recompute();
        };
        const onStore = (event) => {
            const list = parse(event)?.comments;
            if (Array.isArray(list)) {
                statuses.clear();
                for (const one of list)
                    statuses.set(one.id, one.status);
            }
            recompute();
        };
        const onResolve = (event) => {
            const ids = parse(event)?.ids;
            if (Array.isArray(ids))
                for (const id of ids)
                    statuses.set(String(id), 'resolved');
            recompute();
        };
        const onRemove = (event) => {
            const id = parse(event)?.id;
            if (typeof id === 'string')
                statuses.delete(id);
            recompute();
        };
        const onChanged = () => setCodeChanged(true);
        source.addEventListener('comment', onComment);
        source.addEventListener('pickup', onComment);
        source.addEventListener('propose', onComment);
        source.addEventListener('reply', onComment);
        source.addEventListener('store', onStore);
        source.addEventListener('resolve', onResolve);
        source.addEventListener('remove', onRemove);
        source.addEventListener('changed', onChanged);
        return () => source.close();
    }, [on, url]);
    return { ready, codeChanged, working };
}
/* -------------------------------------------------------------------- */
/* The layer                                                            */
/* -------------------------------------------------------------------- */
export function PageComments({ apiBase = '/__feedback/api', storagePrefix = 'page-comments', fixes, screen, pollMs = 4000, label = 'Comment', annotate, reviewMode = false, eventsUrl = '/__comments/events', reviewReload = 'self', navigateReload = 'self', navigateTo, } = {}) {
    const API = apiBase;
    const LOCAL_KEY = `${storagePrefix}.queue`;
    const DOCK_KEY = `${storagePrefix}.dock`;
    /* The fixes this site can switch off are named once. */
    useMemo(() => {
        if (fixes)
            registerFixes(fixes, { storeKey: `${storagePrefix}.fixes` });
    }, [fixes, storagePrefix]);
    const [armed, setArmed] = useState(false);
    const [draft, setDraft] = useState(null);
    const [text, setText] = useState('');
    const [withShot, setWithShot] = useState(false);
    const [comments, setComments] = useState([]);
    const [listOpen, setListOpen] = useState(false);
    const [note, setNote] = useState(null);
    const [busy, setBusy] = useState(false);
    const [replies, setReplies] = useState({});
    const [highlight, setHighlight] = useState(() => commentInHash());
    const [workingOnly, setWorkingOnly] = useState(false);
    const HIDE_PINS_KEY = `${storagePrefix}.hidePins`;
    const [hidePins, setHidePins] = useState(() => {
        try {
            return window.localStorage.getItem(HIDE_PINS_KEY) === '1';
        }
        catch {
            return false;
        }
    });
    const RESOLVED_OPEN_KEY = `${storagePrefix}.resolvedOpen`;
    const [resolvedOpen, setResolvedOpen] = useState(() => {
        try {
            return window.localStorage.getItem(RESOLVED_OPEN_KEY) === '1';
        }
        catch {
            return false;
        }
    });
    const boxRef = useRef(null);
    const shot = useScreenShot();
    const bodyScreen = useBodyView();
    const view = screen ?? bodyScreen;
    const dock = useDraggable(DOCK_KEY);
    const box = useDraggable();
    const dockRefit = dock.refit;
    /* The screen name as it is now, read inside callbacks that never change. */
    const viewNow = useRef(view);
    viewNow.current = view;
    /* What the host adds to an element note, read inside the click handler. */
    const annotateNow = useRef(annotate);
    annotateNow.current = annotate;
    const load = useCallback(async () => {
        try {
            /* "all" so a resolved comment still has a number and a row, kept in
               the collapsed section rather than dropped from the page. */
            const res = await fetch(`${API}/comments?status=all`);
            if (!res.ok)
                throw new Error('no collector');
            const body = (await res.json());
            setComments(body.comments);
        }
        catch {
            setComments(readLocal(LOCAL_KEY));
        }
    }, [API, LOCAL_KEY]);
    /**
     * Comments written while the collector was down wait in this browser.
     * Send them as soon as the collector answers, so none are lost.
     */
    const flushed = useRef(false);
    const flushLocal = useCallback(async () => {
        if (flushed.current)
            return;
        flushed.current = true;
        const queued = readLocal(LOCAL_KEY);
        if (queued.length === 0)
            return;
        // Clear first: a second pass must never post the same comment again.
        writeLocal(LOCAL_KEY, []);
        const kept = [];
        for (const item of queued) {
            try {
                const res = await fetch(`${API}/comments`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        text: item.text,
                        x: item.page?.x ?? item.pageX ?? 0,
                        y: item.page?.y ?? item.pageY ?? 0,
                        pageX: item.pageX ?? 0,
                        pageY: item.pageY ?? 0,
                        viewportWidth: window.innerWidth,
                        viewportHeight: window.innerHeight,
                        devicePixelRatio: window.devicePixelRatio,
                        url: window.location.href,
                        view: item.view ?? viewNow.current,
                        element: item.element,
                    }),
                });
                if (!res.ok)
                    throw new Error('rejected');
            }
            catch {
                kept.push(item);
            }
        }
        if (kept.length > 0)
            writeLocal(LOCAL_KEY, kept);
        if (kept.length < queued.length) {
            setNote(`Sent ${queued.length - kept.length} saved comment(s) to the collector.`);
            window.setTimeout(() => setNote(null), 4000);
        }
    }, [API, LOCAL_KEY]);
    useEffect(() => {
        void flushLocal().then(load);
    }, [flushLocal, load]);
    /* An open list makes the dock taller, which may push it off the screen. */
    useLayoutEffect(() => {
        dockRefit();
    }, [listOpen, comments.length, resolvedOpen, dockRefit]);
    /* An open panel keeps up with proposals that arrive while it is shown. */
    useEffect(() => {
        if (!listOpen)
            return;
        void load();
        const timer = window.setInterval(() => void load(), pollMs);
        return () => window.clearInterval(timer);
    }, [listOpen, load, pollMs]);
    /* A comment named in the address bar opens the list and finds its own row. */
    useEffect(() => {
        if (highlight)
            setListOpen(true);
    }, [highlight]);
    /*
    Scrolls to a named comment's row once, the moment it names one. A store
    refresh must never repeat this — the reader may have scrolled on since —
    so the effect answers only to `highlight` and `listOpen` themselves, never
    to `comments`, and it retries for a few seconds only because the row may
    still be loading, or its section may still be opening.
    */
    useEffect(() => {
        if (!highlight || !listOpen)
            return;
        let attempts = 0;
        let retry = 0;
        const tryScroll = () => {
            const row = document.querySelector(`[data-comment-id="${CSS.escape(highlight)}"]`);
            if (row) {
                row.scrollIntoView({ block: 'center', behavior: 'smooth' });
                return;
            }
            attempts += 1;
            if (attempts < 40)
                retry = window.setTimeout(tryScroll, 100);
        };
        tryScroll();
        const dismiss = window.setTimeout(() => setHighlight(null), 6000);
        return () => {
            window.clearTimeout(retry);
            window.clearTimeout(dismiss);
        };
    }, [highlight, listOpen]);
    useEffect(() => {
        try {
            if (hidePins)
                window.localStorage.setItem(HIDE_PINS_KEY, '1');
            else
                window.localStorage.removeItem(HIDE_PINS_KEY);
        }
        catch {
            /* A browser with no storage asks again next time. */
        }
    }, [hidePins, HIDE_PINS_KEY]);
    useEffect(() => {
        try {
            if (resolvedOpen)
                window.localStorage.setItem(RESOLVED_OPEN_KEY, '1');
            else
                window.localStorage.removeItem(RESOLVED_OPEN_KEY);
        }
        catch {
            /* A browser with no storage asks again next time. */
        }
    }, [resolvedOpen, RESOLVED_OPEN_KEY]);
    /* One number for a comment's whole life, shared by its pin and its row. */
    const numbers = useMemo(() => commentNumbers(comments), [comments]);
    const activeComments = useMemo(() => comments.filter((c) => c.status !== 'resolved'), [comments]);
    const resolvedComments = useMemo(() => comments
        .filter((c) => c.status === 'resolved')
        .sort((a, b) => (numbers.get(a.id) ?? 0) - (numbers.get(b.id) ?? 0)), [comments, numbers]);
    /* A resolved comment named in the address bar needs its section open too. */
    useEffect(() => {
        if (highlight && resolvedComments.some((c) => c.id === highlight))
            setResolvedOpen(true);
    }, [highlight, resolvedComments]);
    /* "h" hides every pin, so the thing under review is never covered. */
    useEffect(() => {
        const onKey = (event) => {
            if (event.key.toLowerCase() !== 'h')
                return;
            const target = event.target;
            if (target?.closest('input, textarea, select, [contenteditable="true"]'))
                return;
            setHidePins((v) => !v);
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, []);
    /* While armed, the next click picks a spot instead of playing the game. */
    useEffect(() => {
        if (!armed)
            return;
        const onClick = (event) => {
            const target = event.target;
            if (!target || target.closest('[data-feedback]'))
                return;
            event.preventDefault();
            event.stopPropagation();
            setArmed(false);
            setText('');
            setDraft({
                x: Math.round(event.clientX),
                y: Math.round(event.clientY),
                pageX: Math.round(event.pageX),
                pageY: Math.round(event.pageY),
                viewportWidth: window.innerWidth,
                viewportHeight: window.innerHeight,
                devicePixelRatio: window.devicePixelRatio,
                url: window.location.href,
                view: viewNow.current,
                element: noteFor(target, annotateNow.current),
            });
        };
        const onKey = (event) => {
            if (event.key === 'Escape')
                setArmed(false);
        };
        document.addEventListener('click', onClick, true);
        document.addEventListener('keydown', onKey, true);
        document.body.classList.add('feedback-armed');
        return () => {
            document.removeEventListener('click', onClick, true);
            document.removeEventListener('keydown', onKey, true);
            document.body.classList.remove('feedback-armed');
        };
    }, [armed]);
    useEffect(() => {
        if (draft)
            boxRef.current?.focus();
    }, [draft]);
    const send = async () => {
        if (!draft || text.trim().length === 0)
            return;
        setBusy(true);
        const image = withShot ? await shot.grab() : null;
        const payload = { ...draft, text: text.trim(), image };
        try {
            const res = await fetch(`${API}/comments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!res.ok)
                throw new Error(await res.text());
            setNote('Comment saved to feedback/comments.json.');
        }
        catch {
            saveLocal(LOCAL_KEY, { ...draft, text: text.trim() });
            setNote('No collector answered. The comment waits in this browser.');
        }
        setBusy(false);
        setDraft(null);
        setText('');
        await load();
        window.setTimeout(() => setNote(null), 4000);
    };
    const accept = async (id) => {
        /* An accepted fix is the look from now on, so the switch goes back on. */
        setFixEnabled(id, true);
        try {
            await fetch(`${API}/resolve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: [id] }),
            });
        }
        catch {
            setComments((old) => old.filter((c) => c.id !== id));
        }
        await load();
    };
    /** A reply from the person sends a proposed comment back to open. */
    const pushBack = async (id) => {
        const answer = (replies[id] ?? '').trim();
        if (answer.length === 0)
            return;
        try {
            await fetch(`${API}/reply`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, author: 'human', text: answer }),
            });
            setNote('Sent back. The comment is open again.');
            window.setTimeout(() => setNote(null), 4000);
        }
        catch {
            setNote('No collector answered. The reply did not save.');
        }
        setReplies((old) => ({ ...old, [id]: '' }));
        await load();
    };
    /**
     * Drops a comment for good. The row and its pin go at once, from this
     * browser's own state, rather than waiting for the collector's `remove`
     * event to come back round.
     */
    const dismiss = (id) => {
        setComments((old) => old.filter((c) => c.id !== id));
        setHighlight((old) => (old === id ? null : old));
        void fetch(`${API}/comments/${id}`, { method: 'DELETE' }).catch(() => {
            /* Gone here already. The collector catches up once it answers again. */
        });
    };
    /** A pull moved a pin. The click point and the element stay as recorded. */
    const reposition = (id, dx, dy) => {
        setComments((old) => old.map((c) => (c.id === id ? { ...c, pinOffset: { dx, dy } } : c)));
        void fetch(`${API}/pin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, dx, dy }),
        }).catch(() => {
            /* The offset stays only in this browser until the collector is back. */
        });
    };
    /** Sends the window named by `navigateReload` to a comment's own page. */
    const goTo = (comment) => {
        if (!comment.url)
            return;
        const hashed = addressOf(comment);
        const address = navigateTo ? navigateTo(hashed) : hashed;
        const where = navigateReload === 'top' ? (window.top ?? window) : window;
        try {
            where.location.href = address;
        }
        catch {
            window.location.href = address;
        }
    };
    /**
     * The list panel's own comments — resolved ones set aside for the
     * collapsed section below — narrowed to working ones when asked, and
     * ordered ready-to-review first, then open and working; within each,
     * grouped by screen, the current one first, then by number.
     */
    const shownComments = sortComments(workingOnly ? activeComments.filter((c) => c.status === 'working') : activeComments, view, numbers);
    const groupedByView = new Set(shownComments.map((c) => viewOf(c, view))).size > 1;
    /** A comment's own screen: highlight it here, or navigate to reach it. */
    const goToComment = (comment) => {
        if (onThisScreen(comment, view))
            setHighlight(comment.id);
        else
            goTo(comment);
    };
    const stopClick = (event) => event.stopPropagation();
    /*
    The one reload the reviewer asks for.
  
    Every fix still waiting on a check starts switched off, because the point
    of the reload is to see the old look first and turn each change on against
    it. The switches are kept in this browser, so they survive the reload that
    follows.
    */
    const landed = useLanded(reviewMode, eventsUrl);
    const takeTheNewCode = () => {
        for (const id of landed.ready)
            setFixEnabled(id, false);
        const where = reviewReload === 'top' ? (window.top ?? window) : window;
        try {
            where.location.reload();
        }
        catch {
            window.location.reload();
        }
    };
    /**
     * How many comments carry a fix waiting on a check, right now. The events
     * channel gives a live count when it is open; otherwise the comments this
     * browser already polled for say the same thing.
     */
    const readyCount = reviewMode
        ? landed.ready.length
        : activeComments.filter((c) => c.status === 'proposed').length;
    return (_jsxs("div", { "data-feedback": "root", className: "feedback-layer", onClick: stopClick, children: [!hidePins &&
                activeComments.map((c) => onThisScreen(c, view) ? (_jsx(Pin, { comment: c, index: numbers.get(c.id) ?? 0, highlighted: c.id === highlight, onReposition: reposition }, c.id)) : null), draft && (_jsxs("div", { ref: box.ref, className: "feedback-box", style: box.style ?? boxPosition(draft), "data-feedback": "box", role: "dialog", "aria-label": "Write a comment about this spot", children: [_jsxs("p", { className: "feedback-target", title: "Pull this line to move the box off the spot", ...box.handle, children: [draft.element.tag, draft.element.classes.length > 0 && `.${draft.element.classes[0]}`, _jsxs("span", { children: [draft.x, ", ", draft.y] })] }), _jsx("textarea", { ref: boxRef, value: text, rows: 3, placeholder: "What should change here?", onChange: (e) => setText(e.target.value), onKeyDown: (e) => {
                            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey))
                                void send();
                            if (e.key === 'Escape')
                                setDraft(null);
                        } }), _jsxs("label", { className: "feedback-check", children: [_jsx("input", { type: "checkbox", checked: withShot, onChange: (e) => setWithShot(e.target.checked) }), "Attach a screen shot", shot.ready ? '' : ' (the browser asks once)'] }), _jsxs("div", { className: "feedback-actions", children: [_jsx(DismissButton, { onConfirm: () => setDraft(null) }), _jsx("button", { type: "button", className: "fb-btn", onClick: () => setDraft(null), children: "Cancel" }), _jsx("button", { type: "button", className: "fb-btn fb-primary", disabled: busy || text.trim().length === 0, onClick: () => void send(), children: busy ? 'Saving…' : 'Save comment' })] })] })), note && _jsx("p", { className: "feedback-note", children: note }), _jsxs("div", { ref: dock.ref, className: dock.moved ? 'feedback-dock is-moved' : 'feedback-dock', style: dock.style, "data-feedback": "dock", children: [listOpen && (_jsxs("div", { className: "feedback-list", "data-feedback": "list", children: [_jsxs("header", { title: "Pull this bar to move the comment tools", ...dock.handle, children: [_jsxs("strong", { children: ["Comments", workingOnly && ' · working only', activeComments.filter((c) => c.status === 'proposed').length > 0 &&
                                                ` · ${activeComments.filter((c) => c.status === 'proposed').length} to check`, activeComments.filter((c) => !onThisScreen(c, view)).length > 0 &&
                                                ` · ${activeComments.filter((c) => !onThisScreen(c, view)).length} elsewhere`] }), workingOnly && (_jsx("button", { type: "button", className: "fb-btn", onClick: () => setWorkingOnly(false), children: "Show all" })), _jsx("button", { type: "button", className: "fb-btn", "aria-pressed": hidePins, title: "Hide every pin, so nothing they mark stays covered (h)", onClick: () => setHidePins((v) => !v), children: hidePins ? 'Show pins' : 'Hide pins' }), _jsx("button", { type: "button", className: "fb-btn", onClick: () => void load(), children: "Refresh" })] }), shownComments.length === 0 ? (_jsx("p", { className: "feedback-empty", children: workingOnly
                                    ? 'Nothing being worked on right now.'
                                    : resolvedComments.length > 0
                                        ? 'Nothing open right now.'
                                        : 'Nothing yet. Pick a spot to add the first one.' })) : (_jsx("ol", { children: shownComments.map((c, i) => {
                                    const group = viewOf(c, view);
                                    const newGroup = groupedByView && (i === 0 || group !== viewOf(shownComments[i - 1], view));
                                    const here = onThisScreen(c, view);
                                    return (_jsxs(Fragment, { children: [newGroup && (_jsx("li", { className: "feedback-group", "aria-hidden": "true", children: group === view ? `${group} (this screen)` : group || 'unknown screen' })), _jsxs("li", { "data-comment-id": c.id, className: [
                                                    c.status === 'proposed' ? 'is-proposed' : '',
                                                    here ? '' : 'is-elsewhere',
                                                    c.id === highlight ? 'is-highlighted' : '',
                                                ]
                                                    .filter(Boolean)
                                                    .join(' ') || undefined, children: [_jsx("span", { className: c.status === 'proposed'
                                                            ? 'feedback-index is-proposed'
                                                            : 'feedback-index', children: numbers.get(c.id) ?? i + 1 }), _jsxs("div", { className: "feedback-body", children: [_jsx("p", { children: c.text }), _jsx("code", { children: c.element?.selector }), _jsxs("div", { className: "feedback-where", children: [_jsx("span", { className: "feedback-screen", children: c.view || (here ? view : 'unknown screen') }), _jsxs("span", { className: "feedback-row-end", children: [_jsx("button", { type: "button", className: "fb-btn fb-go", disabled: !here && !c.url, title: here ? "Scroll to this comment's pin" : 'Go to its own screen', onClick: () => goToComment(c), children: "Go" }), _jsx(DismissButton, { onConfirm: () => dismiss(c.id) })] })] }), c.status === 'proposed' ? (_jsxs(_Fragment, { children: [_jsx(FixPreview, { id: c.id, note: c.resolution ?? '', worker: c.worker }), _jsx("textarea", { rows: 2, value: replies[c.id] ?? '', placeholder: "Still wrong because\u2026", onChange: (e) => setReplies((old) => ({ ...old, [c.id]: e.target.value })) }), _jsxs("div", { className: "feedback-row", children: [_jsx("button", { type: "button", className: "fb-btn", disabled: (replies[c.id] ?? '').trim().length === 0, onClick: () => void pushBack(c.id), children: "Send back" }), _jsx("button", { type: "button", className: "fb-btn fb-primary", onClick: () => void accept(c.id), children: "Accept" })] })] })) : c.status === 'working' ? (_jsxs("p", { className: "feedback-working", children: [_jsx("span", { className: "fb-pulse", "aria-hidden": "true" }), "being worked on by ", c.worker ?? 'someone'] })) : (_jsxs("div", { className: "feedback-row", children: [_jsx("span", { className: "feedback-state", children: "waiting for a fix" }), _jsx("button", { type: "button", className: "fb-btn", onClick: () => void accept(c.id), children: "Close it" })] })), (c.replies ?? []).length > 1 && (_jsx("ul", { className: "feedback-thread", children: (c.replies ?? []).slice(0, -1).map((r, k) => (_jsxs("li", { className: `from-${r.author}`, children: [_jsx("span", { children: r.author === 'claude' ? 'Claude' : 'You' }), r.text] }, k))) }))] })] })] }, c.id));
                                }) })), resolvedComments.length > 0 && (_jsxs("div", { className: "feedback-resolved", "data-feedback": "resolved", children: [_jsxs("button", { type: "button", className: "feedback-resolved-header", "aria-expanded": resolvedOpen, onClick: () => setResolvedOpen((v) => !v), children: [resolvedOpen ? '▾' : '▸', " Resolved (", resolvedComments.length, ")"] }), resolvedOpen && (_jsx("ol", { className: "feedback-resolved-list", children: resolvedComments.map((c) => (_jsx(ResolvedRow, { comment: c, number: numbers.get(c.id) ?? 0, view: view, highlighted: c.id === highlight, onGo: goToComment, onDismiss: dismiss }, c.id))) }))] }))] })), _jsxs("div", { className: "feedback-buttons", children: [_jsx("button", { type: "button", className: "fb-btn fb-grip", title: "Pull to move the comment tools. Two clicks put them back.", "aria-label": "Move the comment tools", onDoubleClick: dock.reset, ...dock.handle, children: "\u283F" }), _jsxs("span", { className: "fb-round-wrap", children: [reviewMode && landed.working > 0 && (_jsx("button", { type: "button", className: "fb-corner fb-corner-working", title: `${landed.working} being worked on`, onClick: () => {
                                            setWorkingOnly(true);
                                            setListOpen(true);
                                        }, children: landed.working })), _jsx("button", { type: "button", className: "fb-btn fb-round", "aria-pressed": listOpen, title: "Show the comments and any fix waiting for a check", onClick: () => {
                                            setWorkingOnly(false);
                                            setListOpen((v) => !v);
                                        }, children: comments.length }), readyCount > 0 && (_jsx("button", { type: "button", className: "fb-corner fb-corner-review", title: `${readyCount} ready to review`, onClick: reviewMode ? takeTheNewCode : () => setListOpen(true), children: readyCount }))] }), _jsx("button", { type: "button", className: armed ? 'fb-btn fb-main is-armed' : 'fb-btn fb-main', "aria-pressed": armed, onClick: () => {
                                    setDraft(null);
                                    setArmed((v) => !v);
                                }, children: armed ? 'Click a spot… (Esc)' : label })] })] })] }));
}
/* -------------------------------------------------------------------- */
/* Screens and pins                                                     */
/* -------------------------------------------------------------------- */
/** The screen the page shows now. The host writes it on the body. */
function bodyView() {
    return document.body.dataset.screen ?? '';
}
function subscribeToView(listener) {
    const watcher = new MutationObserver(listener);
    watcher.observe(document.body, { attributes: true, attributeFilter: ['data-screen'] });
    return () => watcher.disconnect();
}
/** Reads the screen name and follows every later change. */
function useBodyView() {
    return useSyncExternalStore(subscribeToView, bodyView, () => '');
}
/**
 * A comment belongs to one screen. Comments from an older build have no
 * screen name, so the element they point at decides: the pin shows only
 * where that element is on the page.
 */
function onThisScreen(comment, view) {
    if (comment.view)
        return comment.view === view;
    const selector = comment.element?.selector;
    if (!selector)
        return false;
    try {
        return document.querySelector(selector) !== null;
    }
    catch {
        return false;
    }
}
/**
 * The screen a comment reads as belonging to, for grouping: its own `view`
 * when it has one, the current screen when an older comment's element is
 * found on it, and the empty string otherwise.
 */
function viewOf(comment, view) {
    if (comment.view)
        return comment.view;
    return onThisScreen(comment, view) ? view : '';
}
/**
 * One number for a comment's whole life, so its pin and its list row never
 * disagree: read from its id when the collector numbers ids that way
 * (`c007` -> 7), or from its place in the store by creation time otherwise.
 * Resolved comments keep their number too, so it stays taken and the next
 * new comment never repeats it.
 */
function commentNumbers(list) {
    const numbers = new Map();
    const used = new Set();
    for (const c of list) {
        const n = Number.parseInt(String(c.id).replace(/\D/g, ''), 10);
        if (Number.isFinite(n) && n > 0 && !used.has(n)) {
            numbers.set(c.id, n);
            used.add(n);
        }
    }
    let next = 1;
    for (const c of [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
        if (numbers.has(c.id))
            continue;
        while (used.has(next))
            next += 1;
        numbers.set(c.id, next);
        used.add(next);
        next += 1;
    }
    return numbers;
}
/** How early a comment sits in the list, by what it still needs. */
function statusBand(status) {
    return status === 'proposed' ? 0 : 1;
}
/**
 * The list's order: ready to review first, then open and working; within
 * each, grouped by screen with the current one first, then by number. A
 * single screen and band keeps the list in number order throughout.
 */
function sortComments(list, view, numbers) {
    return [...list].sort((a, b) => {
        const band = statusBand(a.status) - statusBand(b.status);
        if (band !== 0)
            return band;
        const av = viewOf(a, view);
        const bv = viewOf(b, view);
        if (av !== bv) {
            if (av === view)
                return -1;
            if (bv === view)
                return 1;
            return av.localeCompare(bv);
        }
        return (numbers.get(a.id) ?? 0) - (numbers.get(b.id) ?? 0);
    });
}
/** A comment's address, with the hash set to name it. */
function addressOf(comment) {
    try {
        const target = new URL(comment.url ?? '', window.location.href);
        target.hash = `comment=${comment.id}`;
        return target.toString();
    }
    catch {
        return `${(comment.url ?? '').split('#')[0]}#comment=${comment.id}`;
    }
}
/** The comment named in the address bar's hash, if any. */
function commentInHash() {
    const match = /^#comment=(.+)$/.exec(window.location.hash);
    return match ? decodeURIComponent(match[1]) : null;
}
/**
 * Where a pin belongs on the screen at this moment, in viewport coordinates.
 *
 * The click sat at a fixed spot inside the element under it, so the pin can
 * ride along: find that element again and put the pin back on the same spot.
 * An element that has gone, or a comment old enough to carry no viewport
 * point, falls back to the recorded page point less the scroll so far.
 */
function anchorOf(comment) {
    const selector = comment.element?.selector;
    const held = comment.viewport;
    const shot = comment.element?.rect;
    if (selector && held && shot) {
        let target = null;
        try {
            target = document.querySelector(selector);
        }
        catch {
            target = null;
        }
        if (target) {
            const rect = target.getBoundingClientRect();
            return { x: rect.left + (held.x - shot.x), y: rect.top + (held.y - shot.y) };
        }
    }
    const pageX = comment.page?.x ?? comment.pageX ?? 0;
    const pageY = comment.page?.y ?? comment.pageY ?? 0;
    return { x: pageX - window.scrollX, y: pageY - window.scrollY };
}
/**
 * The anchor, kept up to date. Scrolling, a resize and any reflow move the
 * element under the pin, and each of those is read once per frame at most.
 * The scroll listener captures, so a scroll inside a panel counts as much as
 * a scroll of the whole page.
 */
function useAnchor(comment) {
    const read = useCallback(() => anchorOf(comment), [comment]);
    const [point, setPoint] = useState(read);
    useEffect(() => {
        let frame = 0;
        const update = () => {
            frame = 0;
            setPoint((old) => {
                const next = read();
                return old.x === next.x && old.y === next.y ? old : next;
            });
        };
        const schedule = () => {
            if (!frame)
                frame = window.requestAnimationFrame(update);
        };
        update();
        window.addEventListener('scroll', schedule, true);
        window.addEventListener('resize', schedule);
        const watch = new ResizeObserver(schedule);
        watch.observe(document.documentElement);
        return () => {
            if (frame)
                window.cancelAnimationFrame(frame);
            window.removeEventListener('scroll', schedule, true);
            window.removeEventListener('resize', schedule);
            watch.disconnect();
        };
    }, [read]);
    return point;
}
function Pin({ comment, index, highlighted, onReposition, }) {
    const fixOn = useFixEnabled(comment.id);
    const previewOff = hasFix(comment.id) && !fixOn;
    const [hovered, setHovered] = useState(false);
    const anchor = useAnchor(comment);
    const baseX = anchor.x + (comment.pinOffset?.dx ?? 0);
    const baseY = anchor.y + (comment.pinOffset?.dy ?? 0);
    const drag = useDraggable(undefined, (point) => {
        onReposition(comment.id, point.x - anchor.x, point.y - anchor.y);
        drag.reset();
    });
    /* The pin steps aside for a look at the element it marks, on either
       one's hover, not only its own. */
    useEffect(() => {
        const selector = comment.element?.selector;
        if (!selector)
            return;
        let target = null;
        try {
            target = document.querySelector(selector);
        }
        catch {
            return;
        }
        if (!target)
            return;
        const onEnter = () => setHovered(true);
        const onLeave = () => setHovered(false);
        target.addEventListener('mouseenter', onEnter);
        target.addEventListener('mouseleave', onLeave);
        return () => {
            target?.removeEventListener('mouseenter', onEnter);
            target?.removeEventListener('mouseleave', onLeave);
        };
    }, [comment.element?.selector]);
    return (_jsx("span", { ref: drag.ref, className: [
            'feedback-pin',
            comment.status === 'proposed' ? 'is-proposed' : '',
            previewOff ? 'is-preview-off' : '',
            highlighted ? 'is-highlighted' : '',
        ]
            .filter(Boolean)
            .join(' '), style: {
            ...(drag.style ?? { left: baseX, top: baseY }),
            opacity: hovered ? 0.25 : undefined,
        }, onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false), ...drag.handle, title: previewOff
            ? `Fix switched off: ${fixLabel(comment.id)}`
            : comment.status === 'proposed'
                ? `Fix ready: ${comment.resolution ?? ''}`
                : comment.text, children: previewOff ? '\u25cb' : index }));
}
/* -------------------------------------------------------------------- */
/* Resolved comments, out of the way at the bottom                      */
/* -------------------------------------------------------------------- */
/**
 * One resolved comment, collapsed to a single line: its number, screen and
 * the first ~60 characters of its text, with a Go button. A click on the
 * line opens the full record \u2014 the whole text, its selector and, when
 * Claude proposed the fix that was accepted, that note too.
 */
function ResolvedRow({ comment, number, view, highlighted, onGo, onDismiss, }) {
    const [open, setOpen] = useState(false);
    const here = onThisScreen(comment, view);
    const screenName = comment.view || (here ? view : 'unknown screen');
    const snippet = comment.text.length > 60 ? `${comment.text.slice(0, 60)}\u2026` : comment.text;
    return (_jsxs("li", { "data-comment-id": comment.id, className: ['feedback-resolved-row', highlighted ? 'is-highlighted' : ''].filter(Boolean).join(' ') ||
            undefined, children: [_jsxs("div", { className: "feedback-resolved-line", role: "button", tabIndex: 0, "aria-expanded": open, onClick: () => setOpen((v) => !v), onKeyDown: (e) => {
                    if (e.key === 'Enter' || e.key === ' ')
                        setOpen((v) => !v);
                }, children: [_jsx("span", { className: "feedback-index is-resolved", children: number }), _jsx("span", { className: "feedback-resolved-screen", children: screenName }), _jsx("span", { className: "feedback-resolved-text", children: snippet }), _jsx("button", { type: "button", className: "fb-btn fb-go", disabled: !here && !comment.url, title: here ? "Scroll to this comment's row" : 'Go to its own screen', onClick: (e) => {
                            e.stopPropagation();
                            onGo(comment);
                        }, children: "Go" }), _jsx(DismissButton, { onConfirm: () => onDismiss(comment.id) })] }), open && (_jsxs("div", { className: "feedback-body feedback-resolved-full", children: [_jsx("p", { children: comment.text }), _jsx("code", { children: comment.element?.selector }), comment.resolution && (_jsxs("p", { className: "feedback-proposal", children: [_jsx("strong", { children: comment.worker ? `fixed by ${comment.worker}` : 'Claude proposed' }), comment.resolution] }))] }))] }));
}
/* -------------------------------------------------------------------- */
/* The proposal, with a switch to see it on and off                     */
/* -------------------------------------------------------------------- */
function FixPreview({ id, note, worker, }) {
    const on = useFixEnabled(id);
    const canPreview = hasFix(id);
    return (_jsxs(_Fragment, { children: [_jsxs("p", { className: "feedback-proposal", title: canPreview ? 'Click to see the page without this fix' : undefined, onClick: canPreview ? () => toggleFix(id) : undefined, children: [_jsx("strong", { children: worker ? `fixed by ${worker}` : 'Claude proposes' }), note] }), canPreview && (_jsxs("span", { className: on ? 'feedback-fix' : 'feedback-fix is-off', children: [_jsx("button", { type: "button", className: "fb-switch", role: "switch", "aria-checked": on, "aria-label": `Preview the fix for ${id}`, title: fixLabel(id), onClick: () => setFixEnabled(id, !on) }), "Fix: ", _jsx("span", { className: "fb-fixlabel", children: on ? 'on' : 'off' })] }))] }));
}
/* -------------------------------------------------------------------- */
/* Dismiss: a quiet way to drop a comment for good                      */
/* -------------------------------------------------------------------- */
/**
 * "Dismiss", muted and out of the way. The first click only asks "Really?",
 * for three seconds; the second, while it still reads that way, calls
 * `onConfirm`. A click anywhere else, or the three seconds passing, drops
 * back to "Dismiss" and asks again next time.
 */
function DismissButton({ onConfirm }) {
    const [confirming, setConfirming] = useState(false);
    const timer = useRef(null);
    useEffect(() => () => {
        if (timer.current)
            window.clearTimeout(timer.current);
    }, []);
    return (_jsx("button", { type: "button", className: confirming ? 'fb-dismiss is-confirming' : 'fb-dismiss', title: confirming ? 'Click again to drop this comment' : 'Drop this comment', onClick: (e) => {
            e.stopPropagation();
            if (!confirming) {
                setConfirming(true);
                timer.current = window.setTimeout(() => setConfirming(false), 3000);
                return;
            }
            if (timer.current)
                window.clearTimeout(timer.current);
            setConfirming(false);
            onConfirm();
        }, children: confirming ? 'Really?' : 'Dismiss' }));
}
/** Keeps the text box inside the window. */
function boxPosition(draft) {
    const width = 300;
    const height = 210;
    const left = Math.min(Math.max(8, draft.x + 16), window.innerWidth - width - 8);
    const top = Math.min(Math.max(8, draft.y - 12), window.innerHeight - height - 8);
    return { left, top };
}
/* -------------------------------------------------------------------- */
/* Fallback store                                                       */
/* -------------------------------------------------------------------- */
function readLocal(key) {
    try {
        const raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : [];
    }
    catch {
        return [];
    }
}
function writeLocal(key, comments) {
    try {
        window.localStorage.setItem(key, JSON.stringify(comments));
    }
    catch {
        /* A browser with no storage keeps nothing. */
    }
}
function saveLocal(key, comment) {
    try {
        const all = readLocal(key);
        all.push({
            id: `local-${all.length + 1}`,
            createdAt: new Date().toISOString(),
            status: 'open',
            text: comment.text,
            pageX: comment.pageX,
            pageY: comment.pageY,
            view: comment.view,
            element: comment.element,
            screen: null,
        });
        window.localStorage.setItem(key, JSON.stringify(all));
    }
    catch {
        /* A browser with no storage simply drops the note. */
    }
}
//# sourceMappingURL=PageComments.js.map