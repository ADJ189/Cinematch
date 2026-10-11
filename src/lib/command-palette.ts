// src/lib/command-palette.ts
//
// Quick navigation / search overlay (Ctrl/Cmd+K, or "/") and the keyboard
// shortcut help dialog ("?").
//
// Keyboard-conflict rules (checked, not assumed):
//   • Plain-key shortcuts ("/" and "?") never fire while typing in an
//     input/textarea/select/contenteditable, with any modifier held, during
//     IME composition, or when something already handled the key.
//   • Ctrl/Cmd+K is the only shortcut that works while typing, because it
//     is the conventional "open command menu" chord.
//   • Nothing opens on top of another modal dialog (Appearance, a detail
//     sheet, or this palette itself).
//
// The list follows the WAI-ARIA combobox/listbox pattern: DOM focus stays on
// the input; the highlighted option is exposed with aria-activedescendant.

import { trapFocus } from './a11y';
import { getTheme, toggleTheme } from './theme';
import { el } from './dom';
import { ICON } from './icons';
import { randomizePalette, undo } from './appearance';
import { isAppearanceOpen, openAppearancePanel } from './settings-panel';
import { store } from './store';
import { showToast } from './toast';

interface Command {
  id: string;
  label: string;
  hint?: string;
  keywords: string;
  run: () => void;
}

let paletteOpen = false;
let helpOpen = false;

function anyDialogOpen(): boolean {
  return paletteOpen || helpOpen || isAppearanceOpen() || !!document.querySelector('.modal-overlay');
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
}

function baseCommands(): Command[] {
  const cmds: Command[] = [
    { id: 'home', label: 'Go to home', keywords: 'landing start', run: () => store.setScreen('landing') },
    { id: 'quiz', label: 'Take the quiz', hint: '7 questions', keywords: 'find recommend start', run: () => store.setScreen('quiz') },
    { id: 'search', label: 'Search for a title', keywords: 'find movie show similar', run: () => store.setScreen('search') },
    { id: 'appearance', label: 'Open appearance settings', keywords: 'theme palette font colour color customize', run: () => openAppearancePanel() },
    {
      id: 'mode',
      label: getTheme() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode',
      keywords: 'theme dark light toggle',
      run: () => {
        toggleTheme();
      },
    },
    {
      id: 'surprise',
      label: 'Try a random look',
      keywords: 'surprise random palette theme',
      run: () => {
        randomizePalette();
        showToast('Tried a random look', { action: { label: 'Undo', run: undo } });
      },
    },
    { id: 'help', label: 'Keyboard shortcuts', hint: '?', keywords: 'keys help shortcuts', run: () => window.setTimeout(openShortcutHelp, 0) },
  ];
  return cmds;
}

