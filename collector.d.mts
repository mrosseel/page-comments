import type { IncomingMessage, ServerResponse } from 'node:http';

export interface CollectorOptions {
  /** Folder for the comment file and the screen shots. Default "comments". */
  dir?: string;
  /** One line per change. Default `console.log`. */
  log?: (line: string) => void;
}

/** A Connect-style middleware: Express, Vite, webpack and Node all take it. */
export type CollectorMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
) => Promise<void>;

export interface Collector {
  /** Mount this. Anything outside /__feedback and /__comments falls through. */
  middleware: CollectorMiddleware;
  /** Sends one event to everybody on the events channel. */
  announce: (event: string, data: unknown) => void;
  /** Points the collector at another project root. */
  setRoot: (root: string) => void;
  /** The folder, as the host named it. */
  folder: string;
  /** The project root the paths below are resolved against. */
  readonly root: string;
  /** The directory holding the comment file and the screen shots. */
  readonly dir: string;
  /** The comment file itself. */
  readonly store: string;
}

export function createCollector(options?: CollectorOptions): Collector;
