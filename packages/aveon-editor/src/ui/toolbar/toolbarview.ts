import { View } from '../view';
import { ViewCollection } from '../viewcollection';
import { FocusTracker } from '../../utils/focustracker';
import { KeystrokeHandler } from '../../utils/keystrokehandler';
import { FocusCycler } from '../focuscycler';
import { ToolbarSeparatorView } from './toolbarseparatorview';
import { ToolbarLineBreakView } from './toolbarlinebreakview';
import { DropdownView, createDropdown, addToolbarToDropdown } from '../dropdown/dropdownview';
import { icons } from '../icons';
import type { Locale } from '../../utils/locale';
import type { ComponentFactory } from '../../core/componentfactory';
import { debounce } from '../../utils/misc';

export interface ToolbarOptions {
  shouldGroupWhenFull?: boolean;
  isCompact?: boolean;
}

export type ToolbarConfig = string[] | { items?: string[]; removeItems?: string[]; shouldNotGroupWhenFull?: boolean };

/**
 * Toolbar containing buttons, dropdowns and separators. Supports keyboard navigation
 * and automatic grouping of overflowing items into a "more" dropdown.
 */
export class ToolbarView extends View {
  public readonly options: ToolbarOptions;
  public readonly items = this.createCollection();
  public readonly focusTracker = new FocusTracker();
  public readonly keystrokes = new KeystrokeHandler();
  public readonly itemsView: View;
  public readonly children = this.createCollection();
  public readonly focusables = this.createCollection();
  declare public ariaLabel: string;
  declare public maxWidth: string;
  declare public class: string | undefined;
  declare public isCompact: boolean;
  declare public isVertical: boolean;
  declare public role: string | undefined;
  private readonly _focusCycler: FocusCycler;
  private readonly _behavior: ToolbarBehavior;

  constructor(locale?: Locale, options: ToolbarOptions = {}) {
    super(locale);
    const bind = this.bindTemplate;
    const t = this.t || ((s: string) => s);
    this.options = options;
    this.set('ariaLabel', t('Editor toolbar'));
    this.set('maxWidth', 'auto');
    this.set('class', undefined);
    this.set('isCompact', !!options.isCompact);
    this.set('isVertical', false);
    this.set('role', 'toolbar');

    this.itemsView = new ItemsView(locale);
    this.children.add(this.itemsView);

    this._focusCycler = new FocusCycler({
      focusables: this.focusables,
      focusTracker: this.focusTracker,
      keystrokeHandler: this.keystrokes,
      actions: {
        focusPrevious: ['arrowleft', 'arrowup'],
        focusNext: ['arrowright', 'arrowdown']
      }
    });

    this.setTemplate({
      tag: 'div',
      attributes: {
        class: ['ck', 'ck-toolbar', bind.to('class'), bind.if('isCompact', 'ck-toolbar_compact'), bind.if('isVertical', 'ck-toolbar_vertical')],
        role: bind.to('role'),
        'aria-label': bind.to('ariaLabel'),
        style: { 'max-width': bind.to('maxWidth') } as any,
        tabindex: -1
      },
      children: this.children,
      on: {
        mousedown: (evt: Event) => {
          if ((evt.target as HTMLElement) === this.element) evt.preventDefault();
        }
      }
    });

    this._behavior = this.options.shouldGroupWhenFull ? new DynamicGrouping(this) : new StaticLayout(this);
  }

  public override render(): void {
    super.render();
    this.focusTracker.add(this.element!);
    for (const item of this.focusables) {
      if (item.element) this.focusTracker.add(item.element);
    }
    this.focusables.on('add', (evt, item: View) => {
      if (item.element) this.focusTracker.add(item.element);
    });
    this.focusables.on('remove', (evt, item: View) => {
      if (item.element) this.focusTracker.remove(item.element);
    });
    this.keystrokes.listenTo(this.element as any);
    this._behavior.render(this);
  }

