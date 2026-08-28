/**
 * Shared helpers for the jsdom-environment suites.
 *
 * `tick` is the only subtle one: a MutationObserver delivers its records as a microtask,
 * so an assertion made in the same task as the mutation always sees the observer as not
 * having run. Awaiting a macrotask boundary is what makes "did it settle?" answerable.
 */
export const tick = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

export function resetDocument(): void {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
}

export function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body.firstElementChild as HTMLElement;
}

export function addPageStyle(css: string): HTMLStyleElement {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  return style;
}

/**
 * What React does when it re-renders a text child: it writes through the existing text
 * node rather than replacing the element. Doing it this way, rather than assigning
 * `textContent`, is what makes the re-assertion tests exercise a `characterData` record
 * and not only a `childList` one.
 */
export function rerenderText(el: Element, text: string): void {
  const first = el.firstChild;
  if (first && first.nodeType === Node.TEXT_NODE) first.nodeValue = text;
  else el.textContent = text;
}
