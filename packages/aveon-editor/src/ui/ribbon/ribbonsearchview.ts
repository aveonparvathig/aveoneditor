/**
 * "Tell me what you want to do": a search box in the ribbon's tab row that finds any ribbon command
 * by name and runs it, so people do not have to know which tab it lives on.
 *
 * Typing lists matching commands (with their tab and group); ↑/↓ choose, Enter runs, Esc clears.
 */

import { View } from '../view';
import type { Locale } from '../../utils/locale';

export interface RibbonSearchEntry {
  /** What the command is called (its tooltip or label). */
  label: string;
  /** Where it lives, e.g. "Home › Font". */
  path: string;
  isEnabled: boolean;
  run(): void;
}

const MAX_RESULTS = 8;

export class RibbonSearchView extends View {
  private readonly _getEntries: () => RibbonSearchEntry[];
  private _results: RibbonSearchEntry[] = [];
  private _highlighted = -1;
  private _input: HTMLInputElement | null = null;
  private _list: HTMLElement | null = null;

  constructor(locale: Locale | undefined, getEntries: () => RibbonSearchEntry[]) {
    super(locale);
    this._getEntries = getEntries;
    const t = this.t || ((s: string) => s);
    this.setTemplate({
      tag: 'div',
      attributes: { class: ['ck', 'ck-ribbon__search'] },
      children: [
        {
          tag: 'input',
          attributes: {
            type: 'search',
            class: ['ck', 'ck-ribbon__search-input'],
            placeholder: t('Search commands'),
            'aria-label': t('Search commands'),
            role: 'combobox',
            'aria-autocomplete': 'list',
            'aria-expanded': 'false',
            autocomplete: 'off',
            spellcheck: 'false'
          }
        },
        { tag: 'ul', attributes: { class: ['ck', 'ck-ribbon__search-results', 'ck-hidden'], role: 'listbox' } }
      ]
    });
  }

  public override render(): void {
    super.render();
    this._input = this.element!.querySelector('input');
    this._list = this.element!.querySelector('ul');
    const listId = `ck-ribbon-search-${Math.random().toString(36).slice(2)}`;
    this._list!.id = listId;
    this._input!.setAttribute('aria-controls', listId);

    this._input!.addEventListener('input', () => this._update());
    this._input!.addEventListener('focus', () => this._update());
    this._input!.addEventListener('blur', () => setTimeout(() => this._close(), 150));
    this._input!.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (!this._results.length) return;
        const step = event.key === 'ArrowDown' ? 1 : -1;
        this._highlight((this._highlighted + step + this._results.length) % this._results.length);
      } else if (event.key === 'Enter') {
        this._run(this._highlighted === -1 ? 0 : this._highlighted);
      } else if (event.key === 'Escape') {
        if (!this._input!.value && !this._results.length) return;
        this.clear();
      } else {
        return;
      }
      // Keep the ribbon's own keyboard handling (tab switching) out of the box.
      event.preventDefault();
      event.stopPropagation();
    });
    // Mouse down instead of click: it comes before the input's blur closes the list.
    this._list!.addEventListener('mousedown', event => {
      const item = (event.target as HTMLElement).closest('li');
      if (!item) return;
      event.preventDefault();
      this._run(Number(item.dataset.index));
    });
  }

  public focus(): void {
    this._input?.focus();
  }

  public clear(): void {
    if (this._input) this._input.value = '';
    this._close();
  }

  /** Commands matching the query: names starting with it first, then names containing it. */
  public search(query: string): RibbonSearchEntry[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const scored: Array<{ entry: RibbonSearchEntry; score: number }> = [];
    for (const entry of this._getEntries()) {
      const label = entry.label.toLowerCase();
      const haystack = `${label} ${entry.path.toLowerCase()}`;
      if (!words.every(word => haystack.includes(word))) continue;
      const score = (label.startsWith(words[0]) ? 0 : label.split(/\W+/).some(part => part.startsWith(words[0])) ? 1 : 2) + (entry.isEnabled ? 0 : 3);
      scored.push({ entry, score });
    }
    return scored
      .sort((a, b) => a.score - b.score || a.entry.label.length - b.entry.label.length)
      .slice(0, MAX_RESULTS)
      .map(item => item.entry);
  }

  private _update(): void {
    this._results = this.search(this._input!.value);
    const list = this._list!;
    list.textContent = '';
    const t = this.t || ((s: string) => s);
    if (this._input!.value.trim() && !this._results.length) {
      const empty = list.ownerDocument.createElement('li');
      empty.className = 'ck-ribbon__search-empty';
      empty.textContent = t('No matching commands');
      list.appendChild(empty);
    }
    this._results.forEach((entry, index) => {
      const item = list.ownerDocument.createElement('li');
      item.className = 'ck-ribbon__search-result';
      item.id = `${list.id}-${index}`;
      item.setAttribute('role', 'option');
      item.dataset.index = String(index);
      if (!entry.isEnabled) item.setAttribute('aria-disabled', 'true');
      const name = list.ownerDocument.createElement('span');
      name.className = 'ck-ribbon__search-label';
      name.textContent = entry.label;
      const path = list.ownerDocument.createElement('span');
      path.className = 'ck-ribbon__search-path';
      path.textContent = entry.path;
      item.append(name, path);
      list.appendChild(item);
    });
    const open = list.childElementCount > 0;
    list.classList.toggle('ck-hidden', !open);
    this._input!.setAttribute('aria-expanded', String(open));
    this._highlight(this._results.length ? 0 : -1);
  }

  private _highlight(index: number): void {
    this._highlighted = index;
    const items = this._list!.querySelectorAll('.ck-ribbon__search-result');
    items.forEach((item, i) => item.classList.toggle('ck-on', i === index));
    if (index === -1) this._input!.removeAttribute('aria-activedescendant');
    else this._input!.setAttribute('aria-activedescendant', items[index].id);
  }

  private _run(index: number): void {
    const entry = this._results[index];
    if (!entry || !entry.isEnabled) return;
    this.clear();
    entry.run();
  }

  private _close(): void {
    this._results = [];
    this._highlighted = -1;
    if (!this._list) return;
    this._list.textContent = '';
    this._list.classList.add('ck-hidden');
    this._input!.setAttribute('aria-expanded', 'false');
    this._input!.removeAttribute('aria-activedescendant');
  }
}
