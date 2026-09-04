import type { Plugin } from 'vite';

import type { CollectorOptions } from './collector.mjs';

export interface PageCommentsPluginOptions extends CollectorOptions {
  /**
   * Holds every code update back instead of pushing it at the page. The
   * browser keeps the code it loaded and hears a `changed` event on the
   * events channel. Default false, which is ordinary hot reloading.
   */
  holdReloads?: boolean;
}

export function pageCommentsPlugin(options?: PageCommentsPluginOptions): Plugin;
export default pageCommentsPlugin;
