import { cn } from './cn';

export function Sample({ tagline, safe }: { tagline: string; safe: boolean }) {
  return (
    <section className="wrap">
      <h1 className="title">Swim today</h1>
      <p>{tagline}</p>
      <span className={cn('badge', safe && 'ok')}>Safe</span>
      <Feature name="Bondi" />
      <img src="/a.png" alt="" />
    </section>
  );
}
