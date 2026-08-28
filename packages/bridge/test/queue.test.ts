import { describe, expect, it } from 'vitest';
import { SerialQueue } from '../src/queue.js';

const tick = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// AC-3.1
describe('SerialQueue', () => {
  it('runs concurrently submitted jobs one at a time, in submission order', async () => {
    const log: string[] = [];
    const queue = new SerialQueue();
    const job = (name: string, ms: number) => async () => {
      log.push(`start ${name}`);
      await tick(ms);
      log.push(`end ${name}`);
    };

    // A is slowest on purpose: an unserialised queue would finish B and C inside A.
    await Promise.all([
      queue.enqueue(job('A', 20)),
      queue.enqueue(job('B', 5)),
      queue.enqueue(job('C', 0)),
    ]);

    expect(log).toEqual([
      'start A',
      'end A',
      'start B',
      'end B',
      'start C',
      'end C',
    ]);
  });

  it('never has two tasks in flight at once', async () => {
    const queue = new SerialQueue();
    let inFlight = 0;
    let maxInFlight = 0;

    await Promise.all(
      Array.from({ length: 12 }, () =>
        queue.enqueue(async () => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await tick(1);
          inFlight -= 1;
        }),
      ),
    );

    expect(maxInFlight).toBe(1);
  });

  it('is not wedged by a job that throws', async () => {
    const log: string[] = [];
    const queue = new SerialQueue();

    const failing = queue.enqueue(async () => {
      log.push('start A');
      throw new Error('agent exploded');
    });
    const following = queue.enqueue(async () => {
      log.push('start B');
      return 'B ran';
    });

    await expect(failing).rejects.toThrow('agent exploded');
    await expect(following).resolves.toBe('B ran');
    expect(log).toEqual(['start A', 'start B']);
  });

  it('surfaces a synchronous throw as a rejection, not a crash', async () => {
    const queue = new SerialQueue();
    const failing = queue.enqueue(() => {
      throw new Error('threw before awaiting');
    });
    await expect(failing).rejects.toThrow('threw before awaiting');
    await expect(queue.enqueue(async () => 'still alive')).resolves.toBe('still alive');
  });

  it('reports pending size and settles onIdle', async () => {
    const queue = new SerialQueue();
    const pending = [
      queue.enqueue(() => tick(5)),
      queue.enqueue(() => tick(5)),
      queue.enqueue(() => tick(5)),
    ];
    expect(queue.size).toBe(3);

    await queue.onIdle();
    expect(queue.size).toBe(0);
    await Promise.all(pending);
  });
});