  public override destroy(): void {
    this._behavior.destroy();
    for (const item of this.items) item.destroy();
    this.focusTracker.destroy();
    this.keystrokes.destroy();
    super.destroy();
  }

  public focus(): void {
    this._focusCycler.focusFirst();
  }

  public focusLast(): void {
    this._focusCycler.focusLast();
  }

  /** Populates the toolbar from a config (`['bold', '|', 'link']`). */
  public fillFromConfig(itemsOrConfig: ToolbarConfig | undefined, factory: ComponentFactory, removeItems?: string[]): void {
    this.items.addMany(this._buildItemsFromConfig(itemsOrConfig, factory, removeItems));
  }

  private _buildItemsFromConfig(itemsOrConfig: ToolbarConfig | undefined, factory: ComponentFactory, removeItems?: string[]): View[] {
    const config = normalizeToolbarConfig(itemsOrConfig);
    const normalizedRemoveItems = removeItems || config.removeItems;
    const itemsToClean = this._cleanItemsConfiguration(config.items, factory, normalizedRemoveItems);
    const result: View[] = [];
    for (const item of itemsToClean) {
      if (item === '|') {
        result.push(new ToolbarSeparatorView());
      } else if (item === '-') {
        result.push(new ToolbarLineBreakView());
      } else if (typeof item === 'object') {
        result.push(this._createNestedToolbarDropdown(item, factory, normalizedRemoveItems));
      } else {
        result.push(factory.create(item));
      }
    }
    return result;
  }

  private _cleanItemsConfiguration(items: Array<string | Record<string, any>>, factory: ComponentFactory, removeItems: string[]): Array<string | Record<string, any>> {
    const filtered = items.filter(item => {
      if (typeof item === 'object') return true;
      if (item === '-') return !this.options.shouldGroupWhenFull;
      if (item === '|') return true;
      if (removeItems.includes(item)) return false;
      if (!factory.has(item)) {
        console.warn(`toolbarview-item-unavailable: The requested toolbar item "${item}" is unavailable.`);
        return false;
      }
      return true;
    });
    return this._cleanSeparators(filtered);
  }

  private _cleanSeparators(items: Array<string | Record<string, any>>): Array<string | Record<string, any>> {
    const nonSeparatorPredicate = (item: unknown) => item !== '-' && item !== '|';
    const count = items.length;
    const firstCommandItem = items.findIndex(nonSeparatorPredicate);
    if (firstCommandItem === -1) return [];
    const lastCommandItem = count - items.slice().reverse().findIndex(nonSeparatorPredicate);
    return items.slice(firstCommandItem, lastCommandItem).filter((name, idx, arr) => {
      if (nonSeparatorPredicate(name)) return true;
      const isDuplicateSeparator = idx > 0 && arr[idx - 1] === name;
      return !isDuplicateSeparator;
    });
  }

  private _createNestedToolbarDropdown(definition: Record<string, any>, componentFactory: ComponentFactory, removeItems: string[]): DropdownView {
    const { label, icon, items, tooltip = true, withText = false } = definition;
    const dropdownView = createDropdown(this.locale);
    if (!label) {
      console.warn('toolbarview-nested-toolbar-dropdown-missing-label');
    }
    dropdownView.class = 'ck-toolbar__nested-toolbar-dropdown';
    dropdownView.buttonView.set({ label, tooltip, withText: !!withText });
    if (icon !== false) {
      dropdownView.buttonView.icon = (icons as any)[icon] || icon || icons.threeVerticalDots;
    } else {
      dropdownView.buttonView.withText = true;
    }
    addToolbarToDropdown(dropdownView, () => (dropdownView.toolbarView as ToolbarView)._buildItemsFromConfig(items, componentFactory, removeItems));
    return dropdownView;
  }
}

class ItemsView extends View {
  public readonly children = this.createCollection();

  constructor(locale?: Locale) {
    super(locale);
    this.setTemplate({
      tag: 'div',
      attributes: { class: ['ck', 'ck-toolbar__items'] },
      children: this.children
    });
  }
}

