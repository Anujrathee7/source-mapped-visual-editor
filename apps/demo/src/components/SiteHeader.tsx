import { SAMPLE_DAY, SAMPLE_NOW_MIN, clock } from '../lib/tide';

/**
 * The notice strip above the masthead is the first thing on the page for a reason: a
 * page that looks like a forecast has to say, before anything else, that it isn't one.
 */
export function SiteHeader() {
  return (
    <header className="border-b border-rule">
      <div className="bg-brine text-haar">
        <div className="mx-auto flex max-w-6xl flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-2 sm:px-8">
          <span className="label text-flare">Sample data</span>
          <p className="text-[0.8125rem] leading-snug text-haar-sink">
            A demo page for a service that does not exist. Every tide, temperature and swell
            height below was made up for it.
          </p>
        </div>
      </div>

      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4 sm:px-8">
        <a className="flex items-center gap-2.5 no-underline" href="#top">
          <svg
            aria-hidden="true"
            className="h-6 w-6 shrink-0"
            fill="none"
            viewBox="0 0 32 32"
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect fill="#0b252b" height="32" rx="7" width="32" />
            <path
              d="M4 21c4-7 8-7 12 0s8 7 12 0"
              stroke="#7ec8d8"
              strokeLinecap="round"
              strokeWidth="3"
            />
            <circle cx="16" cy="9" fill="#ff5a1f" r="2.6" />
          </svg>
          <span className="font-display text-xl font-semibold tracking-[-0.04em] text-brine">
            Sounding
          </span>
        </a>

        <p className="label text-slate">Tide and swell for open-water swimmers</p>

        <nav aria-label="Page sections" className="ms-auto flex items-center gap-5">
          <a
            className="font-display text-sm text-slate underline decoration-rule underline-offset-4 transition-colors hover:text-brine hover:decoration-brine"
            href="#this-morning"
          >
            This morning
          </a>
          <a
            className="font-display text-sm text-slate underline decoration-rule underline-offset-4 transition-colors hover:text-brine hover:decoration-brine"
            href="#how-we-call-it"
          >
            How we call it
          </a>
        </nav>
      </div>

      <p className="mx-auto max-w-6xl px-5 pb-3 font-display text-xs text-slate sm:px-8">
        Skarra coast · {SAMPLE_DAY} · sample clock {clock(SAMPLE_NOW_MIN)}
      </p>
    </header>
  );
}
