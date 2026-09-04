/**
 * The collector for in-page comments: a Connect-style middleware and a
 * store on disk.
 *
 * Nothing here knows about any one development server. The middleware has
 * the `(req, res, next)` shape that Connect, Express, Vite, webpack-dev-server
 * and a Next.js custom server all take, so a host mounts it the way it mounts
 * any other middleware. `./vite-plugin.mjs` is one such host, and holds Vite's
 * hot updates back on top.
 *
 * The interface posts a comment for one point on the screen. This collector
 * writes every comment to `comments/comments.json` and every screen shot to
 * `comments/shots/<id>.jpg`, then serves them back. `dir` names another
 * folder.
 *
 * A comment moves through four states:
 *   open      the person asked for a change
 *   working   a worker, an agent or a person, picked it up
 *   proposed  the worker changed the code and wrote what was done
 *   resolved  the person accepted the change
 * A reply from the person on a proposed comment sends it back to open.
 *
 * HTTP API:
 *   GET    /__feedback/api/comments?status=open|working|proposed|active|resolved|all
 *   POST   /__feedback/api/comments      body: one comment object
 *   POST   /__feedback/api/pin           body: { id, dx, dy }
 *   POST   /__feedback/api/pickup        body: { id, worker }
 *   POST   /__feedback/api/propose       body: { id, note }
 *   POST   /__feedback/api/reply         body: { id, author, text }
 *   POST   /__feedback/api/resolve       body: { ids: string[], note?: string }
 *   DELETE /__feedback/api/comments/<id>
 *   GET    /__comments/shots/<id>.jpg
 *   GET    /__comments/events              server sent events, see below
 *
 * The events channel is for a program that waits instead of polling. On
 * connect it sends the whole store as one `store` event; after that one event
 * per change: `comment` when somebody writes one, `pickup`, `reply`,
 * `propose` and `resolve` as they happen, and `store` again whenever the
 * file changes under the server, which is how a change made by the command
 * line tool arrives.
 * Any HTTP client can read it, `curl -N` included.
 *
 * A comment holds the click point in viewport and page coordinates, the size
 * of the viewport, the element under the click with its class list and CSS
 * path, the text the person wrote, the proposal note and the reply thread.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  unwatchFile,
  watchFile,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_BODY_BYTES = 12 * 1024 * 1024;

function ensureDir(path) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

/** Fills in the fields a comment written by an older build has not got. */
function normalize(comment) {
  return {
    resolution: null,
    proposedAt: null,
    view: null,
    worker: null,
    pickedUpAt: null,
    pinOffset: null,
    ...comment,
    status: comment.status ?? 'open',
    replies: Array.isArray(comment.replies) ? comment.replies : [],
  };
}

function readStore(file) {
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed.map(normalize) : [];
  } catch {
    return [];
  }
}

function writeStore(file, comments) {
  ensureDir(dirname(file));
  writeFileSync(file, `${JSON.stringify(comments, null, 2)}\n`, 'utf8');
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(text);
}

function readBody(req) {
  return new Promise((done, fail) => {
    let size = 0;
    const parts = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        fail(new Error('the comment is too large'));
        req.destroy();
        return;
      }
      parts.push(chunk);
    });
    req.on('end', () => {
      try {
        done(parts.length === 0 ? {} : JSON.parse(Buffer.concat(parts).toString('utf8')));
      } catch (err) {
        fail(err);
      }
    });
    req.on('error', fail);
  });
}

function nextId(comments) {
  let top = 0;
  for (const c of comments) {
    const n = Number.parseInt(String(c.id).replace(/\D/g, ''), 10);
    if (Number.isFinite(n) && n > top) top = n;
  }
  return `c${String(top + 1).padStart(3, '0')}`;
}

/** Keeps only the fields the collector understands. */
function cleanComment(input, id) {
  const el = input.element ?? {};
  return {
    id,
    createdAt: new Date().toISOString(),
    status: 'open',
    text: String(input.text ?? '').slice(0, 4000),
    url: String(input.url ?? '').slice(0, 500),
    /* The screen the comment was made on, as the host names its screens. */
    view: input.view ? String(input.view).slice(0, 40) : null,
    viewport: {
      x: Number(input.x) || 0,
      y: Number(input.y) || 0,
      width: Number(input.viewportWidth) || 0,
      height: Number(input.viewportHeight) || 0,
      devicePixelRatio: Number(input.devicePixelRatio) || 1,
    },
    page: { x: Number(input.pageX) || 0, y: Number(input.pageY) || 0 },
    element: {
      tag: String(el.tag ?? '').slice(0, 40),
      id: String(el.id ?? '').slice(0, 120),
      classes: Array.isArray(el.classes) ? el.classes.slice(0, 20).map(String) : [],
      selector: String(el.selector ?? '').slice(0, 600),
      /* What the host knew about the element: the components that drew it. */
      components: Array.isArray(el.components) ? el.components.slice(0, 8).map(String) : [],
      text: String(el.text ?? '').slice(0, 200),
      rect: {
        x: Number(el.rect?.x) || 0,
        y: Number(el.rect?.y) || 0,
        width: Number(el.rect?.width) || 0,
        height: Number(el.rect?.height) || 0,
      },
    },
    screen: null,
    resolution: null,
    proposedAt: null,
    worker: null,
    pickedUpAt: null,
    pinOffset: null,
    replies: [],
  };
}

