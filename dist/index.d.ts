/**
 * In page comments for any React site.
 *
 * USE
 *   import { PageComments } from '@mrosseel/page-comments';
 *   import '@mrosseel/page-comments/styles.css';
 *
 *   <PageComments storagePrefix="mysite.comments" fixes={FIXES} />
 *
 * The component draws its own button, its pins and its list. It talks to a
 * small collector. In a Vite site, add the collector to the development
 * server:
 *
 *   import { pageCommentsPlugin } from '@mrosseel/page-comments/vite-plugin';
 *   plugins: [react(), pageCommentsPlugin()]
 *
 * The collector keeps the comments in comments/comments.json and the screen
 * shots beside it. Read and answer them from a terminal with the command
 * line tool in this package:
 *
 *   npx page-comments --propose c001 "note"
 *
 * A fix that changes what the person sees should carry a switch, so it can
 * be seen on and off before it is accepted. Name the fixes once, then read
 * the switch where the change is made:
 *
 *   registerFixes({ c001: 'The header is only the wordmark.' });
 *   const slim = useFixEnabled('c001');
 *
 * A fix made only of styles needs no React code: the ids that are switched
 * off sit on `html[data-fix-off]`, so a rule can give back the old look:
 *
 *   html[data-fix-off~='c001'] .topbar { height: 56px; }
 */
export { PageComments, type PageCommentsProps } from './PageComments.js';
export type { CommentDraft, ElementNote, Reply, StoredComment } from './PageComments.js';
export { fixLabel, fixRegistry, hasFix, isFixEnabled, registerFixes, setFixEnabled, toggleFix, useFixEnabled, type FixId, } from './fixes.js';
export { useDraggable, type Draggable, type Point } from './useDraggable.js';
//# sourceMappingURL=index.d.ts.map