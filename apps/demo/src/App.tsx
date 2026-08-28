import { useState } from 'react';
import { BeachCard } from './components/BeachCard';
import { Hero } from './components/Hero';
import { Method } from './components/Method';
import { SiteFooter } from './components/SiteFooter';
import { SiteHeader } from './components/SiteHeader';
import { TideRibbon } from './components/TideRibbon';
import { BEACHES } from './data/beaches';
import { SAMPLE_NOW_MIN, nextSafeWindow } from './lib/tide';

export default function App() {
  const [selectedId, setSelectedId] = useState<string>(BEACHES[0].id);
  const selected = BEACHES.find((beach) => beach.id === selectedId) ?? BEACHES[0];

  // Derived at render from the beach list, not written into the markup: edit the array
  // and the hero changes with it.
  const nextWindow = nextSafeWindow(BEACHES, SAMPLE_NOW_MIN);

  return (
    <>
      <a className="skip-link" href="#this-morning">
        Skip to this morning&rsquo;s calls
      </a>

      <SiteHeader />

      <main id="top">
        <Hero nextWindow={nextWindow} />

        <TideRibbon beaches={BEACHES} onSelect={setSelectedId} selected={selected} />

        <section
          aria-labelledby="this-morning-heading"
          className="mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-20"
          id="this-morning"
        >
          <h2
            className="max-w-2xl text-3xl tracking-[-0.03em] text-brine sm:text-4xl"
            id="this-morning-heading"
          >
            This morning, beach by beach
          </h2>
          <p className="mt-4 max-w-xl leading-relaxed text-slate">
            Six beaches on the Skarra coast, called for the water between now and midday.
            Distances are from the harbour car park. The times are the stretch each one is
            worth getting into, not the stretch it is legal to.
          </p>

          <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {BEACHES.map((beach) => (
              <BeachCard beach={beach} key={beach.id} />
            ))}
          </div>
        </section>

        <Method />
      </main>

      <SiteFooter />
    </>
  );
}
