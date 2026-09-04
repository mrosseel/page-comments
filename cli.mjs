#!/usr/bin/env node
/**
 * Reads the comments people left in the running site, and answers them.
 *
 * Usage:
 *   node cli.mjs                        open and proposed
 *   node cli.mjs --all                  every comment
 *   node cli.mjs --json                 raw JSON, for a program
 *   node cli.mjs --pickup c001 sonnet   a worker is on it
 *   node cli.mjs --propose c001 "note"  a fix is ready
 *   node cli.mjs --propose c001 "note" --toggle   the fix has a switch
 *   node cli.mjs --store comments/comments.json  where the comments are
 *   node cli.mjs --fixes src/fixes.ts            where the fixes are named
 *   node cli.mjs --reply c001 "text"    a note, no state change
 *   node cli.mjs --resolve c001 c002    accept, on behalf
 *   node cli.mjs --watch                wait for comments, one JSON line each
 *   node cli.mjs --watch --server http://localhost:5173
 *
 * A comment is open, working, proposed or resolved. The person accepts a
 * proposal in the page, or answers it, which sends the comment back to open.
 * `--pickup` needs the development server running, since it names the
 * worker on the record there and lets everyone watching hear about it.
 *
 * The same data is on the development server:
 *   GET  /__feedback/api/comments?status=active
 *   POST /__feedback/api/pickup   { "id": "c001", "worker": "sonnet" }
 *   POST /__feedback/api/propose  { "id": "c001", "note": "..." }
 *   POST /__feedback/api/reply    { "id": "c001", "author": "claude", ... }
 *   POST /__feedback/api/resolve  { "ids": ["c001"] }
 *   GET  /__comments/events       the same news, pushed as it happens
 *
 * THE LOOP FOR A PROGRAM
 *   1. `--watch` and wait. Every new or changed comment arrives as one line
 *      of JSON on standard output, so a reader needs no polling and no timer.
 *   2. `--pickup <id> <worker>`, so the person sees who is on it before any
 *      code changes.
 *   3. Make the change. If it changes what the person sees, register the
 *      comment id as a fix, so it carries a switch.
 *   4. `--propose <id> "what was done" --toggle`. The comment turns up in the
 *      page as a proposal with the switch beside it.
 *   5. The person accepts it, which resolves the comment, or answers it,
 *      which sends it back to open and arrives on the watch as a reply.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);

/** The store, and the file that names the fixes, both may be given. */
function option(name, fallback) {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
}

const file = resolve(process.cwd(), option('--store', 'comments/comments.json'));
const fixesFile = resolve(process.cwd(), option('--fixes', 'src/fixes.ts'));
const wantAll = args.includes('--all');
const asJson = args.includes('--json');
const resolveIndex = args.indexOf('--resolve');
const pickupIndex = args.indexOf('--pickup');
const proposeIndex = args.indexOf('--propose');
const replyIndex = args.indexOf('--reply');
const wantToggle = args.includes('--toggle');
const wantWatch = args.includes('--watch');
const server = option('--server', 'http://localhost:5173');

/**
 * The ids registered in the fixes file. Every proposal that changes what
 * the person sees must be there, so the fix can be previewed off.
 */
function registeredFixIds() {
  try {
    const source = readFileSync(fixesFile, 'utf8');
    const block = source.match(/FIX_IDS[^{]*\{([\s\S]*?)\n\};/);
    if (!block) return [];
    return [...block[1].matchAll(/^\s*([A-Za-z0-9_]+)\s*:/gm)].map((m) => m[1]);
  } catch {
    return [];
  }
}

/** Fills in fields that comments from an older build have not got. */
function normalize(c) {
  return {
    resolution: null,
    proposedAt: null,
    view: null,
    worker: null,
    pickedUpAt: null,
    pinOffset: null,
    replies: [],
    ...c,
    status: c.status ?? 'open',
    replies: Array.isArray(c.replies) ? c.replies : [],
  };
}

function load() {
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed.map(normalize) : [];
  } catch {
    return [];
  }
}

function save(comments) {
  writeFileSync(file, `${JSON.stringify(comments, null, 2)}\n`, 'utf8');
}

/**
 * Waits on the collector's events channel and prints every comment that is
 * new or has changed, one JSON object per line. Ends on Ctrl-C.
 *
 * The channel sends the whole store on connect. That first load is the state
 * of the world, not news, so it is only remembered.
 */
async function watch() {
  const seen = new Map();
  const address = `${server.replace(/\/$/, '')}/__comments/events`;
  const res = await fetch(address, { headers: { Accept: 'text/event-stream' } });
  if (!res.ok || !res.body) throw new Error(`the collector at ${address} said ${res.status}`);
  console.error(`Watching ${address}. Ctrl-C stops.`);

  /** Prints what is worth printing, and remembers what was printed. */
  const report = (list, quiet) => {
    for (const c of list) {
      const mark = `${c.status}:${(c.replies ?? []).length}:${c.text}`;
      if (seen.get(c.id) === mark) continue;
      seen.set(c.id, mark);
      if (!quiet) console.log(JSON.stringify(c));
    }
  };

  let buffer = '';
  for await (const chunk of res.body) {
    buffer += Buffer.from(chunk).toString('utf8');
    let cut = buffer.indexOf('\n\n');
    for (; cut >= 0; cut = buffer.indexOf('\n\n')) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      let name = 'message';
      const data = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) name = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trim());
      }
      if (data.length === 0) continue;
      let body;
      try {
        body = JSON.parse(data.join('\n'));
      } catch {
        continue;
      }
      const first = name === 'store' && seen.size === 0;
      report(body.comments ?? (body.comment ? [body.comment] : []), first);
    }
  }
}