/** open and proposed together: everything still waiting on somebody. */
function matchesStatus(comment, status) {
  if (status === 'all') return true;
  if (status === 'active') return comment.status !== 'resolved';
  return comment.status === status;
}

/**
 * Writes the data URL of a screen shot next to the comments. `folder` is the
 * host's own name for that directory, so the path kept on the record is the
 * one a person would type, whatever the plugin was configured with.
 */
function saveShot(dir, folder, id, dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return null;
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;
  const bytes = Buffer.from(dataUrl.slice(comma + 1), 'base64');
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return null;
  const shots = join(dir, 'shots');
  ensureDir(shots);
  const file = join(shots, `${id}.jpg`);
  writeFileSync(file, bytes);
  return { file: `${folder}/shots/${id}.jpg`, url: `/__comments/shots/${id}.jpg` };
}

export function createCollector(options = {}) {
  const folder = options.dir ?? 'comments';
  /* One line per change, so the person running the server sees the review
     happen. A host with a logger of its own passes it in. */
  const log = options.log ?? ((line) => console.log(line));
  let root = process.cwd();
  let dir = resolve(root, folder);
  let store = join(dir, 'comments.json');

  /* Everybody listening on the events channel. A watcher on the file joins
     them for as long as at least one is there, so a change made outside the
     server — the command line tool proposing a fix — is announced too. */
  const listeners = new Set();

  function push(res, event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  function announce(event, data) {
    for (const res of listeners) {
      try {
        push(res, event, data);
      } catch {
        listeners.delete(res);
      }
    }
  }

  function watchStore() {
    watchFile(store, { interval: 1000 }, () => {
      announce('store', { comments: readStore(store) });
    });
  }

  /**
   * Points the collector at another project root. A host that learns its
   * root after the collector was made, Vite in `configResolved`, says so
   * here.
   */
  function setRoot(next) {
    root = next;
    dir = resolve(next, folder);
    store = join(dir, 'comments.json');
  }

  /** Connect style. Anything outside the two prefixes falls through. */
  async function middleware(req, res, next) {

      const url = req.url ?? '';
      if (!url.startsWith('/__feedback') && !url.startsWith('/__comments')) return next();
      const path = url.split('?')[0];

      try {
        if (path === '/__feedback/api/comments' && req.method === 'GET') {
          const status = new URL(url, 'http://x').searchParams.get('status') ?? 'open';
          const all = readStore(store);
          const list = all.filter((c) => matchesStatus(c, status));
          return sendJson(res, 200, { count: list.length, comments: list });
        }

        if (path === '/__feedback/api/comments' && req.method === 'POST') {
          const body = await readBody(req);
          if (!String(body.text ?? '').trim()) {
            return sendJson(res, 400, { error: 'the comment needs text' });
          }
          const all = readStore(store);
          const comment = cleanComment(body, nextId(all));
          comment.screen = saveShot(dir, folder, comment.id, body.image);
          all.push(comment);
          writeStore(store, all);
          log(`page-comments ${comment.id}: ${comment.text.slice(0, 70)}`);
          announce('comment', { comment });
          return sendJson(res, 201, { comment });
        }

        if (path === '/__feedback/api/pin' && req.method === 'POST') {
          const body = await readBody(req);
          const all = readStore(store);
          const found = all.find((c) => c.id === String(body.id));
          if (!found) return sendJson(res, 404, { error: 'no such comment' });
          found.pinOffset = { dx: Number(body.dx) || 0, dy: Number(body.dy) || 0 };
          writeStore(store, all);
          announce('pin', { comment: found });
          return sendJson(res, 200, { comment: found });
        }

        if (path === '/__feedback/api/pickup' && req.method === 'POST') {
          const body = await readBody(req);
          const worker = String(body.worker ?? '').trim();
          if (!worker) return sendJson(res, 400, { error: 'the pickup needs a worker' });
          const all = readStore(store);
          const found = all.find((c) => c.id === String(body.id));
          if (!found) return sendJson(res, 404, { error: 'no such comment' });
          found.status = 'working';
          found.worker = worker.slice(0, 60);
          found.pickedUpAt = new Date().toISOString();
          writeStore(store, all);
          log(`page-comments ${found.id}: picked up by ${found.worker}`);
          announce('pickup', { comment: found });
          return sendJson(res, 200, { comment: found });
        }

        if (path === '/__feedback/api/propose' && req.method === 'POST') {
          const body = await readBody(req);
          const note = String(body.note ?? '').trim();
          if (!note) return sendJson(res, 400, { error: 'the proposal needs a note' });
          const all = readStore(store);
          const found = all.find((c) => c.id === String(body.id));
          if (!found) return sendJson(res, 404, { error: 'no such comment' });
          found.status = 'proposed';
          found.resolution = note.slice(0, 2000);
          found.proposedAt = new Date().toISOString();
          found.replies.push({
            author: 'claude',
            text: note.slice(0, 2000),
            ts: found.proposedAt,
          });
          writeStore(store, all);
          log(`page-comments ${found.id}: proposed a fix`);
          announce('propose', { comment: found });
          return sendJson(res, 200, { comment: found });
        }

        if (path === '/__feedback/api/reply' && req.method === 'POST') {
          const body = await readBody(req);
          const text = String(body.text ?? '').trim();
          if (!text) return sendJson(res, 400, { error: 'the reply needs text' });
          const author = body.author === 'claude' ? 'claude' : 'human';
          const all = readStore(store);
          const found = all.find((c) => c.id === String(body.id));
          if (!found) return sendJson(res, 404, { error: 'no such comment' });
          found.replies.push({
            author,
            text: text.slice(0, 2000),
            ts: new Date().toISOString(),
          });
          // A person who answers a proposal sends the work back.
          if (author === 'human' && found.status !== 'resolved') {
            found.status = 'open';
          }
          writeStore(store, all);
          log(`page-comments ${found.id}: ${author} replied, status ${found.status}`);
          announce('reply', { comment: found });
          return sendJson(res, 200, { comment: found });
        }

        if (path === '/__feedback/api/resolve' && req.method === 'POST') {
          const body = await readBody(req);
          const ids = new Set((body.ids ?? []).map(String));
          const all = readStore(store);
          let changed = 0;
          for (const c of all) {
            if (!ids.has(c.id)) continue;
            c.status = 'resolved';
            c.resolvedAt = new Date().toISOString();
            if (body.note) {
              c.resolution = String(body.note).slice(0, 2000);
              c.replies.push({
                author: body.author === 'claude' ? 'claude' : 'human',
                text: String(body.note).slice(0, 2000),
                ts: c.resolvedAt,
              });
            }
            changed += 1;
          }
          writeStore(store, all);
          announce('resolve', { ids: [...ids], resolved: changed });
          return sendJson(res, 200, { resolved: changed });
        }

        if (path.startsWith('/__feedback/api/comments/') && req.method === 'DELETE') {
          const id = path.slice('/__feedback/api/comments/'.length);
          const all = readStore(store);
          const kept = all.filter((c) => c.id !== id);
          writeStore(store, kept);
          const shot = join(dir, 'shots', `${id}.jpg`);
          if (existsSync(shot)) unlinkSync(shot);
          announce('remove', { id });
          return sendJson(res, 200, { removed: all.length - kept.length });
        }

        if (path === '/__comments/events' && req.method === 'GET') {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('Connection', 'keep-alive');
          /* A proxy that buffers would hold every event back until the
             stream ends, which is never. */
          res.setHeader('X-Accel-Buffering', 'no');
          if (listeners.size === 0) watchStore();
          listeners.add(res);
          push(res, 'store', { comments: readStore(store) });
          /* A line of nothing every so often, so an idle stream is not
             taken for a dead one. */
          const beat = setInterval(() => {
            try {
              res.write(': still here\n\n');
            } catch {
              clearInterval(beat);
            }
          }, 25000);
          req.on('close', () => {
            clearInterval(beat);
            listeners.delete(res);
            if (listeners.size === 0) unwatchFile(store);
          });
          return;
        }

        if (path.startsWith('/__comments/shots/') && req.method === 'GET') {
          const name = path.slice('/__comments/shots/'.length);
          if (!/^[A-Za-z0-9_-]+\.jpg$/.test(name)) {
            return sendJson(res, 400, { error: 'bad file name' });
          }
          const file = join(dir, 'shots', name);
          if (!existsSync(file)) return sendJson(res, 404, { error: 'no such shot' });
          res.statusCode = 200;
          res.setHeader('Content-Type', 'image/jpeg');
          return res.end(readFileSync(file));
        }

        return sendJson(res, 404, { error: 'no such feedback route' });
      } catch (err) {
        return sendJson(res, 500, { error: String(err && err.message ? err.message : err) });
      }
  }

  return {
    middleware,
    announce,
    setRoot,
    /** The folder, as the host named it. */
    folder,
    /** The project root the paths below are resolved against. */
    get root() {
      return root;
    },
    /** The directory holding the comment file and the screen shots. */
    get dir() {
      return dir;
    },
    /** The comment file itself. */
    get store() {
      return store;
    },
  };
}
