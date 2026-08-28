import type { ProgressEvent } from '@sve/protocol';

export type ProgressListener = (event: ProgressEvent) => void;

/**
 * Fan-out for {@link ProgressEvent}s, with no buffering and no back-pressure.
 *
 * Subscribers come and go with browser tabs, so `subscribe` hands back its own
 * unsubscribe rather than asking callers to keep the function identity around —
 * an SSE handler that has to remember what it registered is an SSE handler that
 * eventually leaks one. A throwing listener is isolated: one wedged client must
 * not stop a job or starve the other subscribers.
 */
export class ProgressHub {
  #listeners = new Set<ProgressListener>();

  get listenerCount(): number {
    return this.#listeners.size;
  }

  subscribe(listener: ProgressListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  emit(event: ProgressEvent): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(event);
      } catch {
        /* a broken subscriber is the subscriber's problem, not the job's */
      }
    }
  }

  close(): void {
    this.#listeners.clear();
  }
}