if (wantWatch) {
  await watch().catch((err) => {
    console.error(String(err?.message ?? err));
    process.exit(1);
  });
  process.exit(0);
}

if (pickupIndex >= 0) {
  const id = args[pickupIndex + 1];
  const worker = args[pickupIndex + 2];
  if (!id || !worker) {
    console.error('Usage: node cli.mjs --pickup <id> <worker>');
    process.exit(1);
  }
  const address = `${server.replace(/\/$/, '')}/__feedback/api/pickup`;
  try {
    const res = await fetch(address, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, worker }),
    });
    if (!res.ok) throw new Error(`the collector said ${res.status}`);
    console.log(`${id} picked up by ${worker}.`);
    process.exit(0);
  } catch (err) {
    console.error(
      `Could not reach the collector at ${address}: ${String(err?.message ?? err)}`,
    );
    process.exit(1);
  }
}

const all = load();

if (proposeIndex >= 0 || replyIndex >= 0) {
  const isPropose = proposeIndex >= 0;
  const index = isPropose ? proposeIndex : replyIndex;
  const id = args[index + 1];
  const text = args[index + 2];
  if (!id || !text) {
    console.error(`Usage: node cli.mjs ${isPropose ? '--propose' : '--reply'} <id> "text"`);
    process.exit(1);
  }
  const found = all.find((c) => c.id === id);
  if (!found) {
    console.error(`No comment ${id}.`);
    process.exit(1);
  }
  const now = new Date().toISOString();
  found.replies.push({ author: 'claude', text, ts: now });
  if (isPropose) {
    found.status = 'proposed';
    found.resolution = text;
    found.proposedAt = now;
  }
  if (isPropose) {
    const known = registeredFixIds();
    if (wantToggle && !known.includes(id)) {
      console.warn(
        `Warning: ${id} is not in FIX_IDS in the fixes file. ` +
          'Register it and wrap the change, so the person can preview it off.',
      );
    } else if (!wantToggle && !known.includes(id)) {
      console.warn(
        `Note: ${id} has no preview switch. If the fix changes what the person ` +
          'sees, add it to FIX_IDS in the fixes file and pass --toggle.',
      );
    }
  }
  save(all);
  console.log(
    isPropose
      ? `${id} is now proposed. The person accepts it or answers in the page.`
      : `${id} got a note from Claude. Status stays ${found.status}.`,
  );
  process.exit(0);
}

if (resolveIndex >= 0) {
  const ids = new Set(args.slice(resolveIndex + 1));
  let changed = 0;
  for (const c of all) {
    if (!ids.has(c.id)) continue;
    c.status = 'resolved';
    c.resolvedAt = new Date().toISOString();
    changed += 1;
  }
  save(all);
  console.log(`Marked ${changed} comment(s) resolved.`);
  process.exit(0);
}

const list = wantAll ? all : all.filter((c) => c.status !== 'resolved');

if (asJson) {
  console.log(JSON.stringify(list, null, 2));
  process.exit(0);
}

if (list.length === 0) {
  console.log('No comments. Start the app, press "Comment", and click a spot.');
  process.exit(0);
}

for (const c of list) {
  const el = c.element ?? {};
  const classes = (el.classes ?? []).join('.');
  console.log(`\n${c.id}  [${c.status}]  ${c.createdAt}`);
  console.log(`  says     : ${c.text}`);
  console.log(
    `  point    : viewport ${c.viewport?.x}, ${c.viewport?.y} ` +
      `in ${c.viewport?.width}x${c.viewport?.height} (dpr ${c.viewport?.devicePixelRatio})`,
  );
  if (c.view) console.log(`  screen   : ${c.view}`);
  if (c.worker) console.log(`  worker   : ${c.worker}${c.status === 'working' ? ' (on it)' : ''}`);
  console.log(`  element  : <${el.tag}>${classes ? `.${classes}` : ''}`);
  console.log(`  path     : ${el.selector}`);
  if (el.components?.length) console.log(`  drawn by : ${el.components.join(' in ')}`);
  if (el.rect) {
    console.log(
      `  box      : x ${el.rect.x} y ${el.rect.y} w ${el.rect.width} h ${el.rect.height}`,
    );
  }
  if (el.text) console.log(`  reads    : ${el.text}`);
  if (c.resolution) console.log(`  proposal : ${c.resolution}`);
  if (c.screen?.file) console.log(`  shot     : ${c.screen.file}`);
  for (const r of c.replies ?? []) {
    console.log(`  ${r.author === 'claude' ? 'claude ' : 'person '} : ${r.text}`);
  }
}
console.log(`\n${list.length} comment(s).`);
