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
  applyLook,
  contrastRatio,
  canRedo,
  canUndo,
  DEFAULT_PREFERENCES,
  deleteLook,
  effectiveMode,
  exportAppearance,
  getPreferences,
  hasBaselineDifference,
  importAppearance,
  isPeeking,
  listLooks,
  markAppearanceBaseline,
  MAX_LOOKS,
  peekBaseline,
  restoreBaseline,
  saveLook,
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
        // Two separate risks: text on the accent (buttons), and the accent
        // against the page itself (borders, selected states, focus cues).
        const pageBg = getComputedStyle(document.documentElement).getPropertyValue('--bg-0').trim();
        const onPage = /^#[0-9a-f]{6}$/i.test(pageBg) ? contrastRatio(acc, pageBg) : 21;
        accentNote.textContent = !fg.ok
          ? `Heads up: this accent only reaches ${fg.ratio.toFixed(1)}:1 contrast with button text \u2014 it may be hard to read. A different shade is safer.`
          : onPage < 3
            ? `Heads up: this accent is very close to the page background (${onPage.toFixed(1)}:1), so selections and outlines may be hard to see. Try a stronger shade.`
            : 'Accent applied to buttons, selections and particles. Success and error colours are unchanged.';
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
      looksSection(),
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

  function advancedEffects(): HTMLElement {
    return el('details', { class: 'ap-advanced' }, [
      el('summary', {}, ['Advanced effects']),
      choice('Particle density', 'particleDensity', [
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
      ], 'High is capped on touch and low-power devices.'),
      choice('Connection lines', 'connections', [
        { value: 'off', label: 'Off' },
        { value: 'faint', label: 'Faint' },
        { value: 'normal', label: 'Normal' },
      ]),
      choice('Pointer response', 'pointerResponse', [
        { value: 'off', label: 'Off' },
        { value: 'gentle', label: 'Gentle' },
        { value: 'noticeable', label: 'Noticeable' },
      ], 'Only applies with Hero particles set to Interactive and a mouse. Nothing ever requires pointer movement.'),
      choice('Click pulse', 'clickPulse', [
        { value: 'off', label: 'Off' },
        { value: 'on', label: 'On' },
      ], 'One small, soft ripple in the hero. Mouse only.'),
      choice('Poster tilt', 'posterTilt', [
        { value: 'off', label: 'Off' },
        { value: 'gentle', label: 'Gentle' },
      ], 'Mouse only; always off on touch and with reduced motion.'),
      choice('Hover glow', 'hoverGlow', [
        { value: 'off', label: 'Off' },
        { value: 'subtle', label: 'Subtle' },
        { value: 'strong', label: 'Strong' },
      ], 'A soft highlight under the pointer on result cards. Text contrast is kept at every level.'),
    ]);
  }

  /** Up to three named looks, plus versioned JSON export / import. Appearance
   * fields only — never ratings, watchlist, profile or quiz answers. */
  function looksSection(): HTMLElement {
    const list = el('div', { class: 'ap-section', style: 'gap:8px' });
    const nameInput = el('input', { class: 'look-input', type: 'text', maxlength: '24', placeholder: 'Name this look', 'aria-label': 'Name for the new look' }) as HTMLInputElement;
    const msg = el('p', { class: 'ap-msg', role: 'status' });
    const saveBtn = el('button', {
      class: 'btn btn-ghost toolbar-btn',
      type: 'button',
      onclick: () => {
        const r = saveLook(nameInput.value || 'My look');
        msg.classList.toggle('error', !r.ok);
        msg.textContent = r.ok ? `Saved \u201c${r.look.name}\u201d.` : r.error;
        if (r.ok) nameInput.value = '';
      },
    }, ['Save current look']);

    const render = () => {
      const looks = listLooks();
      list.replaceChildren(
        ...(looks.length
          ? looks.map((l) =>
              el('div', { class: 'look-row' }, [
                el('button', { class: 'btn-text', type: 'button', onclick: () => applyLook(l.id) }, [l.name]),
                el('button', { class: 'btn-text-danger', type: 'button', 'aria-label': `Delete look ${l.name}`, onclick: () => deleteLook(l.id) }, ['Delete']),
              ])
            )
          : [el('p', { class: 'ap-msg' }, ['No saved looks yet.'])])
      );
      saveBtn.toggleAttribute('disabled', looks.length >= MAX_LOOKS);
      nameInput.toggleAttribute('disabled', looks.length >= MAX_LOOKS);
    };
    onChange(render);

    const exportBox = el('textarea', { class: 'ap-textarea', readonly: true, 'aria-label': 'Exported appearance JSON', rows: '4' }) as HTMLTextAreaElement;
    const importBox = el('textarea', { class: 'ap-textarea', 'aria-label': 'Paste appearance JSON to import', placeholder: 'Paste an exported appearance here', rows: '4' }) as HTMLTextAreaElement;
    const ioMsg = el('p', { class: 'ap-msg', role: 'status' });

    return el('div', { class: 'ap-section' }, [
      el('div', { class: 'setting' }, [
        el('div', { class: 'setting-label' }, [`My looks (up to ${MAX_LOOKS})`]),
        list,
        el('div', { class: 'look-row' }, [nameInput, saveBtn]),
        msg,
      ]),
      el('div', { class: 'setting' }, [
        el('div', { class: 'setting-label' }, ['Share or back up']),
        el('p', { class: 'setting-hint' }, ['Exports only appearance settings. Your ratings, watchlist and profile are never included.']),
        el('div', { class: 'ap-inline-actions' }, [
          el('button', {
            class: 'btn btn-ghost toolbar-btn',
            type: 'button',
            onclick: () => {
              exportBox.value = exportAppearance();
              exportBox.select();
              void navigator.clipboard?.writeText(exportBox.value).then(
                () => (ioMsg.textContent = 'Copied to your clipboard.'),
                () => (ioMsg.textContent = 'Select the text above and copy it.')
              );
            },
          }, ['Export appearance']),
        ]),
        exportBox,
        importBox,
        el('div', { class: 'ap-inline-actions' }, [
          el('button', {
            class: 'btn btn-ghost toolbar-btn',
            type: 'button',
            onclick: () => {
              const r = importAppearance(importBox.value);
              ioMsg.classList.toggle('error', !r.ok);
              ioMsg.textContent = r.ok ? 'Imported. Undo is available if you want the previous look back.' : r.error;
              if (r.ok) importBox.value = '';
            },
          }, ['Import appearance']),
        ]),
        ioMsg,
      ]),
    ]);
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
        choice('Results layout', 'resultLayout', [
          { value: 'grid', label: 'Poster grid' },
          { value: 'spotlight', label: 'Spotlight' },
          { value: 'list', label: 'Compact list' },
        ], 'Every layout keeps details, match reasons, watchlist, compare and rating one tap away. The top pick always gets its featured card.'),
        choice('Poster labels', 'posterLabels', [
          { value: 'detailed', label: 'Detailed' },
          { value: 'essential', label: 'Essential' },
        ], 'Essential shows title, year and match on cards; the reason chips move to the detail sheet.'),
        choice('Shadows', 'shadows', [
          { value: 'minimal', label: 'Minimal' },
          { value: 'standard', label: 'Standard' },
          { value: 'expressive', label: 'Expressive' },
        ]),
        choice('Decorative grain', 'grain', [
          { value: 'off', label: 'Off' },
          { value: 'subtle', label: 'Subtle' },
        ], 'A static texture on the landing page only \u2014 never an animated filter.'),
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
        choice('Artwork ambience', 'artworkAmbience', [
          { value: 'off', label: 'Off' },
          { value: 'subtle', label: 'Subtle' },
          { value: 'balanced', label: 'Balanced' },
        ], 'A soft halo around your top pick, tinted from its poster. Decoration only \u2014 it never changes text or button colours. Reduced automatically on touch and low-power devices.'),
        choice('Transition intensity', 'transitionIntensity', [
          { value: 'minimal', label: 'Minimal' },
          { value: 'standard', label: 'Standard' },
          { value: 'cinematic', label: 'Cinematic' },
        ], 'Cinematic lengthens the hero entry and the top-pick reveal; it never adds waiting before you can act.'),
        advancedEffects(),
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

  // Theme Studio: Before/After against the appearance from when this panel
  // opened (preview only — nothing is saved while comparing), and a one-click
  // return to that appearance.
  markAppearanceBaseline();
  const compareBtn = el('button', {
    class: 'btn btn-ghost toolbar-btn',
    type: 'button',
    'aria-pressed': 'false',
    onclick: () => peekBaseline(!isPeeking()),
  }, ['Compare with before']);
  const restoreBtn = el('button', { class: 'btn-text', type: 'button', onclick: () => restoreBaseline() }, ['Restore previous']);
  const studioRow = el('div', { class: 'ap-studio', style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:6px 20px 0' }, [
    compareBtn,
    restoreBtn,
    el('span', { class: 'ap-msg', 'data-peek-note': '', role: 'status' }),
  ]);

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
    const differs = hasBaselineDifference();
    const peek = isPeeking();
    compareBtn.setAttribute('aria-pressed', peek ? 'true' : 'false');
    compareBtn.textContent = peek ? 'Showing before \u2014 tap to return' : 'Compare with before';
    compareBtn.toggleAttribute('disabled', !differs && !peek);
    restoreBtn.toggleAttribute('disabled', !differs);
    const note = studioRow.querySelector('[data-peek-note]');
    if (note) note.textContent = peek ? 'Preview only \u2014 your changes are kept.' : '';
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
    studioRow,
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
    peekBaseline(false); // never leave the page showing a comparison preview
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
