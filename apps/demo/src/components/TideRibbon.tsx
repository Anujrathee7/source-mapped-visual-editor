import type { Beach } from '../data/beaches';
import { cn } from '../lib/cn';
import {
  SAMPLE_NOW_MIN,
  STATION,
  clock,
  gap,
  heightAt,
  ribbonPct,
  ribbonY,
  tideArea,
  tidePath,
  visibleEvents,
  windowState,
} from '../lib/tide';

const AXIS_HOURS = [4, 8, 12, 16, 20];

interface TideRibbonProps {
  readonly beaches: readonly Beach[];
  readonly selected: Beach;
  readonly onSelect: (id: string) => void;
}

/**
 * The signature object on the page, and the only one that inverts to brine.
 *
 * A swim window is a fact about the tide, not a fact about a beach, so the page says it
 * that way: one curve for the day, and the stretch of it you can swim shaded on top. The
 * chart is drawn in a 1000 × 100 space stretched to fit, with non-scaling strokes; every
 * label is real HTML positioned by percentage, so it stays legible at 375 px where
 * scaled SVG text would not.
 */
export function TideRibbon({ beaches, selected, onSelect }: TideRibbonProps) {
  const { openMin, closeMin } = selected.window;
  const state = windowState(selected.window, SAMPLE_NOW_MIN);
  const bandLeft = ribbonPct(openMin);
  const bandWidth = ribbonPct(closeMin) - bandLeft;
  const nowPct = ribbonPct(SAMPLE_NOW_MIN);

  const phrase =
    state.phase === 'open'
      ? `open now, closes in ${gap(state.closesIn)}`
      : state.phase === 'soon'
        ? `opens in ${gap(state.opensIn)}`
        : 'closed for today';

  return (
    <section aria-labelledby="tide-heading" className="border-y border-rule bg-haar-sink/50">
      <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
          <div>
            <h2 className="text-2xl tracking-[-0.03em] text-brine sm:text-3xl" id="tide-heading">
              The tide, and where your window sits in it
            </h2>
            <p className="mt-2 max-w-xl text-slate">
              Sample predictions for the harbour gauge. Pick a beach to see the stretch of
              today&rsquo;s tide it is swimmable on, and how much of that stretch is left.
            </p>
          </div>
          <p className="label text-slate">04:00 &rarr; 22:00</p>
        </div>

        <div aria-label="Choose a beach" className="mt-7 flex flex-wrap gap-2" role="group">
          {beaches.map((beach) => (
            <button
              aria-pressed={beach.id === selected.id}
              className={cn(
                'font-display rounded-full border px-3.5 py-1.5 text-sm transition-colors',
                beach.id === selected.id
                  ? 'border-brine bg-brine text-haar-lift'
                  : 'border-rule bg-haar-lift text-slate hover:border-brine hover:text-brine',
              )}
              key={beach.id}
              onClick={() => onSelect(beach.id)}
              type="button"
            >
              {beach.name}
            </button>
          ))}
        </div>

        <figure className="mt-5">
          <div className="overflow-hidden rounded-sm bg-brine">
            <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1 border-b border-brine-3 px-4 py-3 sm:px-6">
              <p className="label text-glacier">{STATION.name} &middot; sample predictions</p>
              <p
                className={cn(
                  'readout text-sm',
                  selected.safe ? 'text-kelp-lift' : 'text-ochre-lift',
                )}
              >
                {selected.name} {clock(openMin)}&ndash;{clock(closeMin)} &middot; {phrase}
              </p>
            </div>

            <div className="relative h-44 sm:h-56">
              <svg
                aria-hidden="true"
                className="absolute inset-0 h-full w-full"
                preserveAspectRatio="none"
                viewBox="0 0 1000 100"
              >
                <rect
                  className={selected.safe ? 'fill-kelp-lift/15' : 'fill-ochre-lift/15'}
                  height="100"
                  width={(bandWidth / 100) * 1000}
                  x={(bandLeft / 100) * 1000}
                  y="0"
                />
                <path className="fill-glacier/12" d={tideArea()} />
                <path
                  className="stroke-glacier"
                  d={tidePath()}
                  fill="none"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                />
                {[openMin, closeMin].map((minute) => (
                  <line
                    className={selected.safe ? 'stroke-kelp-lift/60' : 'stroke-ochre-lift/60'}
                    key={minute}
                    strokeDasharray="3 4"
                    strokeWidth="1"
                    vectorEffect="non-scaling-stroke"
                    x1={(ribbonPct(minute) / 100) * 1000}
                    x2={(ribbonPct(minute) / 100) * 1000}
                    y1="0"
                    y2="100"
                  />
                ))}
                <line
                  className="stroke-flare"
                  strokeWidth="1.5"
                  vectorEffect="non-scaling-stroke"
                  x1={(nowPct / 100) * 1000}
                  x2={(nowPct / 100) * 1000}
                  y1="0"
                  y2="100"
                />
              </svg>

              {visibleEvents().map((event) => (
                <div
                  className={cn(
                    'absolute z-10 flex -translate-x-1/2 items-center gap-1.5',
                    event.kind === 'high' ? 'flex-col' : '-translate-y-full flex-col-reverse',
                  )}
                  key={event.minutes}
                  style={{ left: `${ribbonPct(event.minutes)}%`, top: `${ribbonY(event.metres)}%` }}
                >
                  <span className="block h-1.5 w-1.5 rounded-full bg-glacier" />
                  <span className="readout text-[0.6875rem] whitespace-nowrap text-glacier">
                    <span className="label me-1">{event.kind === 'high' ? 'HW' : 'LW'}</span>
                    {clock(event.minutes)} &middot; {event.metres.toFixed(1)} m
                  </span>
                </div>
              ))}

              <span
                aria-hidden="true"
                className="now-pulse absolute z-10 block h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-flare"
                style={{
                  left: `${nowPct}%`,
                  top: `${ribbonY(heightAt(SAMPLE_NOW_MIN))}%`,
                }}
              />

              <p
                className="label absolute top-2.5 z-10 ps-2 whitespace-nowrap text-flare"
                style={{ left: `${nowPct}%` }}
              >
                Now {clock(SAMPLE_NOW_MIN)}
              </p>

              <p
                className={cn(
                  'label absolute bottom-2.5 z-10 -translate-x-1/2 whitespace-nowrap',
                  selected.safe ? 'text-kelp-lift' : 'text-ochre-lift',
                )}
                style={{ left: `${bandLeft + bandWidth / 2}%` }}
              >
                {clock(openMin)}&ndash;{clock(closeMin)}
              </p>
            </div>

            <div className="relative h-8 border-t border-brine-3">
              {AXIS_HOURS.map((hour, index) => (
                <span
                  className={cn(
                    'label absolute top-2.5 text-glacier/60',
                    index === 0 ? 'ps-4 sm:ps-6' : '-translate-x-1/2',
                    // Every four hours is one label too many at 375 px, where 04:00 and
                    // 08:00 run into each other. Drop to every eight below `sm`.
                    hour % 8 === 0 ? 'hidden sm:block' : '',
                  )}
                  key={hour}
                  style={{ left: `${ribbonPct(hour * 60)}%` }}
                >
                  {String(hour).padStart(2, '0')}:00
                </span>
              ))}
            </div>
          </div>

          <figcaption className="mt-3 max-w-2xl text-sm text-slate">
            Height is interpolated between the sample high and low waters, the same curve a
            harbour table draws. The shaded stretch is the window for {selected.name}; the
            orange line is the sample clock.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
