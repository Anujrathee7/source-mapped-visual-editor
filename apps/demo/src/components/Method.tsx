/**
 * The definitions behind the two words on every card. A verdict nobody can interrogate
 * is not a verdict, so Safe and Marginal are spelled out in the same plain register as
 * the cards themselves.
 */
export function Method() {
  return (
    <section
      aria-labelledby="how-we-call-it"
      className="border-t border-rule bg-brine text-haar"
      id="how-we-call-it"
    >
      <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-20">
        <h2 className="max-w-2xl text-3xl tracking-[-0.03em] text-haar sm:text-4xl">
          How we call it
        </h2>
        <p className="mt-4 max-w-xl leading-relaxed text-haar-sink">
          Two words per beach, and both of them mean something specific. Nothing on this page
          replaces looking at the water when you get there.
        </p>

        <div className="mt-12 grid gap-10 sm:grid-cols-2 lg:grid-cols-3 lg:gap-12">
          <div>
            <h3 className="text-lg text-kelp-lift">Safe</h3>
            <p className="mt-3 leading-relaxed text-haar-sink">
              Swell under 0.6 m, wind under 15 knots, and a clear exit for the whole window.
              You can get out where you got in, at any point in it, without hurrying.
            </p>
          </div>

          <div>
            <h3 className="text-lg text-ochre-lift">Marginal</h3>
            <p className="mt-3 leading-relaxed text-haar-sink">
              The beach only works at slack water, or the wind is blowing against the tide.
              Swim it with someone on the shore, keep it short, and pick your exit before you
              get in rather than after.
            </p>
          </div>

          <div>
            <h3 className="text-lg text-haar">What we leave out</h3>
            <p className="mt-3 leading-relaxed text-haar-sink">
              No water quality readings, because the sampling is weekly and the sea is not.
              No wetsuit advice, because you know your own tolerance better than we do. And
              nothing past the end of today, because past that the swell models disagree more
              than they agree.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
