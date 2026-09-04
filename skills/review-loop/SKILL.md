---
name: review-loop
description: Run the design-review loop on a site that mounts page-comments. Find the running collector, watch its comment stream, hand each comment to a worker agent, and mark it proposed. Use when the reviewer says "run the loop", "start the review loop", "fix my comments", or is commenting on dev screens.
---

# Review loop

The reviewer clicks a spot on a development screen and writes a comment.
The page-comments collector stores it and pushes it on a Server-Sent Events
channel. This skill turns each comment into a fix by a worker agent, then
marks it proposed, so the reviewer can switch the fix on and off in the page
and accept or answer it. You coordinate. You do not write the fix yourself.

## 1. Find the collector

The collector lives in the development server. Find which ones are up:

```bash
for p in $(ss -ltn | grep -oE ':[0-9]{4,5}' | tr -d : | sort -u); do
  curl -s -o /dev/null -w "$p %{http_code}\n" --max-time 1 \
    http://localhost:$p/__feedback/api/comments
done
```

A port that answers 200 has a collector. If more than one does, list each
with its project directory (`ls -l /proc/<pid>/cwd`) and ask which. The port
the reviewer's browser uses is the reviewer's server. Never restart, kill or
start anything on it.

The project's own npm script names the store and the fixes file:

```bash
grep -n 'page-comments' package.json
```

## 2. Arm the watch

Reconnect in a loop, and keep only what needs an answer:

```bash
while true; do
  npx page-comments --store <store> --fixes <fixes> \
    --watch --server http://localhost:<port> 2>&1 \
  | grep --line-buffered -E '"status": *"open"|"author": *"human"'
  sleep 3
done
```

Each event is one JSON line with `id`, `text`, `view`, `url`, `element`
(selector, components, text) and `replies`. Read the full record from the
store file when the event is truncated.

The store is the truth, not the page. A page showing open comments the store
does not have is stale and needs one reload.

## 3. Dispatch

One worker agent per comment, started the moment the event arrives. Do not
batch. Do not wait for the previous agent unless it holds the same file
region; then send the new comment to that agent instead of starting another.

Use a small, fast model for a change on one screen or in one stylesheet
block: copy, size, spacing, colour, one component. Use a large model for
anything that touches the server, several modules, or needs a design
decision. The checklist below costs the time, not the model.

## 4. The brief

Every brief carries these parts, in this order:

1. The repo path, the files the agent may not touch (generated data,
   `node_modules`, the comment store, the development server config), and
   the files other agents hold right now. Re-read before editing.
2. Never start, stop or restart anything on the reviewer's port. An agent
   that needs a browser starts its own server on its own port.
3. First command: `npx page-comments --pickup <id> <worker>`. This makes the
   "being worked on by" line appear for the reviewer.
4. The comment verbatim, the element it points at (selector, components,
   text), and the screen address.
5. The toggle rule: register the id in the fixes file, and wrap the change
   so that OFF gives back the old look exactly. Style through
   `html[data-fix-off~="cNNN"]` rules, markup and logic through
   `useFixEnabled("cNNN")`. A follow-up on an existing fix reuses its id.
6. The everywhere rule: grep for the class, component, helper or wording,
   change it at the shared source, and report every other screen reached and
   every place left out with the reason.
7. Verification: the project's own type check and tests. For a visible
   change, one screenshot per width that matters, looked at, and kept out of
   the repo.
8. Last command: `npx page-comments --propose <id> "<one sentence>"
   --toggle`. That sentence is what the reviewer reads in the page.
9. Style: match the voice of the surrounding files, imports at the top, no
   dead code, no new dependencies.

An answer from the reviewer arrives as a reply event with `author: human`
and the comment back at open. Dispatch again with the reply text and the
same id.

## 5. Files that restart the development server

The server config, `package.json`, `tsconfig*.json` and anything the config
imports restart the server when saved, and a restart reloads every connected
page. An agent that must change one of those edits a copy elsewhere and
swaps it in once, at the end, and says so. Component and stylesheet edits
restart nothing.

Run the reviewer's server with `holdReloads`, so a save never pulls the
screen out from under them. They see new code only after they ask for it.
Say so when a change lands.

## 6. Browsers

Worker browsers must be headless. A headed browser steals focus and, on a
tiling window manager, breaks the reviewer's layout. Do not drive the
reviewer's own browser.

## 7. What to tell the reviewer

One or two sentences per landed fix: what changed, where else it reached,
and that it is waiting in the page. Nothing about agents' internals or test
counts unless something failed. When a comment turns out to be the
environment rather than the code, say that plainly and fix the environment.
