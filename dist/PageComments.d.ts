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
import { type JSX } from 'react';
/** Where the collector answers, and where this browser keeps its own state. */
export interface PageCommentsProps {
    /** The collector, without a trailing slash. */
    apiBase?: string;
    /** Names the keys in this browser: <prefix>.queue, .dock and .fixes. */
    storagePrefix?: string;
    /** Comment ids with a fix that can be switched off, one line of text each. */
    fixes?: Record<string, string>;
    /**
     * The screen this page shows now. A pin only appears on its own screen.
     * Without it, the value of `document.body.dataset.screen` is used.
     */
    screen?: string;
    /** How often an open list asks the collector again, in milliseconds. */
    pollMs?: number;
    /** The word on the button that arms the picker. */
    label?: string;
    /**
     * Extra facts about the element under the click, merged over the ones this
     * component reads itself. A host that knows more about its own page — the
     * components that drew the element, a better path — says so here.
     */
    annotate?: (element: Element) => Partial<ElementNote>;
    /**
     * Puts a badge beside the button, kept live from the collector's events
     * channel: how many comments carry a fix waiting on a check, and how many
     * are being worked on right now. It also says when only code changed. One
     * click on the ready badge loads the page with every one of those fixes
     * switched off, so the old look is what appears and each fix is switched
     * on by hand.
     *
     * It needs the collector's events channel, and it is only worth having on
     * a development server that holds its reloads back — see the plugin's
     * `holdReloads`. Default off.
     */
    reviewMode?: boolean;
    /** Where the events channel answers. Default `/__comments/events`. */
    eventsUrl?: string;
    /**
     * Which window the badge reloads. A tool inside a frame that is the whole
     * point of the page around it says "top". Default "self".
     */
    reviewReload?: 'self' | 'top';
    /**
     * Which window the "Go" button on a comment from another page navigates.
     * A tool inside a frame that is the whole point of the page around it
     * says "top". Default "self".
     */
    navigateReload?: 'self' | 'top';
    /**
     * Turns a comment's stored address into the one to actually navigate to,
     * before the window named by `navigateReload` loads it. A host inside a
     * frame strips whatever names the frame, so the address it navigates to
     * is the one a person would type. Without it, the stored address is used
     * as it is.
     */
    navigateTo?: (url: string) => string;
}
export interface ElementNote {
    tag: string;
    id: string;
    classes: string[];
    selector: string;
    text: string;
    /** What the host added: the components that drew this element, and such. */
    components?: string[];
    rect: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
}
export interface CommentDraft {
    x: number;
    y: number;
    pageX: number;
    pageY: number;
    viewportWidth: number;
    viewportHeight: number;
    devicePixelRatio: number;
    url: string;
    /** The screen the comment was made on, as the host names its screens. */
    view: string;
    element: ElementNote;
}
export interface Reply {
    author: 'human' | 'claude';
    text: string;
    ts: string;
}
/** The shape the collector gives back. */
export interface StoredComment {
    id: string;
    createdAt: string;
    /** open: waiting. working: picked up. proposed: a fix is ready. resolved: accepted. */
    status: string;
    text: string;
    /** The address of the page the comment was made on. */
    url?: string;
    /** Who is on it: set on pickup, kept once a fix is proposed. */
    worker?: string | null;
    /** The screen the comment was made on. Older comments have none. */
    view?: string | null;
    /** The click in viewport coordinates, as the page stood at the time. */
    viewport?: {
        x: number;
        y: number;
        width?: number;
        height?: number;
    };
    page?: {
        x: number;
        y: number;
    };
    pageX?: number;
    pageY?: number;
    /** Where a pull left the pin, away from the point recorded above. */
    pinOffset?: {
        dx: number;
        dy: number;
    } | null;
    element?: ElementNote;
    screen?: {
        url: string;
    } | null;
    /** What Claude says was changed. */
    resolution?: string | null;
    replies?: Reply[];
}
export declare function PageComments({ apiBase, storagePrefix, fixes, screen, pollMs, label, annotate, reviewMode, eventsUrl, reviewReload, navigateReload, navigateTo, }?: PageCommentsProps): JSX.Element;
//# sourceMappingURL=PageComments.d.ts.map