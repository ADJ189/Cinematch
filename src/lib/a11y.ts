// src/lib/a11y.ts — focus management for overlays.

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Makes `container` behave like a real modal dialog for keyboard users:
 * moves focus inside (to `initialFocus` or the first control), keeps Tab /
 * Shift+Tab cycling within it, calls `onEscape` on Escape, and — when the
 * returned release function runs — puts focus back on whatever opened it.
 */
export function trapFocus(container: HTMLElement, opts: { initialFocus?: HTMLElement; onEscape: () => void }): () => void {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const focusables = () =>
    Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null || n === document.activeElement);

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
    if (e.shiftKey && (active === first || !container.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !container.contains(active))) {
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
