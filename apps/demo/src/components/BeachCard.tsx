import type { Beach } from '../data/beaches';
import { cn } from '../lib/cn';
import { SAMPLE_NOW_MIN, clock, gap, windowState } from '../lib/tide';

interface BeachCardProps {
  readonly beach: Beach;
}

/**
 * One beach, one verdict. Six of these come off a single `.map()` in `App`, which is
 * exactly the shape a swimmer wants — the same questions asked of every beach, in the
 * same order, so the eye can run down the column and stop at the first Safe.
 */
export function BeachCard({ beach }: BeachCardProps) {
  const safe = beach.safe;
  const state = windowState(beach.window, SAMPLE_NOW_MIN);
  const timing =
    state.phase === 'open'
      ? `open now, ${gap(state.closesIn)} left`
      : state.phase === 'soon'
        ? `opens in ${gap(state.opensIn)}`
        : 'gone for today';

  return (
    <article
      aria-labelledby={`${beach.id}-name`}
      className="relative flex flex-col gap-4 overflow-hidden rounded-sm bg-haar-lift p-5 pl-6 shadow-[0_1px_2px_rgba(11,37,43,0.08)]"
    >
      <span
        aria-hidden="true"
        className={cn('absolute inset-y-0 left-0 w-[3px]', safe ? 'bg-kelp' : 'bg-ochre')}
      />

      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xl text-brine" id={`${beach.id}-name`}>
            {beach.name}
          </h3>
          <p className="mt-1 text-sm text-slate">
            {beach.setting} &middot; {beach.fromHarbourKm.toFixed(1)} km out
          </p>
        </div>
        <span
          className={cn(
            'badge',
            safe
              ? 'border-kelp/25 bg-kelp-wash text-kelp'
              : 'border-ochre/30 bg-ochre-wash text-ochre',
          )}
        >
          {safe ? 'Safe' : 'Marginal'}
        </span>
      </div>

      <dl className="grid grid-cols-3 gap-3 border-y border-rule/70 py-3">
        <Measure label="Water" unit="°C" value={beach.waterC.toFixed(1)} />
        <Measure label="Swell" unit="m" value={beach.swellM.toFixed(1)} />
        <Measure label="Wind" unit="" value={beach.wind} />
      </dl>

      <p className="readout text-sm text-brine">
        <span className={cn('me-2 inline-block', safe ? 'text-kelp' : 'text-ochre')}>
          {clock(beach.window.openMin)}&ndash;{clock(beach.window.closeMin)}
        </span>
        <span className="text-slate">{timing}</span>
      </p>

      <p className="text-[0.9375rem] leading-relaxed text-brine">{beach.call}</p>

      <details className="disclosure mt-auto border-t border-rule/70 pt-3">
        <summary className="label text-slate transition-colors hover:text-brine">
          Getting in, and back out
        </summary>
        <p className="mt-2 text-sm leading-relaxed text-slate">{beach.access}</p>
      </details>
    </article>
  );
}

interface MeasureProps {
  readonly label: string;
  readonly value: string;
  readonly unit: string;
}

function Measure({ label, value, unit }: MeasureProps) {
  return (
    <div>
      <dt className="label text-slate">{label}</dt>
      <dd className="readout mt-0.5 text-lg leading-none tracking-[-0.02em] text-brine">
        {value}
        <span className="text-sm text-slate">{unit}</span>
      </dd>
    </div>
  );
}
