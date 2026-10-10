// src/lib/settings-panel.ts
//
// The Appearance drawer: live-previewed, auto-saved, fully reversible. It
// is built once; controls are *synced* (attributes toggled) on every
// preference change rather than re-rendered, so keyboard focus never jumps
// while a palette or font is being tried. It never remounts the screen
// underneath and never touches ratings, watchlist, profile or quiz state.

import { trapFocus } from './a11y';
import {
  accentForeground,
  canRedo,
  canUndo,
  DEFAULT_PREFERENCES,
  effectiveMode,
  getPreferences,
  isAppearancePersisted,
  isValidHex,
  PALETTES,
  randomizePalette,
  redo,
  resetAllAppearance,
  resetSection,
  subscribeAppearance,
  undo,
  updatePreferences,
  applyVibe,
  VIBES,
  type AppearancePreferences,
  type ResetSection,
} from './appearance';
import { el } from './dom';
import { ensureFontLoaded, FONT_PRESETS } from './fonts';
import { ICON } from './icons';
import { showToast } from './toast';

type Tab = 'themes' | 'typography' | 'layout' | 'motion' | 'accessibility';

const TABS: { id: Tab; label: string }[] = [
  { id: 'themes', label: 'Themes' },
  { id: 'typography', label: 'Typography' },
  { id: 'layout', label: 'Layout' },
  { id: 'motion', label: 'Motion' },
  { id: 'accessibility', label: 'Accessibility' },
];

const ACCENT_CHOICES = ['#a78bfa', '#38bdf8', '#34d399', '#fbbf24', '#fb7185', '#f472b6', '#e08a5c'];

let openPanel: { close: () => void } | null = null;

export function isAppearanceOpen(): boolean {
  return openPanel !== null;
}

export function closeAppearancePanel(): void {
  openPanel?.close();
}

