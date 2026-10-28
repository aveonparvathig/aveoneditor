/**
 * Tabbed symbol and template toolbar for the formula editor. Keyboard: Alt+1…9 open tabs,
 * ←/→ move between tabs when the tab list is focused, arrows move inside the symbol grid,
 * Enter/Space insert, Esc returns focus to the formula canvas.
 */

import { View } from '../../../ui/view';
import { ButtonView } from '../../../ui/button/buttonview';
import { createDropdown } from '../../../ui/dropdown/dropdownview';
import { ColorGridView, type ColorDefinition } from '../../../ui/colorgrid/colorgridview';
import type { Locale } from '../../../utils/locale';
import type { CatalogueItem, CatalogueSection, CatalogueTab, ColorItem, InputItem, SelectItem } from './catalogue';
import { renderStatic, type FormulaEditorView } from './formulaview';
import { createTable } from '../model/nodes';
import { periodicTable } from './periodictable';
import { elementToken } from './catalogue';

export const defaultMathColors: ColorDefinition[] = [
  { color: 'black', label: 'Black' },
  { color: 'dimgray', label: 'Dim grey' },
  { color: 'gray', label: 'Grey' },
  { color: 'lightgray', label: 'Light grey' },
  { color: 'white', label: 'White', options: { hasBorder: true } },
  { color: 'red', label: 'Red' },
  { color: 'orange', label: 'Orange' },
  { color: 'yellow', label: 'Yellow' },
  { color: 'lightgreen', label: 'Light green' },
  { color: 'green', label: 'Green' },
  { color: 'aquamarine', label: 'Aquamarine' },
  { color: 'turquoise', label: 'Turquoise' },
  { color: 'lightblue', label: 'Light blue' },
  { color: 'blue', label: 'Blue' },
  { color: 'purple', label: 'Purple' }
];

export class MathToolbarView extends View {
  declare public activeTab: string;
  declare public element: HTMLDivElement | null;
  public readonly tabs: CatalogueTab[];
  public colors: ColorDefinition[] = defaultMathColors;
  private readonly _canvas: FormulaEditorView;
  private _tabList: HTMLElement | null = null;
  private _panel: HTMLElement | null = null;
  private _tabButtons = new Map<string, ButtonView>();
  private _itemButtons: ButtonView[] = [];
  private _syncers: Array<() => void> = [];

  constructor(locale: Locale, tabs: CatalogueTab[], canvas: FormulaEditorView) {
    super(locale);
    this.tabs = tabs;
    this._canvas = canvas;
    this.set('activeTab', tabs[0].id);
    this.setTemplate({ tag: 'div', attributes: { class: ['ck', 'ck-math-toolbar'] } });
    this.on('change:activeTab', () => this._renderPanel());
    canvas.on('caretChange', () => this._sync());
    canvas.on('change', () => this._sync());
  }

  private get tr(): (message: string) => string {
    return this.locale ? (message: string) => this.locale!.t(message) : (message: string) => message;
  }

