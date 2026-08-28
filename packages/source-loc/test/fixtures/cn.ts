// The fixture's `className={cn(...)}` needs a real module behind `./cn`, because the
// root tsconfig includes `packages/*/test` and so typechecks the fixture like any other
// source file. Nothing here is ever executed — the fixture is only ever parsed.
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
