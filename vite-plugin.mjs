/**
 * The in-page comment collector, mounted on a Vite development server.
 *
 * The collector itself is `./collector.mjs` and knows nothing about Vite.
 * This file adds the two things only Vite can give it: the middleware on the
 * development server, and a hand on the hot update channel.
 *
 * With `holdReloads` the development server stops pushing code at the page.
 * A reviewer who is writing comments must not have the screen pulled out
 * from under them because somebody saved a file. Every module update is
 * dropped and announced instead, as a `changed` event on the events channel,
 * so the page can offer a reload rather than take one.
 *
 * For any other server, mount the middleware yourself:
 *
 *   import { createCollector } from '@mrosseel/page-comments/collector';
 *   app.use(createCollector().middleware);
 */

import { relative, resolve, sep } from 'node:path';

import { createCollector } from './collector.mjs';

export function pageCommentsPlugin(options = {}) {
  let logger = null;
  const collector = createCollector({
    ...options,
    /* Vite's own logger, once the server has one, so a comment lands in the
       same stream as everything else the development server says. */
    log: (line) => (logger ? logger.info(line, { timestamp: true }) : console.log(line)),
  });
  const folder = collector.folder;
  const holdReloads = options.holdReloads ?? false;
  let root = process.cwd();

  return {
    name: 'page-comments',
    apply: 'serve',
    /* The comment file is written by this plugin, many times a session. It is
       not source, and a watcher that sees it must not make the page think the
       application changed. */
    config(user) {
      const here = resolve(user.root ?? process.cwd(), folder);
      return { server: { watch: { ignored: [`${here}/**`] } } };
    },
    configResolved(config) {
      root = config.root;
      logger = config.logger;
      collector.setRoot(config.root);
    },
    /*
    What the page is told about a change, and what it is spared.

    The store is never a code change, whatever the setting. Beyond that,
    `holdReloads` drops every update: the browser keeps the code it has and
    hears one `changed` event, which is enough for a page to offer a reload
    at a moment the person chooses.
    */
    handleHotUpdate(ctx) {
      if (ctx.file === collector.store || ctx.file.startsWith(collector.dir + sep)) return [];
      if (!holdReloads) return undefined;
      collector.announce('changed', { files: [relative(root, ctx.file)] });
      return [];
    },
    configureServer(server) {
      server.middlewares.use(collector.middleware);
    },
  };
}

export default pageCommentsPlugin;
