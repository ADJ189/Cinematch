// src/lib/dom.ts — minimal element builder, replaces the need for a template compiler.

type Attrs = Record<string, string | number | boolean | undefined | null | ((e: Event) => void)>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string)[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'class') {
      node.className = String(value);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}

export function mount(root: HTMLElement, node: Node): void {
  clear(root);
  root.appendChild(node);
}

export interface PosterImageOptions {
  src: string | null;
  alt: string;
  /** Single character (or short string) shown if there's no image at all,
   * or the real image fails to load. */
  fallbackText: string;
  /** Skip native lazy-loading and request high fetch priority — use for
   * anything visible without scrolling (e.g. a just-opened modal hero). */
  eager?: boolean;
}

/**
 * Poster with a visible skeleton shimmer until the image actually
 * finishes decoding, instead of a blank box that makes the grid look
 * broken while images are still in flight. Off-screen posters use native
 * lazy-loading so the browser doesn't fight the first-paint-critical
 * requests (fonts, the initial results batch) for bandwidth — the single
 * biggest lever for perceived load time on a slow mobile connection.
 */
export function buildPosterImage(opts: PosterImageOptions): HTMLElement {
  const wrap = el('div', { class: 'poster-frame' });

  if (!opts.src) {
    wrap.appendChild(el('span', { class: 'poster-fallback' }, [opts.fallbackText]));
    return wrap;
  }

  wrap.classList.add('skeleton');

  const img = el('img', {
    class: 'poster-img',
    alt: opts.alt,
    loading: opts.eager ? undefined : 'lazy',
    decoding: 'async',
    fetchpriority: opts.eager ? 'high' : 'low',
    src: opts.src,
  });

  const onLoaded = () => {
    wrap.classList.remove('skeleton');
    img.classList.add('loaded');
  };
  const onFailed = () => {
    wrap.classList.remove('skeleton');
    img.remove();
    wrap.appendChild(el('span', { class: 'poster-fallback' }, [opts.fallbackText]));
  };

  img.addEventListener('load', onLoaded, { once: true });
  img.addEventListener('error', onFailed, { once: true });
  // A cached image can be `complete` before listeners are even attached —
  // without this check it would sit behind its own skeleton forever.
  if (img.complete) img.naturalWidth > 0 ? onLoaded() : onFailed();

  wrap.appendChild(img);
  return wrap;
}
