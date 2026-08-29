/**
 * `@sve/vite` — the editor as a single Vite plugin.
 *
 * This entry is the *Node* half and only the Node half: it reaches `@sve/bridge`, which
 * holds file-write capability. The browser half is reached through the `./client` export,
 * and is never re-exported from here — importing this module from page code would pull
 * the filesystem into the browser bundle.
 */
export { sve, type ClientConfig, type SveOptions } from './plugin.js';
export { CLIENT_ENTRY_PATH, CLIENT_PACKAGES, clientPackageDirs } from './locate.js';
export {
  CLIENT_ENTRY_SPECIFIER,
  DEFAULT_SETTLE_MS,
  DEFAULT_VERIFY_TIMEOUT_MS,
  RESOLVED_ENTRY_ID,
  VIRTUAL_ENTRY_ID,
} from './constants.js';