interface ToolbarBehavior {
  render(view: ToolbarView): void;
  destroy(): void;
}

class StaticLayout implements ToolbarBehavior {
  constructor(view: ToolbarView) {
    const bind = view.bindTemplate;
    view.set('isVertical', false);
    view.items.on('add', (evt, item: View, index: number) => {
      (view.itemsView as ItemsView).children.add(item, index);
      view.focusables.add(item, index);
    });
    view.items.on('remove', (evt, item: View) => {
      (view.itemsView as ItemsView).children.remove(item);
      view.focusables.remove(item);
    });
    view.extendTemplate({ attributes: { class: [bind.if('isVertical', 'ck-toolbar_vertical')] } });
  }

  public render(): void {
    /* nothing */
  }

  public destroy(): void {
    /* nothing */
  }
}

/** Groups items that do not fit into a "Show more items" dropdown. */
class DynamicGrouping implements ToolbarBehavior {
  public readonly view: ToolbarView;
  public readonly viewChildren: ViewCollection;
  public readonly viewFocusables: ViewCollection;
  public readonly viewItemsView: ItemsView;
  public readonly viewFocusTracker: FocusTracker;
  public readonly viewLocale?: Locale;
  public readonly ungroupedItems: ViewCollection;
  public readonly groupedItems: ViewCollection;
  public readonly groupedItemsDropdown: DropdownView;
  private _resizeObserver: ResizeObserver | null = null;
  private _cachedPadding: number | null = null;
  private _updateLock = false;
  private _updateDebounced: (() => void) & { cancel(): void };

  constructor(view: ToolbarView) {
    this.view = view;
    this.viewChildren = view.children;
    this.viewFocusables = view.focusables;
    this.viewItemsView = view.itemsView as ItemsView;
    this.viewFocusTracker = view.focusTracker;
    this.viewLocale = view.locale;
    this.ungroupedItems = view.createCollection();
    this.groupedItems = view.createCollection();
    this.groupedItemsDropdown = this._createGroupedItemsDropdown();
    this._updateDebounced = debounce(() => this._updateGrouping(), 50);

    view.items.on('change', (evt, data: { index: number; added: View[]; removed: View[] }) => {
      const index = data.index;
      const added = data.added;
      const removed = data.removed;
      for (const removedItem of removed) {
        if (index >= this.ungroupedItems.length) {
          this.groupedItems.remove(removedItem);
        } else {
          this.ungroupedItems.remove(removedItem);
        }
      }
      for (let currentIndex = index; currentIndex < index + added.length; currentIndex++) {
        const addedItem = added[currentIndex - index];
        if (currentIndex > this.ungroupedItems.length) {
          this.groupedItems.add(addedItem, currentIndex - this.ungroupedItems.length);
        } else {
          this.ungroupedItems.add(addedItem, currentIndex);
        }
      }
      this._updateGrouping();
    });

    this.ungroupedItems.on('add', (evt, item: View, index: number) => {
      this.viewItemsView.children.add(item, index);
      this.viewFocusables.add(item, index);
    });
    this.ungroupedItems.on('remove', (evt, item: View) => {
      this.viewItemsView.children.remove(item);
      this.viewFocusables.remove(item);
    });

    view.extendTemplate({ attributes: { class: ['ck-toolbar_grouping'] } });
  }

  public render(view: ToolbarView): void {
    this.viewElement = view.element!;
    this._enableGroupingOnResize();
    this._enableGroupingOnMaxWidthChange(view);
  }

  public viewElement!: HTMLElement;

  public destroy(): void {
    this.groupedItemsDropdown.destroy();
    if (this._resizeObserver) this._resizeObserver.disconnect();
    this._updateDebounced.cancel();
  }

