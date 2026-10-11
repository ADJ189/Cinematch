// src/lib/toast.ts — one small, polite toast host for brief confirmations
// (watchlist add/remove, appearance saved/undo). A single live region, so
// screen readers hear one short message rather than a stack of them.

import { el } from './dom';

let host: HTMLElement | null = null;
let timer: number | null = null;

function ensureHost(): HTMLElement {
  if (host && document.body.contains(host)) return host;
  host = el('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  document.body.appendChild(host);
  return host;
}

export interface ToastOptions {
  /** Optional action button, e.g. Undo. */
  action?: { label: string; run: () => void };
  /** ms before auto-dismiss (default 3200; actions get a little longer). */
  duration?: number;
}

export function showToast(message: string, opts: ToastOptions = {}): void {
  const h = ensureHost();
  if (timer !== null) window.clearTimeout(timer);

  const children: (Node | string)[] = [el('span', { class: 'toast-msg' }, [message])];
  if (opts.action) {
    const { label, run } = opts.action;
    children.push(
      el(
        'button',
        {
          class: 'toast-action',
          type: 'button',
          onclick: () => {
            run();
            dismiss();
          },
        },
        [label]
      )
    );
  }
  const toast = el('div', { class: 'toast' }, children);
  h.replaceChildren(toast);
  timer = window.setTimeout(dismiss, opts.duration ?? (opts.action ? 5200 : 3200));

  function dismiss() {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    if (h.firstChild === toast) h.replaceChildren();
  }
}
