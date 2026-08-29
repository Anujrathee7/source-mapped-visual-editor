import { useEffect, useState } from 'react';

/**
 * Re-render when a controller says something changed.
 *
 * A version counter rather than `useSyncExternalStore`: the controllers hand back fresh
 * arrays (`log.rows()`, `chat.turns()`) by design, so a snapshot-comparing hook would see
 * a new value every render and loop. What is actually being subscribed to here is "there
 * is news", and the components read what they need when they render.
 */
export function useChanges(subscribe: (listener: () => void) => () => void): number {
  const [version, setVersion] = useState(0);
  useEffect(() => subscribe(() => setVersion((current) => current + 1)), [subscribe]);
  return version;
}