  private _updateGrouping(): void {
    if (!this.viewElement || !this.viewElement.ownerDocument.body.contains(this.viewElement)) return;
    if (this._updateLock) return;
    if (!(this.viewElement as HTMLElement).offsetParent) return;
    this._updateLock = true;
    let wereItemsGrouped = false;
    while (this._areItemsOverflowing()) {
      this._groupLastItem();
      wereItemsGrouped = true;
    }
    if (!wereItemsGrouped && this.groupedItems.length) {
      while (this.groupedItems.length && !this._areItemsOverflowing()) {
        this._ungroupFirstItem();
      }
      if (this._areItemsOverflowing()) {
        this._groupLastItem();
      }
    }
    this._updateLock = false;
  }

  private _areItemsOverflowing(): boolean {
    if (!this.ungroupedItems.length) return false;
    const element = this.viewElement;
    const uiLanguageDirection = this.viewLocale ? this.viewLocale.uiLanguageDirection : 'ltr';
    const lastChildRect = this.viewItemsView.element!.lastElementChild!.getBoundingClientRect();
    const toolbarRect = element.getBoundingClientRect();
    if (!this._cachedPadding) {
      const computedStyle = window.getComputedStyle(element);
      const paddingProperty = uiLanguageDirection === 'ltr' ? 'paddingRight' : 'paddingLeft';
      this._cachedPadding = Number.parseInt(computedStyle[paddingProperty as any]) || 0;
    }
    if (uiLanguageDirection === 'ltr') {
      return lastChildRect.right > toolbarRect.right - this._cachedPadding;
    }
    return lastChildRect.left < toolbarRect.left + this._cachedPadding;
  }

  private _enableGroupingOnResize(): void {
    if (typeof ResizeObserver === 'undefined') return;
    let previousWidth: number | undefined;
    this._resizeObserver = new ResizeObserver(entries => {
      const width = entries[0].contentRect.width;
      if (previousWidth !== width) {
        previousWidth = width;
        this._updateGrouping();
      }
    });
    this._resizeObserver.observe(this.viewElement);
    this._updateGrouping();
  }

  private _enableGroupingOnMaxWidthChange(view: ToolbarView): void {
    view.on('change:maxWidth', () => this._updateGrouping());
  }

  private _groupLastItem(): void {
    if (!this.groupedItems.length) {
      this.viewChildren.add(new ToolbarSeparatorView());
      this.viewChildren.add(this.groupedItemsDropdown);
      this.viewFocusTracker.add(this.groupedItemsDropdown.element!);
    }
    this.groupedItems.add(this.ungroupedItems.remove(this.ungroupedItems.last!), 0);
  }

  private _ungroupFirstItem(): void {
    this.ungroupedItems.add(this.groupedItems.remove(this.groupedItems.first!));
    if (!this.groupedItems.length) {
      this.viewChildren.remove(this.groupedItemsDropdown);
      this.viewChildren.remove(this.viewChildren.last!);
      this.viewFocusTracker.remove(this.groupedItemsDropdown.element!);
    }
  }

  private _createGroupedItemsDropdown(): DropdownView {
    const locale = this.viewLocale;
    const t = locale ? locale.t : (s: string) => s;
    const dropdown = createDropdown(locale);
    dropdown.class = 'ck-toolbar__grouped-dropdown';
    dropdown.panelPosition = locale && locale.uiLanguageDirection === 'ltr' ? 'sw' : 'se';
    addToolbarToDropdown(dropdown, this.groupedItems);
    dropdown.buttonView.set({ label: t('Show more items'), tooltip: true, tooltipPosition: locale && locale.uiLanguageDirection === 'rtl' ? 'se' : 'sw', icon: icons.threeVerticalDots });
    return dropdown;
  }
}

export function normalizeToolbarConfig(config: ToolbarConfig | undefined): { items: Array<string | Record<string, any>>; removeItems: string[]; shouldNotGroupWhenFull?: boolean } {
  if (Array.isArray(config)) {
    return { items: config, removeItems: [] };
  }
  const predefined = { items: [], removeItems: [] };
  if (!config) return predefined;
  return { ...predefined, ...config, items: (config.items || []) as any[] };
}
