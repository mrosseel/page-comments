# @mrosseel/page-comments

In-page comments for a React site. A reviewer clicks a spot on the screen and
writes a note. An agent picks the note up, changes the code, and proposes a
fix. The reviewer sees the fix switched on and off, then accepts it or sends
it back.

Everything runs on the development server. Nothing here reaches production
unless you mount it there yourself.

MIT licensed.

## Install

```sh
npm install --save-dev @mrosseel/page-comments
```

React 18.3 or later is a peer dependency. Vite 5 or later is an optional peer
dependency, needed only if you use the Vite plugin.

## Set up

The collector is a Connect-style middleware. It knows nothing about any one
development server, so mount it wherever you mount middleware.

Express, Connect, or a Node server:

```js
import { createCollector } from "@mrosseel/page-comments/collector";

app.use(createCollector().middleware);
```

webpack-dev-server:

```js
devServer: {
  setupMiddlewares(middlewares) {
    middlewares.unshift(createCollector().middleware);
    return middlewares;
  },
}
```

Vite has a plugin, because it can do one thing the others cannot: hold hot
updates back while somebody is writing a comment.

```ts
// vite.config.ts
import { pageCommentsPlugin } from "@mrosseel/page-comments/vite-plugin";

export default defineConfig({
  plugins: [react(), pageCommentsPlugin({ holdReloads: true })],
});
```

Mount the component on the screens you want to review:

```tsx
import { PageComments } from "@mrosseel/page-comments";
import "@mrosseel/page-comments/styles.css";

<PageComments storagePrefix="mysite.comments" />;
```

The collector writes to `comments/comments.json` and puts screen shots in
`comments/shots/`. Add that folder to `.gitignore`, or commit it if you want
the review history.

## Read and answer comments

```sh
npx page-comments                       # open, working and proposed
npx page-comments --watch               # wait, one JSON line per change
npx page-comments --pickup c001 sonnet  # tell the reviewer you are on it
npx page-comments --propose c001 "dropped the tag line" --toggle
npx page-comments --resolve c001
```

`--watch` opens the collector's events channel, so a program needs no timer.
Any HTTP client can read the same channel:

```sh
curl -N http://localhost:5173/__comments/events
```

## Preview switches

A change to what the reviewer sees is worth more when they can compare it to
what was there before. Name each fix by its comment id:

```ts
import { registerFixes, useFixEnabled } from "@mrosseel/page-comments/fixes";

registerFixes({ c001: "The header is only the wordmark." });
```

Then read the switch where the change is:

```tsx
const slim = useFixEnabled("c001");
return slim ? <Wordmark /> : <FullHeader />;
```

A fix made only of styles needs no React. The ids that are switched off sit
on `html[data-fix-off]`:

```css
.topbar { height: 40px; }
html[data-fix-off~="c001"] .topbar { height: 56px; }
```

`@mrosseel/page-comments/fixes` is a separate entry point. A production
component can read a switch without pulling in the comment interface.

## Component properties

| Property | Default | What it does |
| --- | --- | --- |
| `apiBase` | `/__feedback/api` | Where the collector answers. |
| `storagePrefix` | `page-comments` | Names this browser's keys: `.queue`, `.dock`, `.fixes`. |
| `fixes` | none | Comment ids with a fix, one line of text each. |
| `screen` | `document.body.dataset.screen` | The screen this page shows now. A pin only appears on its own screen. |
| `pollMs` | `4000` | How often an open list asks the collector again. |
| `label` | `Comment` | The word on the button that arms the picker. |
| `annotate` | none | Extra facts about the element under the click. |
| `reviewMode` | `false` | Badges that count fixes ready and fixes under way, live. |
| `eventsUrl` | `/__comments/events` | Where the events channel answers. |
| `reviewReload` | `self` | Which window the ready badge reloads. |
| `navigateReload` | `self` | Which window a comment's Go button navigates. |
| `navigateTo` | none | Turns a stored address into the one to load. |

`reviewReload` and `navigateReload` take `top` for a tool inside a frame.

## Collector options

| Option | Default | What it does | Where |
| --- | --- | --- | --- |
| `dir` | `comments` | The folder for the comment file and the screen shots. | Both |
| `holdReloads` | `false` | Drops every code update instead of pushing it at the page. | Vite plugin |

`holdReloads` is for review sessions. A reviewer mid-sentence must not lose
the screen because a worker saved a file. The page hears a `changed` event
instead, and offers a reload rather than taking one. It needs Vite's hot
update channel, so only the plugin has it.

`createCollector()` also gives you `announce(event, data)` to push your own
event, `setRoot(path)` if the root is known only later, and the resolved
`root`, `dir` and `store` paths.

## Collector API

The plugin answers these on the development server only.

```
GET    /__feedback/api/comments?status=open|working|proposed|active|resolved|all
POST   /__feedback/api/comments      one comment object
POST   /__feedback/api/pin           { id, dx, dy }
POST   /__feedback/api/pickup        { id, worker }
POST   /__feedback/api/propose       { id, note }
POST   /__feedback/api/reply         { id, author, text }
POST   /__feedback/api/resolve       { ids, note? }
DELETE /__feedback/api/comments/<id>
GET    /__comments/shots/<id>.jpg
GET    /__comments/events
```

The events channel sends the whole store as one `store` event on connect,
then one event per change: `comment`, `pickup`, `reply`, `propose`,
`resolve`, `pin`, `remove`, and `changed` when only code changed.

## The loop, for an agent

1. `npx page-comments --watch` and wait. Each comment arrives as one line of
   JSON: the text, the CSS path of the element, the screen, the point.
2. `npx page-comments --pickup <id> <worker>`, so the reviewer sees who is on
   it before any code changes.
3. Make the change. If it changes what the reviewer sees, register the
   comment id as a fix and wrap the change so that OFF gives back the old
   look.
4. `npx page-comments --propose <id> "what was done" --toggle`.
5. The reviewer accepts, which resolves the comment, or answers, which sends
   it back to open. Either arrives on the same watch.

## The agent skill

The package ships the review loop as a Claude Code skill, so an agent can run
it without being told how each time. Install it for one project:

```sh
mkdir -p .claude/skills
cp -r node_modules/@mrosseel/page-comments/skills/review-loop .claude/skills/
```

Use `~/.claude/skills/` instead to have it everywhere. The skill covers
finding the running collector, watching the stream, what a worker's brief
must carry, and which files restart the development server. Read it at
`skills/review-loop/SKILL.md`.

## Class names

Every class starts with `feedback-` or `fb-`, and every custom property with
`--fb-`. Nothing here collides with a host's own names. Override the
properties to match your colours.
