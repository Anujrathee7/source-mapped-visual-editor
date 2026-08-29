import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
    // Threads, not the default `forks`.
    //
    // Under load — several agents or dev servers on one machine — the forks pool fails to
    // spawn workers, and the way it fails is the dangerous part: the files that never
    // started are simply absent from the summary, which then reads
    // `Test Files 30 passed (30)` in green while 8 files and 146 tests did not run. The
    // only signals are a non-zero exit code and an Unhandled Errors block printed above
    // the summary, both easy to miss.
    //
    // A suite that under-reports its own size while claiming success is the exact failure
    // this project exists to catch, so it does not get to live in the test runner.
    pool: 'threads',
  },
});
