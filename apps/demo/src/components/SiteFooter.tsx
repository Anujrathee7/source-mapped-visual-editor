import { SAMPLE_DAY, SAMPLE_NOW_MIN, clock } from '../lib/tide';

export function SiteFooter() {
  return (
    <footer className="border-t border-rule">
      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 sm:grid-cols-[1.4fr_1fr] sm:px-8">
        <div>
          <p className="font-display text-lg font-semibold tracking-[-0.04em] text-brine">
            Sounding
          </p>
          <p className="mt-3 max-w-md leading-relaxed text-slate">
            Sounding is a fictional service, and this page is a demo of one. The coast, the
            harbour gauge and every tide time, water temperature and swell height on it were
            invented for the demo. None of it was measured, and none of it is a forecast.
          </p>
          <p className="mt-4 max-w-md leading-relaxed text-slate">
            Before a real swim: read the harbour tide table, check the local authority&rsquo;s
            water quality notices, tell someone where you are going, and look at the sea
            before you get into it.
          </p>
        </div>

        <div className="sm:justify-self-end sm:text-right">
          <p className="label text-slate">Sample day</p>
          <p className="readout mt-1 text-brine">{SAMPLE_DAY}</p>
          <p className="label mt-5 text-slate">Sample clock</p>
          <p className="readout mt-1 text-brine">{clock(SAMPLE_NOW_MIN)}</p>
          <p className="mt-6 text-sm text-slate">Fixed, so the page reads the same every run.</p>
        </div>
      </div>
    </footer>
  );
}
