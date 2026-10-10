// src/lib/a11y.ts — focus management for overlays.

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Makes `container` behave like a real modal dialog for keyboard users:
 * moves focus inside (to `initialFocus` or the first control), keeps Tab /
 * Shift+Tab cycling within it, calls `onEscape` on Escape, and — when the
 * returned release function runs — puts focus back on whatever opened it.
 *
 * `also` names extra regions that live outside `container` (e.g. a toast
 * with an Undo button) but must stay reachable. Their controls follow the
 * container's in the Tab order.
 */
export function trapFocus(
  container: HTMLElement,
  opts: { initialFocus?: HTMLElement; onEscape: () => void; also?: () => (HTMLElement | null)[] }
): () => void {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const regions = () => [container, ...(opts.also?.() ?? [])].filter((r): r is HTMLElement => !!r && document.contains(r));
  const isVisible = (n: HTMLElement) => n.offsetParent !== null || n === document.activeElement || getComputedStyle(n).position === 'fixed';
  const focusables = () => regions().flatMap((r) => Array.from(r.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isVisible));
  const inside = (n: Element | null) => !!n && regions().some((r) => r.contains(n));

  (opts.initialFocus ?? focusables()[0] ?? container).focus({ preventScroll: true });

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      opts.onEscape();
      return;
    }
    if (e.key !== 'Tab') return;
    const nodes = focusables();
    if (nodes.length === 0) {
      e.preventDefault();
      return;
    }
    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !inside(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !inside(active))) {
      e.preventDefault();
      first.focus();
    }
  }

  document.addEventListener('keydown', onKey);
  return () => {
    document.removeEventListener('keydown', onKey);
    if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
  };
}

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