export function openAppearancePanel(initialTab: Tab = 'themes'): void {
  if (openPanel) return;

  const syncers: (() => void)[] = [];
  const onChange = (fn: () => void) => syncers.push(fn);

  // ── generic controls ────────────────────────────────────────────────

  /** A labelled radio-style group of text buttons. */
  function choice<K extends keyof AppearancePreferences>(
    label: string,
    key: K,
    options: { value: AppearancePreferences[K]; label: string }[],
    hint?: string
  ): HTMLElement {
    const buttons = options.map((o) => {
      const b = el(
        'button',
        {
          class: 'seg-btn',
          type: 'button',
          role: 'radio',
          onclick: () => updatePreferences({ [key]: o.value } as Partial<AppearancePreferences>),
        },
        [o.label]
      );
      return { b, value: o.value };
    });
    const group = el('div', { class: 'seg', role: 'radiogroup', 'aria-label': label }, buttons.map((x) => x.b));
    onChange(() => {
      const cur = getPreferences()[key];
      for (const { b, value } of buttons) {
        const on = value === cur;
        b.classList.toggle('active', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
      }
    });
    // Arrow-key navigation inside a radiogroup.
    group.addEventListener('keydown', (e) => {
      if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
      e.preventDefault();
      const i = buttons.findIndex(({ b }) => b === document.activeElement);
      const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
      const next = buttons[(i + dir + buttons.length) % buttons.length]!;
      next.b.focus();
      next.b.click();
    });
    return el('div', { class: 'setting' }, [
      el('div', { class: 'setting-label' }, [label]),
      group,
      ...(hint ? [el('p', { class: 'setting-hint' }, [hint])] : []),
    ]);
  }

  function sectionReset(section: ResetSection): HTMLElement {
    return el(
      'button',
      {
        class: 'btn-text',
        type: 'button',
        onclick: () => {
          const before = { ...getPreferences() };
          resetSection(section);
          showToast('Section reset to defaults', {
            action: { label: 'Undo', run: () => updatePreferences(before, { immediate: true }) },
          });
        },
      },
      ['Reset this section']
    );
  }

  // ── live preview ────────────────────────────────────────────────────

  const preview = el('div', { class: 'ap-preview', 'aria-hidden': 'true' }, [
    el('div', { class: 'ap-preview-card' }, [
      el('div', { class: 'ap-poster' }, [el('span', { class: 'ap-poster-badge' }, ['94%'])]),
      el('div', { class: 'ap-preview-text' }, [
        el('h4', {}, ['The Midnight Reel']),
        el('p', {}, ['A sample card — heading, body text and controls update as you choose.']),
        el('div', { class: 'ap-preview-row' }, [
          el('span', { class: 'chip' }, ['thriller']),
          el('span', { class: 'chip' }, ['dark']),
          el('span', { class: 'ap-focus' }, ['focus']),
        ]),
        el('div', { class: 'ap-preview-row' }, [
          el('span', { class: 'btn btn-primary ap-btn' }, ['Find my next watch']),
          el('span', { class: 'btn btn-ghost ap-btn' }, ['Secondary']),
        ]),
      ]),
    ]),
  ]);

  // ── tab panels ──────────────────────────────────────────────────────

  function themesPanel(): HTMLElement {
    const paletteBtns = PALETTES.map((p) => {
      const btn = el(
        'button',
        { class: 'palette-btn', type: 'button', role: 'radio', 'data-palette-id': p.id, onclick: () => updatePreferences({ palette: p.id, customAccent: undefined }) },
        [
          el('span', { class: 'palette-swatch', 'aria-hidden': 'true' }, [
            el('i', { class: 'sw-dark', style: `background:${p.swatch[0]}` }, [el('b', { style: `background:${p.swatch[1]}` }), el('b', { style: `background:${p.swatch[2]}` })]),
            el('i', { class: 'sw-light', style: `background:${p.swatch[3]}` }, [el('b', { style: `background:${p.swatch[4]}` }), el('b', { style: `background:${p.swatch[5]}` })]),
          ]),
          el('span', { class: 'palette-name' }, [p.label]),
          el('span', { class: 'palette-mood' }, [p.mood]),
        ]
      );
      return { btn, id: p.id };
    });
    onChange(() => {
      const cur = getPreferences().palette;
      for (const { btn, id } of paletteBtns) {
        btn.classList.toggle('active', id === cur);
        btn.setAttribute('aria-checked', id === cur ? 'true' : 'false');
      }
    });

    // Accent: curated swatches + native picker + validated hex field.
    const hexInput = el('input', {
      class: 'hex-input',
      type: 'text',
      inputmode: 'text',
      maxlength: '7',
      placeholder: '#a78bfa',
      spellcheck: 'false',
      'aria-label': 'Custom accent colour as hex, for example #a78bfa',
    }) as HTMLInputElement;
    const picker = el('input', { class: 'color-input', type: 'color', value: '#a78bfa', 'aria-label': 'Pick a custom accent colour' }) as HTMLInputElement;
    const accentNote = el('p', { class: 'setting-hint', role: 'status' });

    const applyAccent = (hex: string) => {
      if (!isValidHex(hex)) {
        accentNote.textContent = 'Use a six-digit hex colour like #a78bfa.';
        return;
      }
      updatePreferences({ customAccent: hex.toLowerCase() });
    };
    hexInput.addEventListener('change', () => applyAccent(hexInput.value.trim().startsWith('#') ? hexInput.value.trim() : `#${hexInput.value.trim()}`));
    picker.addEventListener('input', () => applyAccent(picker.value));

    const accentBtns = ACCENT_CHOICES.map((hex) => {
      const b = el('button', { class: 'accent-dot', type: 'button', style: `background:${hex}`, 'aria-label': `Use accent ${hex}`, onclick: () => applyAccent(hex) });
      return { b, hex };
    });
    onChange(() => {
      const acc = getPreferences().customAccent;
      for (const { b, hex } of accentBtns) b.classList.toggle('active', acc === hex);
      if (acc) {
        hexInput.value = acc;
        picker.value = acc;
        const fg = accentForeground(acc);
        accentNote.textContent = fg.ok
          ? 'Accent applied to buttons, selections and particles. Success and error colours are unchanged.'
          : `Heads up: this accent only reaches ${fg.ratio.toFixed(1)}:1 contrast with button text — it may be hard to read. A different shade is safer.`;
      } else {
        hexInput.value = '';
        accentNote.textContent = 'Using the palette\u2019s own accent. Pick a swatch or enter a hex colour to override it.';
      }
    });

    return el('div', { class: 'ap-section' }, [
      choice('Appearance', 'mode', [
        { value: 'system', label: 'System' },
        { value: 'dark', label: 'Dark' },
        { value: 'light', label: 'Light' },
      ], 'System follows your device until you pick Light or Dark.'),
      el('div', { class: 'setting' }, [
        el('div', { class: 'setting-label' }, ['Palette']),
        el('div', { class: 'palette-grid', role: 'radiogroup', 'aria-label': 'Palette' }, paletteBtns.map((p) => p.btn)),
      ]),
      el('div', { class: 'setting' }, [
        el('div', { class: 'setting-label' }, ['Accent colour']),
        el('div', { class: 'accent-row' }, [...accentBtns.map((a) => a.b), picker, hexInput]),
        accentNote,
        el('button', { class: 'btn-text', type: 'button', onclick: () => updatePreferences({ customAccent: undefined }) }, ['Reset accent to palette default']),
      ]),
      el('div', { class: 'setting' }, [
        el('div', { class: 'setting-label' }, ['Choose a vibe']),
        el('div', { class: 'vibe-row' }, VIBES.map((v) => el('button', { class: 'chip chip-btn', type: 'button', title: v.blurb, onclick: () => applyVibe(v.id) }, [v.label]))),
        el('p', { class: 'setting-hint' }, ['A shortcut that sets ordinary options below — nothing hidden.']),
      ]),
      el('div', { class: 'ap-inline-actions' }, [
        (() => {
          const b = el('button', {
            class: 'btn btn-ghost toolbar-btn',
            type: 'button',
            onclick: () => {
              randomizePalette();
              showToast('Tried a random look', { action: { label: 'Undo', run: undo } });
            },
          });
          b.innerHTML = `<span class="icon-inline" style="width:15px;height:15px">${ICON.dice}</span> Surprise me`;
          return b;
        })(),
        sectionReset('themes'),
      ]),
    ]);
  }

  let fontsPrimed = false;
  function typographyPanel(): HTMLElement {
    const presets = FONT_PRESETS.map((f) => {
      const btn = el(
        'button',
        { class: 'font-btn', type: 'button', role: 'radio', onclick: () => updatePreferences({ fontPreset: f.id }) },
        [
          el('span', { class: 'font-sample', style: `font-family:${f.display};font-weight:${f.headingWeight}` }, ['Aa — Find your next film']),
          el('span', { class: 'font-name' }, [f.label]),
          el('span', { class: 'font-blurb', style: `font-family:${f.body}` }, [f.blurb]),
        ]
      );
      return { btn, id: f.id };
    });
    onChange(() => {
      const cur = getPreferences().fontPreset;
      for (const { btn, id } of presets) {
        btn.classList.toggle('active', id === cur);
        btn.setAttribute('aria-checked', id === cur ? 'true' : 'false');
      }
    });
    return el('div', { class: 'ap-section', 'data-prime-fonts': '' }, [
      el('div', { class: 'setting' }, [
        el('div', { class: 'setting-label' }, ['Font pairing']),
        el('div', { class: 'font-grid', role: 'radiogroup', 'aria-label': 'Font pairing' }, presets.map((p) => p.btn)),
        el('p', { class: 'setting-hint' }, ['Fonts are bundled with the app and only downloaded when you preview or choose them.']),
      ]),
      choice('Text size', 'textScale', [
        { value: 90, label: '90%' },
        { value: 100, label: '100%' },
        { value: 110, label: '110%' },
        { value: 125, label: '125%' },
      ]),
      choice('Line spacing', 'lineSpacing', [
        { value: 'compact', label: 'Compact' },
        { value: 'comfortable', label: 'Comfortable' },
        { value: 'relaxed', label: 'Relaxed' },
      ]),
      sectionReset('typography'),
    ]);
  }

  function primeFonts() {
    if (fontsPrimed) return;
    fontsPrimed = true;
    for (const f of FONT_PRESETS) void ensureFontLoaded(f.id);
  }

  const panels: Record<Tab, () => HTMLElement> = {
    themes: themesPanel,
    typography: typographyPanel,
    layout: () =>
      el('div', { class: 'ap-section' }, [
        choice('Content width', 'contentWidth', [
          { value: 'compact', label: 'Compact' },
          { value: 'comfortable', label: 'Comfortable' },
          { value: 'wide', label: 'Wide' },
        ]),
        choice('Interface density', 'density', [
          { value: 'comfortable', label: 'Comfortable' },
          { value: 'compact', label: 'Compact' },
        ], 'Density changes spacing only — touch targets keep their minimum size.'),
        choice('Poster size', 'posterSize', [
          { value: 'small', label: 'Small' },
          { value: 'medium', label: 'Medium' },
          { value: 'large', label: 'Large' },
        ]),
        choice('Card corners', 'cardShape', [
          { value: 'sharp', label: 'Sharp' },
          { value: 'standard', label: 'Standard' },
          { value: 'rounded', label: 'Rounded' },
        ]),
        choice('Surface', 'surfaceStyle', [
          { value: 'solid', label: 'Solid' },
          { value: 'glass', label: 'Soft glass' },
        ], 'Soft glass adds a gentle blur to floating surfaces; it is turned off by Reduced transparency.'),
        sectionReset('layout'),
      ]),
    motion: () =>
      el('div', { class: 'ap-section' }, [
        choice('Motion', 'motion', [
          { value: 'system', label: 'System' },
          { value: 'full', label: 'Full' },
          { value: 'subtle', label: 'Subtle' },
          { value: 'off', label: 'Off' },
        ], 'System behaves like Subtle, but switches large and continuous movement off if your device asks for reduced motion. Off still keeps instant state and focus feedback.'),
        choice('Hero particles', 'particles', [
          { value: 'off', label: 'Off' },
          { value: 'subtle', label: 'Subtle' },
          { value: 'balanced', label: 'Balanced' },
          { value: 'interactive', label: 'Interactive' },
        ], 'Only the landing hero has an animated background. Interactive reacts to a mouse pointer; on touch or low-power devices the effect is automatically reduced. Off is always respected.'),
        sectionReset('motion'),
      ]),
    accessibility: () =>
      el('div', { class: 'ap-section' }, [
        choice('Contrast', 'contrast', [
          { value: 'standard', label: 'Standard' },
          { value: 'high', label: 'High' },
        ], 'Strengthens text, borders and selected states.'),
        choice('Transparency', 'transparency', [
          { value: 'standard', label: 'Standard' },
          { value: 'reduced', label: 'Reduced' },
        ], 'Reduced uses solid surfaces and removes background blur.'),
        el('div', { class: 'setting' }, [
          el('div', { class: 'setting-label' }, ['Comfort preset']),
          el('button', {
            class: 'btn btn-ghost toolbar-btn',
            type: 'button',
            onclick: () => {
              const before = { ...getPreferences() };
              updatePreferences({ density: 'comfortable', textScale: 110, contrast: 'high', transparency: 'reduced', motion: 'subtle' }, { immediate: true });
              showToast('Comfort preset applied', { action: { label: 'Undo', run: () => updatePreferences(before, { immediate: true }) } });
            },
          }, ['Apply comfort preset']),
          el('p', { class: 'setting-hint' }, ['110% text, high contrast, reduced transparency and subtle motion. Appearance only. Keyboard focus is always visible and can\u2019t be switched off.']),
        ]),
        sectionReset('accessibility'),
      ]),
  };

  // ── shell ───────────────────────────────────────────────────────────

  const built = new Map<Tab, HTMLElement>();
  const body = el('div', { class: 'ap-body', id: 'ap-body', role: 'tabpanel' });
  const tabButtons = TABS.map((t) => {
    const b = el(
      'button',
      { class: 'ap-tab', type: 'button', role: 'tab', id: `ap-tab-${t.id}`, 'aria-controls': 'ap-body', onclick: () => showTab(t.id) },
      [t.label]
    );
    return { b, id: t.id };
  });
  const tablist = el('div', { class: 'ap-tabs', role: 'tablist', 'aria-label': 'Appearance sections' }, tabButtons.map((t) => t.b));
  tablist.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = tabButtons.findIndex((t) => t.b === document.activeElement);
    const next = tabButtons[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabButtons.length) % tabButtons.length]!;
    next.b.focus();
    showTab(next.id);
  });

  function showTab(id: Tab) {
    let node = built.get(id);
    if (!node) {
      node = panels[id]();
      built.set(id, node);
    }
    body.replaceChildren(node);
    body.setAttribute('aria-labelledby', `ap-tab-${id}`);
    for (const t of tabButtons) {
      const on = t.id === id;
      t.b.classList.toggle('active', on);
      t.b.setAttribute('aria-selected', on ? 'true' : 'false');
      t.b.tabIndex = on ? 0 : -1;
    }
    if (id === 'typography') primeFonts();
    runSync();
  }

  const status = el('span', { class: 'ap-status', role: 'status', 'aria-live': 'polite' });
  const undoBtn = el('button', { class: 'btn-text', type: 'button', onclick: undo }, []);
  undoBtn.innerHTML = `<span class="icon-inline" style="width:14px;height:14px">${ICON.undo}</span> Undo`;
  const redoBtn = el('button', { class: 'btn-text', type: 'button', onclick: redo }, []);
  redoBtn.innerHTML = `<span class="icon-inline" style="width:14px;height:14px">${ICON.redo}</span> Redo`;
  const resetAllBtn = el(
    'button',
    {
      class: 'btn-text-danger',
      type: 'button',
      onclick: () => {
        const before = { ...getPreferences() };
        resetAllAppearance();
        showToast('Appearance reset — your ratings and watchlist are untouched', {
          action: { label: 'Undo', run: () => updatePreferences(before, { immediate: true }) },
        });
      },
    },
    ['Reset all appearance']
  );

  function runSync() {
    for (const s of syncers) s();
    undoBtn.toggleAttribute('disabled', !canUndo());
    redoBtn.toggleAttribute('disabled', !canRedo());
    const p = getPreferences();
    const changed = JSON.stringify(p) !== JSON.stringify(DEFAULT_PREFERENCES);
    resetAllBtn.toggleAttribute('disabled', !changed);
    status.textContent = isAppearancePersisted() ? 'Saved on this device' : 'Applied for this session only \u2014 browser storage is blocked';
    status.classList.toggle('warn', !isAppearancePersisted());
  }

  const closeBtn = el('button', { class: 'modal-close ap-close', type: 'button', 'aria-label': 'Close appearance settings' });
  closeBtn.innerHTML = ICON.close;

  const titleId = 'ap-title';
  const panel = el('aside', { class: 'appearance-panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId }, [
    el('div', { class: 'ap-head' }, [
      el('div', {}, [
        el('h2', { id: titleId }, ['Appearance']),
        el('p', { class: 'ap-sub' }, [`Currently ${effectiveMode()} \u00b7 changes apply instantly`]),
      ]),
      closeBtn,
    ]),
    preview,
    tablist,
    body,
    el('div', { class: 'ap-foot' }, [el('div', { class: 'ap-foot-row' }, [undoBtn, redoBtn, status]), resetAllBtn]),
  ]);
  const scrim = el('div', { class: 'ap-scrim' }, [panel]);
  document.body.appendChild(scrim);
  document.body.style.overflow = 'hidden';

  const unsubscribe = subscribeAppearance(() => {
    runSync();
    const sub = panel.querySelector('.ap-sub');
    if (sub) sub.textContent = `Currently ${effectiveMode()} \u00b7 changes apply instantly`;
  });

  showTab(initialTab);
  const release = trapFocus(panel, {
    initialFocus: tabButtons.find((t) => t.id === initialTab)!.b,
    onEscape: close,
    // The toast host sits outside the drawer; keep its Undo button reachable.
    also: () => [document.querySelector<HTMLElement>('.toast-host')],
  });

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    openPanel = null;
    unsubscribe();
    scrim.classList.add('closing');
    const done = () => {
      scrim.remove();
      document.body.style.overflow = '';
      release();
    };
    // Match the exit animation; fall back immediately if motion is off.
    if (getComputedStyle(panel).animationName === 'none' || document.documentElement.getAttribute('data-motion') === 'off') done();
    else window.setTimeout(done, 180);
  }
  openPanel = { close };

  scrim.addEventListener('mousedown', (e) => {
    if (e.target === scrim) close();
  });
  closeBtn.addEventListener('click', close);
}
