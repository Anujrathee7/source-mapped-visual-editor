import { BEACHES } from '../data/beaches';
import { SAMPLE_NOW_MIN, STATION, clock, meanWaterC } from '../lib/tide';

interface HeroProps {
  /** Built from the beach list at render time — see `nextSafeWindow`. */
  readonly nextWindow: string;
}

export function Hero({ nextWindow }: HeroProps) {
  const water = meanWaterC(BEACHES);

  return (
    <section aria-labelledby="verdict" className="mx-auto max-w-6xl px-5 pt-10 pb-8 sm:px-8 sm:pt-14">
      <div className="grid gap-10 lg:grid-cols-[1.5fr_1fr] lg:gap-14">
        <div>
          <p className="label text-slate">Sample briefing · {clock(SAMPLE_NOW_MIN)}</p>
          <h1
            className="mt-4 text-[2.5rem] leading-[0.95] font-semibold tracking-[-0.04em] text-brine sm:text-6xl lg:text-[4.25rem]"
            id="verdict"
          >
            Four of six beaches are swimmable this morning.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate">
            The tide is making toward a 5.3 m high at 10:12. The sheltered bays are calm and
            warm enough to be pleasant. The two exposed spots only work at slack water, and
            not for long.
          </p>

          <p className="mt-8 border-l-[3px] border-flare bg-haar-lift py-3 pr-4 pl-4 text-base">
            <span className="label block text-slate">Next safe window</span>
            <strong
              className="readout mt-1 block text-xl leading-snug font-semibold text-brine sm:text-2xl"
              id="next-window"
            >
              {nextWindow}
            </strong>
          </p>
        </div>

        <div className="self-end">
          <p className="label text-slate">At the harbour gauge</p>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-rule pt-4">
            <Readout label="Water" note="mean of six" unit="°C" value={water.toFixed(1)} />
            <Readout label="Air" note="feels colder in wind" unit="°C" value={String(STATION.airC)} />
            <Readout label="Swell" note="offshore buoy" unit="m" value={STATION.swellM.toFixed(1)} />
            <Readout label="Wind" note="steady, no gusts" unit="" value={STATION.wind} />
          </dl>
        </div>
      </div>
    </section>
  );
}

interface ReadoutProps {
  readonly label: string;
  readonly value: string;
  readonly unit: string;
  readonly note: string;
}

function Readout({ label, value, unit, note }: ReadoutProps) {
  return (
    <div>
      <dt className="label text-slate">{label}</dt>
      <dd className="readout mt-1 text-3xl leading-none tracking-[-0.03em] text-brine">
        {value}
        <span className="text-lg text-slate">{unit}</span>
      </dd>
      <p className="mt-1.5 text-xs text-slate">{note}</p>
    </div>
  );
}
