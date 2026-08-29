/**
 * Loading the app the way a browser would, without one.
 *
 * AC-11.4's last clause — zero elements stamped is an *error* — needs somebody to have
 * actually asked for the project's modules, because a dev server that has served nothing
 * has stamped nothing and that is not a fault. Rather than wait for a browser (which
 * would make the studio in M14 a prerequisite for testing the host, contra AC-11.8), the
 * host fetches the page and follows its imports over its own HTTP server.
 *
 * The crawl deliberately stops at the project's edge. `/@id/`, `/@fs/` and anything under
 * `node_modules` are the editor's own modules and its dependencies: they are not what is
 * being measured, and following them would turn a probe into a full page load.
 */
const SCRIPT_SRC = /<script[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
const IMPORT_SPECIFIER = /(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g;

export interface ProbeResult {
  /** How many of the project's own modules were fetched. */
  modulesFetched: number;
  /** True once the page itself was served; false means the crawl never started. */
  pageServed: boolean;
}

function isProjectModule(url: string): boolean {
  if (!url.startsWith('/')) return false;
  if (url.startsWith('/@')) return false;
  if (url.includes('node_modules')) return false;
  return true;
}

/** Strips vite's cache-busting query so one module is not crawled under two names. */
function canonical(url: string): string {
  const query = url.indexOf('?');
  return query === -1 ? url : url.slice(0, query);
}

export async function probeProject(
  baseUrl: string,
  options: { limit?: number; signal?: AbortSignal } = {},
): Promise<ProbeResult> {
  const limit = options.limit ?? 200;
  const seen = new Set<string>();
  const queue: string[] = [];

  const fetchText = async (url: string): Promise<string | null> => {
    try {
      const response = await fetch(new URL(url, baseUrl), {
        // Not pooled. This probe runs once per session against a port that is about to be
        // given back, and a keep-alive socket held open against a closed server is exactly
        // the kind of handle AC-11.6 counts.
        headers: { connection: 'close' },
        ...(options.signal ? { signal: options.signal } : {}),
      });
      return response.ok ? await response.text() : null;
    } catch {
      return null;
    }
  };

  const html = await fetchText('/');
  if (html === null) return { modulesFetched: 0, pageServed: false };

  for (const match of html.matchAll(SCRIPT_SRC)) {
    const src = match[1];
    if (src !== undefined && isProjectModule(src)) queue.push(canonical(src));
  }

  while (queue.length > 0 && seen.size < limit) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);

    const body = await fetchText(url);
    if (body === null) continue;

    for (const match of body.matchAll(IMPORT_SPECIFIER)) {
      const next = match[1];
      if (next === undefined) continue;
      const target = canonical(next);
      if (isProjectModule(target) && !seen.has(target)) queue.push(target);
    }
  }

  return { modulesFetched: seen.size, pageServed: true };
}
