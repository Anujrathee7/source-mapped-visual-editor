type Task = () => void | Promise<void>;

/**
 * A queue that runs exactly one task at a time, in submission order.
 *
 * This is not a throughput choice. `data-sve-loc` line numbers are invalidated
 * by every write, so a second job reading a file while the first is mid-write
 * would target a stale line. Serialising is what lets each job re-read its
 * target at the moment it runs (AC-3.1).
 *
 * A task that throws rejects only its own promise; the queue keeps draining.
 */
export class SerialQueue {
  #pending: Task[] = [];
  #running = false;
  #size = 0;
  #idleWaiters: (() => void)[] = [];

  /** Tasks submitted but not yet settled, including the one in flight. */
  get size(): number {
    return this.#size;
  }

  get running(): boolean {
    return this.#running;
  }

  enqueue<T>(task: () => T | Promise<T>): Promise<T> {
    this.#size += 1;
    return new Promise<T>((resolve, reject) => {
      this.#pending.push(async () => {
        try {
          // Wrapped in the async task so a *synchronous* throw from `task`
          // rejects this promise rather than escaping into the drain loop.
          resolve(await task());
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        } finally {
          this.#size -= 1;
        }
      });
      void this.#drain();
    });
  }

  /** Resolves when nothing is queued or in flight. Resolves immediately if already idle. */
  onIdle(): Promise<void> {
    if (this.#size === 0) return Promise.resolve();
    return new Promise((resolve) => this.#idleWaiters.push(resolve));
  }

  async #drain(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    try {
      for (let next = this.#pending.shift(); next; next = this.#pending.shift()) {
        await next();
      }
    } finally {
      this.#running = false;
      if (this.#size === 0) {
        for (const waiter of this.#idleWaiters.splice(0)) waiter();
      }
    }
  }
}