export function openCommandPalette(): void {
  if (paletteOpen || anyDialogOpen()) return;
  paletteOpen = true;
  const input = el('input', {
    class: 'cmd-input',
    type: 'text',
    role: 'combobox',
    'aria-expanded': 'true',
    'aria-controls': 'cmd-list',
    'aria-autocomplete': 'list',
    'aria-label': 'Search commands or type a title to look up',
    placeholder: 'Type a command, or a title to search\u2026',
    autocomplete: 'off',
    spellcheck: 'false',
    maxlength: '120',
  }) as HTMLInputElement;
  const list = el('ul', { class: 'cmd-list', id: 'cmd-list', role: 'listbox', 'aria-label': 'Results' });
  const live = el('p', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite' });
  const searchIcon = el('span', { class: 'icon-inline cmd-icon' });
  searchIcon.innerHTML = ICON.command;

  const dialog = el('div', { class: 'cmd-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Command menu' }, [
    el('div', { class: 'cmd-bar' }, [searchIcon, input, el('kbd', { class: 'kbd' }, ['Esc'])]),
    list,
    live,
    el('div', { class: 'cmd-foot' }, [
      el('span', {}, [el('kbd', { class: 'kbd' }, ['\u2191']), ' ', el('kbd', { class: 'kbd' }, ['\u2193']), ' move']),
      el('span', {}, [el('kbd', { class: 'kbd' }, ['Enter']), ' choose']),
    ]),
  ]);
  const overlay = el('div', { class: 'cmd-overlay' }, [dialog]);
  document.body.appendChild(overlay);

  let items: Command[] = [];
  let active = 0;

  const optionId = (i: number) => `cmd-opt-${i}`;

  function compute(): Command[] {
    const q = input.value.trim().toLowerCase();
    const cmds = baseCommands();
    const matches = q ? cmds.filter((c) => `${c.label} ${c.keywords}`.toLowerCase().includes(q)) : cmds;
    if (q.length >= 2) {
      const query = input.value.trim();
      const searchCmd: Command = {
        id: 'q',
        label: `Search titles for \u201c${query.slice(0, 50)}\u201d`,
        keywords: '',
        run: () => store.openInSearch({ kind: 'query', query }),
      };
      // A command that matches what was typed ("quiz", "theme") wins the first
      // slot; "search for this title" leads only when nothing else matches.
      if (matches.length > 0) matches.push(searchCmd);
      else matches.unshift(searchCmd);
    }
    return matches;
  }

  function render() {
    items = compute();
    active = Math.min(active, Math.max(0, items.length - 1));
    list.replaceChildren(
      ...items.map((c, i) =>
        el(
          'li',
          {
            class: `cmd-item${i === active ? ' active' : ''}`,
            id: optionId(i),
            role: 'option',
            'aria-selected': i === active ? 'true' : 'false',
            onmousemove: () => {
              if (active !== i) {
                active = i;
                paintActive();
              }
            },
            onclick: () => choose(i),
          },
          [el('span', {}, [c.label]), ...(c.hint ? [el('span', { class: 'cmd-hint' }, [c.hint])] : [])]
        )
      )
    );
    if (items.length === 0) list.appendChild(el('li', { class: 'cmd-empty', role: 'presentation' }, ['No matching commands.']));
    input.setAttribute('aria-activedescendant', items.length ? optionId(active) : '');
    live.textContent = items.length === 0 ? 'No matching commands' : `${items.length} result${items.length === 1 ? '' : 's'}`;
  }

  function paintActive() {
    list.querySelectorAll<HTMLElement>('.cmd-item').forEach((n, i) => {
      n.classList.toggle('active', i === active);
      n.setAttribute('aria-selected', i === active ? 'true' : 'false');
      if (i === active) n.scrollIntoView({ block: 'nearest' });
    });
    input.setAttribute('aria-activedescendant', items.length ? optionId(active) : '');
  }

  function choose(i: number) {
    const cmd = items[i];
    if (!cmd) return;
    close(false);
    cmd.run();
  }

  input.addEventListener('input', () => {
    active = 0;
    render();
  });
  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (items.length) active = (active + 1) % items.length;
      paintActive();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length) active = (active - 1 + items.length) % items.length;
      paintActive();
    } else if (e.key === 'Home' && !input.value) {
      e.preventDefault();
      active = 0;
      paintActive();
    } else if (e.key === 'End' && !input.value) {
      e.preventDefault();
      active = Math.max(0, items.length - 1);
      paintActive();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(active);
    }
  });
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close(true);
  });

  const release = trapFocus(dialog, { initialFocus: input, onEscape: () => close(true) });
  render();

  let closed = false;
  function close(restoreFocus: boolean) {
    if (closed) return;
    closed = true;
    paletteOpen = false;
    overlay.remove();
    // release() returns focus to whatever opened the palette. When a command
    // then navigates, main.ts moves focus to the new screen's heading.
    void restoreFocus;
    release();
  }
}

const SHORTCUTS: [string, string][] = [
  ['Ctrl / \u2318 + K', 'Open the command menu'],
  ['/', 'Open the command menu (when not typing)'],
  ['?', 'Show this list'],
  ['Esc', 'Close a dialog, menu or the command menu'],
  ['\u2191 \u2193 Enter', 'Move through and choose command-menu results'],
  ['Tab / Shift + Tab', 'Move between controls (dialogs keep focus inside)'],
];

export function openShortcutHelp(): void {
  if (anyDialogOpen()) return;
  helpOpen = true;
  const closeBtn = el('button', { class: 'modal-close', type: 'button', 'aria-label': 'Close keyboard shortcuts' });
  closeBtn.innerHTML = ICON.close;
  const dialog = el('div', { class: 'help-dialog modal-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'help-title' }, [
    closeBtn,
    el('h2', { id: 'help-title' }, ['Keyboard shortcuts']),
    el('dl', { class: 'help-list' }, SHORTCUTS.flatMap(([k, d]) => [el('dt', {}, [el('kbd', { class: 'kbd' }, [k])]), el('dd', {}, [d])])),
  ]);
  const overlay = el('div', { class: 'modal-overlay help-overlay' }, [dialog]);
  document.body.appendChild(overlay);
  const release = trapFocus(dialog, { initialFocus: closeBtn, onEscape: close });
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close();
  });
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    helpOpen = false;
    overlay.remove();
    release();
  }
}

let started = false;

export function initShortcuts(): void {
  if (started) return;
  started = true;
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.isComposing) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openCommandPalette();
      return;
    }
    if (mod || e.altKey || isTypingTarget(e.target)) return;
    if (e.key === '/') {
      e.preventDefault();
      openCommandPalette();
    } else if (e.key === '?') {
      e.preventDefault();
      openShortcutHelp();
    }
  });
}