  public override render(): void {
    super.render();
    const doc = this.element!.ownerDocument;
    this._tabList = doc.createElement('div');
    this._tabList.className = 'ck ck-math-toolbar__tabs';
    this._tabList.setAttribute('role', 'tablist');
    this._panel = doc.createElement('div');
    this._panel.className = 'ck ck-math-toolbar__panel';
    this._panel.setAttribute('role', 'tabpanel');
    this.element!.append(this._tabList, this._panel);

    this.tabs.forEach((tab, index) => {
      const button = new ButtonView(this.locale);
      button.set({ label: this.tr(tab.label), withText: true, tooltip: index < 9 ? `Alt+${index + 1}` : false });
      button.bind('isOn').to(this, 'activeTab', (active: string) => active === tab.id);
      button.on('execute', () => {
        this.activeTab = tab.id;
        this._canvas.focus();
      });
      button.render();
      button.element!.setAttribute('role', 'tab');
      button.element!.classList.add('ck-math-toolbar__tab');
      this._tabList!.appendChild(button.element!);
      this._tabButtons.set(tab.id, button);
    });

    this._tabList.addEventListener('keydown', evt => {
      const ids = this.tabs.map(tab => tab.id);
      const index = ids.indexOf(this.activeTab);
      if (evt.key === 'ArrowRight' || evt.key === 'ArrowLeft') {
        const next = (index + (evt.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length;
        this.activeTab = ids[next];
        this._tabButtons.get(ids[next])!.focus();
        evt.preventDefault();
      } else if (evt.key === 'ArrowDown') {
        this.focusFirstItem();
        evt.preventDefault();
      }
    });

    this._panel.addEventListener('keydown', evt => this._onPanelKeyDown(evt));
    this._renderPanel();
  }

  /** Handles Alt+1…9, Alt+0 and Alt+←/→. Returns `true` when consumed. */
  public handleKeystroke(evt: KeyboardEvent): boolean {
    if (!evt.altKey || evt.ctrlKey || evt.metaKey) return false;
    const ids = this.tabs.map(tab => tab.id);
    if (/^[0-9]$/.test(evt.key)) {
      const id = evt.key === '0' ? ids[9] : ids[Number(evt.key) - 1];
      if (!id) return false;
      this.activeTab = id;
      this.focusFirstItem();
      return true;
    }
    if (evt.key === 'ArrowLeft' || evt.key === 'ArrowRight') {
      const index = ids.indexOf(this.activeTab);
      this.activeTab = ids[(index + (evt.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length];
      return true;
    }
    return false;
  }

  public focusTabs(): void {
    this._tabButtons.get(this.activeTab)?.focus();
  }

  public focusFirstItem(): void {
    const first = this._itemButtons.find(button => button.isEnabled && button.element && !button.element.closest('[hidden]'));
    if (first) first.focus();
  }

  private _onPanelKeyDown(evt: KeyboardEvent): void {
    const target = evt.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'SELECT') {
      if (evt.key === 'Escape') {
        this._canvas.focus();
        evt.preventDefault();
        evt.stopPropagation();
      }
      return;
    }
    const buttons = this._itemButtons.filter(button => button.element && button.isEnabled && !button.element.closest('[hidden]'));
    const index = buttons.findIndex(button => button.element === evt.target || button.element!.contains(evt.target as Node));
    if (index === -1) return;
    const columns = this._columnsOf(buttons[index].element!);
    let next = -1;
    if (evt.key === 'ArrowRight') next = index + 1;
    else if (evt.key === 'ArrowLeft') next = index - 1;
    else if (evt.key === 'ArrowDown') next = index + columns;
    else if (evt.key === 'ArrowUp') next = index - columns;
    else if (evt.key === 'Escape') {
      this._canvas.focus();
      evt.preventDefault();
      evt.stopPropagation();
      return;
    } else return;
    if (next >= 0 && next < buttons.length) buttons[next].focus();
    else if (evt.key === 'ArrowUp') this.focusTabs();
    evt.preventDefault();
  }

  private _columnsOf(element: HTMLElement): number {
    const grid = element.parentElement;
    if (!grid) return 1;
    const first = grid.firstElementChild as HTMLElement | null;
    if (!first) return 1;
    const top = first.offsetTop;
    let count = 0;
    for (const child of Array.from(grid.children) as HTMLElement[]) {
      if (child.offsetTop !== top) break;
      count++;
    }
    return Math.max(1, count);
  }

  private _renderPanel(): void {
    if (!this._panel) return;
    this._itemButtons.forEach(button => button.destroy());
    this._itemButtons = [];
    this._syncers = [];
    this._panel.replaceChildren();
    const tab = this.tabs.find(t => t.id === this.activeTab);
    if (!tab) return;
    const doc = this._panel.ownerDocument;
    for (const section of tab.sections) {
      const sectionElement = doc.createElement('div');
      sectionElement.className = 'ck ck-math-toolbar__section';
      sectionElement.dataset.section = section.id;
      if (section.contextual) sectionElement.dataset.contextual = section.contextual;
      const title = doc.createElement('span');
      title.className = 'ck ck-math-toolbar__section-title';
      title.textContent = this.tr(section.label);
      const grid = doc.createElement('div');
      grid.className = 'ck ck-math-toolbar__grid';
      grid.setAttribute('role', 'group');
      grid.setAttribute('aria-label', this.tr(section.label));
      for (const item of section.items) {
        grid.appendChild(this._createItem(item));
      }
      sectionElement.append(title, grid);
      this._panel.appendChild(sectionElement);
    }
    if (tab.id === 'contextual') {
      const hint = doc.createElement('p');
      hint.className = 'ck ck-math-toolbar__hint';
      hint.textContent = this.tr('Place the caret inside a matrix or a fence, or select an element, to see its options.');
      this._panel.appendChild(hint);
    }
    this._sync();
  }

  private _createItem(item: CatalogueItem): HTMLElement {
    switch (item.kind) {
      case 'color':
        return this._createColorItem(item);
      case 'select':
        return this._createSelectItem(item);
      case 'input':
        return this._createInputItem(item);
      case 'matrix-picker':
        return this._createMatrixPicker();
      case 'periodic-table':
        return this._createPeriodicTable();
      default:
        return this._createItemButton(item).element!;
    }
  }

  private _createItemButton(item: CatalogueItem): ButtonView {
    const button = new ButtonView(this.locale);
    button.set({ label: this.tr(item.label), tooltip: true });
    button.extendTemplate({ attributes: { class: ['ck-math-toolbar__item', `ck-math-toolbar__item-${item.kind}`] } });
    button.render();
    const content = button.element!.ownerDocument.createElement('span');
    content.className = 'ck ck-math-toolbar__item-content ck-reset_all-excluded';
    if (item.kind === 'action') {
      content.textContent = item.text || item.label;
      if (item.isEnabled || item.isOn) {
        this._syncers.push(() => {
          if (item.isEnabled) button.isEnabled = item.isEnabled(this._canvas);
          if (item.isOn) button.isOn = item.isOn(this._canvas);
        });
      }
    } else if (item.kind === 'symbol' || item.kind === 'template') {
      const nodes = item.kind === 'symbol' ? (item.preview ? item.preview() : item.nodes()) : item.preview();
      content.appendChild(renderStatic(nodes, button.element!.ownerDocument));
    }
    button.element!.appendChild(content);
    button.on('execute', () => {
      if (item.kind === 'symbol') this._canvas.insertNodes(item.nodes());
      else if (item.kind === 'template') this._canvas.insertTemplate(item.build);
      else if (item.kind === 'action') item.run(this._canvas);
      this._canvas.focus();
    });
    this._itemButtons.push(button);
    return button;
  }

  private _createColorItem(item: ColorItem): HTMLElement {
    const dropdown = createDropdown(this.locale);
    dropdown.buttonView.set({ label: this.tr(item.label), tooltip: true, withText: false });
    dropdown.extendTemplate({ attributes: { class: ['ck-math-toolbar__item', 'ck-math-toolbar__item-color'] } });
    const grid = new ColorGridView(this.locale, { colorDefinitions: this.colors.map(c => ({ ...c, label: this.tr(c.label || c.color) })), columns: 5 });
    const remove = new ButtonView(this.locale);
    remove.set({ label: this.tr(item.target === 'color' ? 'Remove colour' : 'Remove background'), withText: true });
    remove.extendTemplate({ attributes: { class: ['ck-math-toolbar__remove-color'] } });
    remove.on('execute', () => {
      this._canvas.applyStyle({ [item.target]: undefined } as any);
      dropdown.isOpen = false;
      this._canvas.focus();
    });
    dropdown.panelView.children.add(remove);
    dropdown.panelView.children.add(grid);
    grid.on('execute', (evt, data: { value: string }) => {
      this._canvas.applyStyle({ [item.target]: data.value } as any);
      dropdown.isOpen = false;
      this._canvas.focus();
    });
    dropdown.render();
    const content = dropdown.element!.ownerDocument.createElement('span');
    content.className = 'ck ck-math-toolbar__item-content ck-math-toolbar__color-swatch';
    content.textContent = item.target === 'color' ? 'A' : '▇';
    dropdown.buttonView.element!.appendChild(content);
    this._syncers.push(() => {
      const style = this._canvas.getContext().style;
      const value = style ? style[item.target] : undefined;
      content.style.color = item.target === 'color' && value ? value : '';
      content.style.backgroundColor = item.target === 'background' && value ? value : '';
      grid.selectedColor = value;
      dropdown.isEnabled = this._canvas.hasSelection || !!style;
    });
    return dropdown.element!;
  }

  private _createSelectItem(item: SelectItem): HTMLElement {
    const doc = this._panel!.ownerDocument;
    const select = doc.createElement('select');
    select.className = 'ck ck-math-toolbar__select';
    select.setAttribute('aria-label', this.tr(item.label));
    select.title = this.tr(item.label);
    for (const option of item.options) {
      const element = doc.createElement('option');
      element.value = option.value;
      element.textContent = this.tr(option.label);
      select.appendChild(element);
    }
    select.addEventListener('change', () => {
      item.set(this._canvas, select.value);
      this._canvas.focus();
    });
    select.addEventListener('mousedown', evt => evt.stopPropagation());
    this._syncers.push(() => {
      select.value = item.get(this._canvas);
    });
    return select;
  }

  private _createInputItem(item: InputItem): HTMLElement {
    const doc = this._panel!.ownerDocument;
    const wrapper = doc.createElement('label');
    wrapper.className = 'ck ck-math-toolbar__input';
    const text = doc.createElement('span');
    text.textContent = this.tr(item.label);
    const input = doc.createElement('input');
    input.type = 'text';
    input.className = 'ck ck-input ck-input-text';
    input.placeholder = item.placeholder || '';
    input.setAttribute('aria-label', this.tr(item.label));
    const apply = () => {
      const value = input.value.trim();
      if (value && !/^-?[\d.]+(px|em|ex)$/.test(value)) {
        input.classList.add('ck-error');
        return;
      }
      input.classList.remove('ck-error');
      item.set(this._canvas, value);
    };
    input.addEventListener('change', apply);
    input.addEventListener('keydown', evt => {
      if (evt.key === 'Enter') {
        apply();
        this._canvas.focus();
        evt.preventDefault();
      }
    });
    this._syncers.push(() => {
      if (doc.activeElement !== input) input.value = item.get(this._canvas);
    });
    wrapper.append(text, input);
    return wrapper;
  }

  private _createMatrixPicker(): HTMLElement {
    const doc = this._panel!.ownerDocument;
    const wrapper = doc.createElement('div');
    wrapper.className = 'ck ck-math-toolbar__matrix-picker';
    const makeNumber = (label: string, value: number) => {
      const field = doc.createElement('label');
      const text = doc.createElement('span');
      text.textContent = this.tr(label);
      const input = doc.createElement('input');
      input.type = 'number';
      input.min = '1';
      input.max = '20';
      input.value = String(value);
      input.className = 'ck ck-input ck-input-text';
      input.setAttribute('aria-label', this.tr(label));
      field.append(text, input);
      return { field, input };
    };
    const rows = makeNumber('Rows', 2);
    const columns = makeNumber('Columns', 2);
    const fenceSelect = doc.createElement('select');
    fenceSelect.className = 'ck ck-math-toolbar__select';
    fenceSelect.setAttribute('aria-label', this.tr('Matrix brackets'));
    const fenceChoices: Array<[string, string]> = [['paren', '( )'], ['bracket', '[ ]'], ['brace', '{ }'], ['bar', '| |'], ['double-bar', '‖ ‖'], ['none', this.tr('No brackets')]];
    for (const [value, label] of fenceChoices) {
      const option = doc.createElement('option');
      option.value = value;
      option.textContent = label || '';
      fenceSelect.appendChild(option);
    }
    const insert = new ButtonView(this.locale);
    insert.set({ label: this.tr('Insert matrix'), withText: true });
    insert.render();
    const doInsert = () => {
      const r = Math.min(20, Math.max(1, parseInt(rows.input.value, 10) || 1));
      const c = Math.min(20, Math.max(1, parseInt(columns.input.value, 10) || 1));
      this._canvas.insertTemplate(() => ({ node: createTable(r, c, fenceSelect.value as any) }));
      this._canvas.focus();
    };
    insert.on('execute', doInsert);
    for (const input of [rows.input, columns.input]) {
      input.addEventListener('keydown', evt => {
        if (evt.key === 'Enter') {
          doInsert();
          evt.preventDefault();
        }
      });
    }
    wrapper.append(rows.field, columns.field, fenceSelect, insert.element!);
    this._itemButtons.push(insert);
    return wrapper;
  }

  private _createPeriodicTable(): HTMLElement {
    const doc = this._panel!.ownerDocument;
    const details = doc.createElement('details');
    details.className = 'ck ck-math-toolbar__periodic';
    const summary = doc.createElement('summary');
    summary.textContent = this.tr('Show periodic table');
    details.appendChild(summary);
    const grid = doc.createElement('div');
    grid.className = 'ck ck-math-toolbar__periodic-grid';
    grid.setAttribute('role', 'grid');
    grid.setAttribute('aria-label', this.tr('Periodic table'));
    for (const element of periodicTable) {
      const button = new ButtonView(this.locale);
      button.set({ label: `${element.number} ${element.name}`, tooltip: true });
      button.extendTemplate({ attributes: { class: ['ck-math-toolbar__item', 'ck-math-toolbar__element', `ck-math-toolbar__element-${element.category}`] } });
      button.render();
      button.element!.style.gridRow = String(element.period + (element.period >= 8 ? 1 : 0));
      button.element!.style.gridColumn = String(element.group);
      const content = doc.createElement('span');
      content.className = 'ck ck-math-toolbar__item-content';
      content.textContent = element.symbol;
      button.element!.appendChild(content);
      button.on('execute', () => {
        this._canvas.insertNodes([elementToken(element.symbol)]);
        this._canvas.focus();
      });
      this._itemButtons.push(button);
      grid.appendChild(button.element!);
    }
    details.appendChild(grid);
    return details;
  }

  private _sync(): void {
    if (!this._panel) return;
    const context = this._canvas.getContext();
    const visible: Record<string, boolean> = {
      table: !!context.table,
      fence: !!context.fence,
      selection: this._canvas.hasSelection,
      style: !!context.style
    };
    for (const section of Array.from(this._panel.querySelectorAll<HTMLElement>('[data-contextual]'))) {
      section.hidden = !visible[section.dataset.contextual as string];
    }
    for (const sync of this._syncers) sync();
  }

  /** Re-renders the panel (after the catalogue changed). */
  public refresh(): void {
    this._renderPanel();
  }

  public getSections(tabId: string): CatalogueSection[] {
    return this.tabs.find(tab => tab.id === tabId)?.sections || [];
  }
}
