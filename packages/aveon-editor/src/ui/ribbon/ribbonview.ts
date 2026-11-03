/**
 * Word-style ribbon: a row of tabs (Home, Insert, …), each showing labelled groups of toolbar items
 * (Clipboard, Font, Paragraph…). Items come from the component factory, exactly like toolbar items.
 *
 * Keyboard: Alt+F10 focuses the active tab, ←/→ switch tabs, ↓ or Enter moves into the tab's
 * groups, Tab/Shift+Tab move between group rows, ←/→ move within a row and Esc returns to the content.
 * Double-clicking a tab (or Ctrl+F1) collapses the ribbon to its tab row.
 */

import { View } from '../view';
import { ButtonView } from '../button/buttonview';
import { ToolbarView } from '../toolbar/toolbarview';
import { ToolbarSeparatorView } from '../toolbar/toolbarseparatorview';
import { RibbonSearchView, type RibbonSearchEntry } from './ribbonsearchview';
import { FocusTracker } from '../../utils/focustracker';
import { KeystrokeHandler } from '../../utils/keystrokehandler';
import { icons } from '../icons';
import { uid } from '../../utils/uid';
import { getEnvKeystrokeText } from '../../utils/keyboard';
import type { Locale } from '../../utils/locale';
import type { ComponentFactory } from '../../core/componentfactory';

export type RibbonItemSize = 'large' | 'medium' | 'small' | 'combo';

/**
 * A ribbon item: a component name (small, icon-only button) or an object giving its size and an
 * optional short label. Large items show a big icon above the label (the group's main action);
 * medium items show a small icon beside the label, stacked up to three high. Combo items (font name
 * and size) sit in a small-item row and look like a text box showing the current value.
 */
export type RibbonItem = string | { name: string; size?: RibbonItemSize; label?: string };

export interface RibbonGroupConfig {
  label: string;
  /** Items; among small items `-` starts a new row and `|` adds a separator. */
  items: RibbonItem[];
  /** A "more options" corner button (like Word's dialog launchers) that runs this command. */
  launcher?: { command: string; label?: string };
}

export interface RibbonTabConfig {
  label: string;
  groups: RibbonGroupConfig[];
  /**
   * Makes this a contextual tab (like Word's Table and Picture tabs), shown only while the context
   * is active: `'table'` (cursor in a table), `'image'` (picture selected) or any name switched with
   * `RibbonView#setContextActive()`.
   */
  contextual?: string;
}

export interface RibbonConfig {
  tabs: RibbonTabConfig[];
  /** Items always visible at the start of the tab row (e.g. undo and redo). */
  quickAccess?: string[];
  /** Start with only the tab row visible. */
  collapsed?: boolean;
  /** The command search box in the tab row (default true). */
  search?: boolean;
}

function itemName(item: RibbonItem): string {
  return typeof item === 'string' ? item : item.name;
}

/** Makes a component show its label (and use a short one), keeping the full name in its tooltip. */
function applyItemSize(view: View, size: RibbonItemSize, label?: string): void {
  const anyView = view as any;
  // Dropdowns carry their button in `buttonView`; split buttons also have an `actionView`.
  const host: any = anyView.buttonView || anyView;
  if (size === 'combo') {
    if (!(host instanceof ButtonView)) return;
    // The box shows the current value (e.g. "Arial", "12"); the name stays in the tooltip.
    const bound = (host as any)._boundProps as Map<string, unknown> | undefined;
    if (anyView.valueText !== undefined && !(bound && bound.has('label'))) {
      const name = host.label || '';
      if (host.tooltip === true || !host.tooltip) host.tooltip = name;
      host.withText = true;
      host.bind('label').to(anyView, 'valueText', (value: string) => value || name);
    }
    view.extendTemplate({ attributes: { class: ['ck-ribbon__item', 'ck-ribbon__item_combo'] } });
    return;
  }
  if (size === 'small' || !(host instanceof ButtonView || host.actionView instanceof ButtonView)) return;
  const showLabel = (button: any) => {
    const bound = button._boundProps as Map<string, unknown> | undefined;
    if (!(bound && bound.has('withText'))) button.withText = true;
    if (!label || (bound && bound.has('label'))) return;
    const full = button.label;
    if (full && full !== label && !(bound && bound.has('tooltip'))) {
      button.tooltip = button.keystroke ? `${full} (${getEnvKeystrokeText(button.keystroke)})` : full;
    }
    button.label = label;
  };
  showLabel(host);
  // Some split buttons (e.g. image insert) label their action half directly.
  if (host.actionView) showLabel(host.actionView);
  // Through the template, so the classes survive the button's own class re-renders.
  view.extendTemplate({ attributes: { class: ['ck-ribbon__item', `ck-ribbon__item_${size}`] } });
}

/**
 * One labelled group (e.g. "Font") inside a ribbon tab. Large items get a column each, medium items
 * stack three to a column and small items flow in rows; each column or row is its own toolbar, so
 * the group is only as wide as it needs to be.
 */
export class RibbonGroupView extends View {
  /** Every toolbar in the group, in reading order (the keyboard Tab stops). */
  public readonly toolbars: ToolbarView[] = [];
  public readonly launcherView: ButtonView | null;
  public readonly label: string;
  /** Shown instead of the group's items when the window is too narrow (like Word's collapsed groups). */
  public readonly toggleView: ButtonView;
  /** The group is collapsed to its toggle button. */
  declare public isCompact: boolean;
  /** A collapsed group's items are shown in a drop-down. */
  declare public isOpen: boolean;
  private readonly _blocks = this.createCollection();
  private _removeListeners = () => {};

  constructor(locale: Locale | undefined, config: RibbonGroupConfig, factory: ComponentFactory) {
    super(locale);
    const label = config.label;
    this.label = label;
    const newToolbar = (className: string) => {
      const toolbar = new ToolbarView(locale);
      toolbar.ariaLabel = label;
      toolbar.class = className;
      this.toolbars.push(toolbar);
      return toolbar;
    };

    let medium: ToolbarView | null = null;
    let smallRows: Array<Array<{ name: string; size: RibbonItemSize }>> | null = null;
    const flushSmall = () => {
      if (!smallRows) return;
      const rows = smallRows
        .map(row => row.filter(item => item.name === '|' || factory.has(item.name)))
        .filter(row => row.some(item => item.name !== '|'));
      smallRows = null;
      if (!rows.length) return;
      const block = new View(locale);
      const rowViews = block.createCollection();
      for (const row of rows) {
        const toolbar = newToolbar('ck-ribbon__group-row');
        for (const item of row) {
          if (item.name === '|') {
            toolbar.items.add(new ToolbarSeparatorView(locale));
            continue;
          }
          const view = factory.create(item.name);
          if (item.size === 'combo') applyItemSize(view, 'combo');
          toolbar.items.add(view);
        }
        rowViews.add(toolbar);
      }
      block.setTemplate({ tag: 'div', attributes: { class: ['ck', 'ck-ribbon__block', 'ck-ribbon__block_small'] }, children: rowViews });
      this._blocks.add(block);
    };

    for (const item of config.items) {
      const size: RibbonItemSize = typeof item === 'string' ? 'small' : item.size || 'small';
      const name = itemName(item);
      if (size === 'small' || size === 'combo') {
        medium = null;
        if (!smallRows) smallRows = [[]];
        if (name === '-') smallRows.push([]);
        else smallRows[smallRows.length - 1].push({ name, size });
        continue;
      }
      flushSmall();
      if (!factory.has(name)) continue;
      const view = factory.create(name);
      applyItemSize(view, size, typeof item === 'string' ? undefined : item.label);
      if (size === 'large') {
        medium = null;
        const toolbar = newToolbar('ck-ribbon__block ck-ribbon__block_large');
        toolbar.items.add(view);
        this._blocks.add(toolbar);
      } else {
        if (!medium || medium.items.length >= 3) {
          medium = newToolbar('ck-ribbon__block ck-ribbon__block_medium');
          this._blocks.add(medium);
        }
        medium.items.add(view);
      }
    }
    flushSmall();

    const t = this.t || ((s: string) => s);
    const labelId = `ck-ribbon-group-${uid()}`;
    const footer: any[] = [{ tag: 'span', attributes: { class: ['ck', 'ck-ribbon__group-label'], id: labelId }, children: [label] }];
    this.launcherView = null;
    if (config.launcher) {
      const launcher = new ButtonView(locale);
      const launcherConfig = config.launcher;
      launcher.set({ label: launcherConfig.label || t('More %0 options').replace('%0', label), icon: icons.launcher, tooltip: true, class: 'ck-ribbon__launcher' });
      launcher.on('execute', () => this.fire('launch', launcherConfig));
      this.launcherView = launcher;
      footer.push(launcher);
    }

    this.set('isCompact', false);
    this.set('isOpen', false);
    this.on('change:isCompact', (evt, name, compact: boolean) => {
      if (!compact) this.isOpen = false;
    });
    this.toggleView = new ButtonView(locale);
    this.toggleView.set({ label, withText: true, icon: icons.dropdownArrow, class: 'ck-ribbon__group-toggle', tooltip: false });
    this.toggleView.bind('isOn').to(this, 'isOpen');
    this.toggleView.extendTemplate({ attributes: { 'aria-haspopup': 'true', 'aria-expanded': this.toggleView.bindTemplate.to('isOn', (on: boolean) => String(!!on)) } as any });
    this.toggleView.on('execute', () => (this.isOpen = !this.isOpen));

    const bind = this.bindTemplate;
    this.setTemplate({
      tag: 'div',
      attributes: {
        class: ['ck', 'ck-ribbon__group', bind.if('isCompact', 'ck-ribbon__group_compact'), bind.if('isOpen', 'ck-ribbon__group_open')],
        role: 'group',
        'aria-labelledby': labelId
      },
      children: [
        this.toggleView,
        {
          tag: 'div',
          attributes: { class: ['ck', 'ck-ribbon__group-popup'] },
          children: [
            { tag: 'div', attributes: { class: ['ck', 'ck-ribbon__group-body'] }, children: this._blocks },
            { tag: 'div', attributes: { class: ['ck', 'ck-ribbon__group-footer'] }, children: footer }
          ]
        }
      ]
    });
  }

  public override render(): void {
    super.render();
    const element = this.element!;
    const doc = element.ownerDocument;
    // An open drop-down closes on a click elsewhere, on Esc, and after one of its buttons runs.
    const onPointerDown = (event: Event) => {
      if (this.isOpen && !element.contains(event.target as Node) && !(event.target as Element)?.closest?.('.ck-dropdown__panel, .ck-balloon-panel')) this.isOpen = false;
    };
    // Ribbon buttons leave the focus in the text, so Esc is caught for the whole page while open.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !this.isOpen) return;
      event.stopPropagation();
      event.preventDefault();
      const hadFocus = element.contains(doc.activeElement);
      this.isOpen = false;
      if (hadFocus) this.toggleView.focus();
    };
    doc.addEventListener('mousedown', onPointerDown, true);
    doc.addEventListener('keydown', onKeyDown, true);
    this._removeListeners = () => {
      doc.removeEventListener('mousedown', onPointerDown, true);
      doc.removeEventListener('keydown', onKeyDown, true);
    };
    element.querySelector('.ck-ribbon__group-popup')!.addEventListener('click', event => {
      const button = (event.target as Element).closest('.ck-button');
      // Buttons that open a menu (dropdowns, split-button arrows) keep the group open.
      if (button && !button.hasAttribute('aria-haspopup') && !button.closest('.ck-dropdown__panel')) this.isOpen = false;
    });
  }

  /** Whether any item made it into the group (unavailable components are skipped). */
  public get isEmpty(): boolean {
    return this.toolbars.every(toolbar => !toolbar.items.length);
  }

  public override destroy(): void {
    this._removeListeners();
    super.destroy();
  }

  /** Keyboard stops: each toolbar, then the launcher (a collapsed, closed group: its toggle button). */
  public get focusStops(): Array<{ element: HTMLElement | null; focus(): void }> {
    const items = [...this.toolbars, ...(this.launcherView ? [this.launcherView] : [])];
    if (!this.isCompact) return items;
    return this.isOpen ? [this.toggleView, ...items] : [this.toggleView];
  }

  public focus(): void {
    if (this.isCompact) this.toggleView.focus();
    else this.toolbars[0]?.focus();
  }
}

/** The groups of one tab. */
export class RibbonPanelView extends View {
  public readonly groups = this.createCollection<RibbonGroupView>();
  declare public isActive: boolean;

  constructor(locale: Locale | undefined, id: string, tabId: string) {
    super(locale);
    this.set('isActive', false);
    const bind = this.bindTemplate;
    this.setTemplate({
      tag: 'div',
      attributes: { class: ['ck', 'ck-ribbon__panel', bind.if('isActive', 'ck-hidden', value => !value)], role: 'tabpanel', id, 'aria-labelledby': tabId },
      children: this.groups
    });
  }
}

/** What a ribbon button is called: its tooltip without the keystroke, or its label. */
function buttonName(element: HTMLElement): string {
  const tooltip = element.getAttribute('data-cke-tooltip-text') || '';
  const label = element.querySelector('.ck-button__label')?.textContent || '';
  return (tooltip.replace(/\s*\([^)]*\)\s*$/, '') || label).trim();
}

export class RibbonView extends View {
  public readonly tabs = this.createCollection<ButtonView>();
  public readonly panels = this.createCollection<RibbonPanelView>();
  public readonly quickAccess: ToolbarView;
  public readonly collapseButton: ButtonView;
  public readonly searchView: RibbonSearchView;
  public readonly focusTracker = new FocusTracker();
  public readonly keystrokes = new KeystrokeHandler();
  declare public activeTab: number;
  declare public isCollapsed: boolean;
  declare public ariaLabel: string;
  private readonly _barChildren = this.createCollection();
  /** Context name of each tab (undefined for normal tabs). */
  private readonly _tabContexts: Array<string | undefined> = [];
  private readonly _tabGroups: RibbonGroupView[][] = [];
  private _lastNormalTab = 0;
  private _resizeObserver: ResizeObserver | null = null;

  constructor(locale?: Locale) {
    super(locale);
    const t = this.t || ((s: string) => s);
    const bind = this.bindTemplate;
    this.set('activeTab', 0);
    this.set('isCollapsed', false);
    this.set('ariaLabel', t('Editor toolbar'));

    this.quickAccess = new ToolbarView(locale);
    this.quickAccess.class = 'ck-ribbon__quick-access';
    this.quickAccess.ariaLabel = t('Quick access');

    const tabList = new View(locale);
    tabList.setTemplate({ tag: 'div', attributes: { class: ['ck', 'ck-ribbon__tabs'], role: 'tablist', 'aria-label': t('Ribbon tabs') }, children: this.tabs });

    this.collapseButton = new ButtonView(locale);
    this.collapseButton.set({ icon: icons.chevronUp, tooltip: true, class: 'ck-ribbon__collapse', keystroke: 'Ctrl+F1' });
    this.collapseButton.bind('label').to(this, 'isCollapsed', (collapsed: boolean) => (collapsed ? t('Pin the ribbon') : t('Collapse the ribbon')));
    this.collapseButton.bind('isOn').to(this, 'isCollapsed');
    this.collapseButton.on('execute', () => this.toggleCollapsed());
    this.searchView = new RibbonSearchView(locale, () => this._searchEntries());
    this._barChildren.addMany([tabList, this.searchView, this.collapseButton]);

    this.setTemplate({
      tag: 'div',
      attributes: { class: ['ck', 'ck-ribbon', bind.if('isCollapsed', 'ck-ribbon_collapsed')], role: 'toolbar', 'aria-label': bind.to('ariaLabel'), tabindex: -1 },
      children: [
        { tag: 'div', attributes: { class: ['ck', 'ck-ribbon__bar'] }, children: this._barChildren },
        { tag: 'div', attributes: { class: ['ck', 'ck-ribbon__panels'] }, children: this.panels }
      ]
    });

    this.on('change:activeTab', () => this._syncActive());
  }

  public override render(): void {
    super.render();
    this.focusTracker.add(this.element!);
    this.keystrokes.listenTo(this.element as any);
    this._setUpKeyboard();
    // Keep the ribbon one row high: refit when its width changes.
    const ResizeObserverClass = this.element!.ownerDocument.defaultView?.ResizeObserver;
    if (ResizeObserverClass) {
      let width = -1;
      this._resizeObserver = new ResizeObserverClass(entries => {
        const next = Math.round(entries[0].contentRect.width);
        if (next === width) return;
        width = next;
        this.fitGroups();
      });
      this._resizeObserver.observe(this.element!);
    }
    this.on('change:activeTab', () => this.fitGroups());
    this.on('change:isCollapsed', () => this.fitGroups());
  }

  public override destroy(): void {
    this._resizeObserver?.disconnect();
    this.focusTracker.destroy();
    this.keystrokes.destroy();
    super.destroy();
  }

  /**
   * Fits the open tab's groups into one row: when they are too wide, groups collapse to a button
   * that opens them as a drop-down (as Word does in a narrow window). The groups that free the most
   * room go first (on a tie, the one further right), so as few groups as possible collapse.
   */
  public fitGroups(): void {
    const panel = this._activePanel();
    const element = panel?.element;
    if (!panel || !element || !element.isConnected) return;
    const groups = [...panel.groups];
    const widths = () => groups.map(group => group.element!.getBoundingClientRect().width);
    element.classList.remove('ck-ribbon__panel_wrap');
    groups.forEach(group => (group.isCompact = true));
    const compact = widths();
    groups.forEach(group => (group.isCompact = false));
    const full = widths();
    let excess = element.scrollWidth - element.clientWidth;
    const candidates = groups
      .map((group, index) => ({ group, index, saving: full[index] - compact[index] }))
      .filter(candidate => candidate.saving > 0)
      .sort((a, b) => b.saving - a.saving || b.index - a.index);
    for (const candidate of candidates) {
      if (excess <= 1) break;
      candidate.group.isCompact = true;
      excess -= candidate.saving;
    }
    // Even the collapsed buttons do not fit (a phone): let them wrap.
    if (element.scrollWidth > element.clientWidth + 1) element.classList.add('ck-ribbon__panel_wrap');
  }

  /** Builds tabs and groups; items that are not available (plugin not loaded) are skipped. */
  public fillFromConfig(config: RibbonConfig, factory: ComponentFactory): void {
    if (config.quickAccess && config.quickAccess.length) {
      this.quickAccess.fillFromConfig(config.quickAccess.filter(name => name === '|' || factory.has(name)), factory);
      if (this.quickAccess.items.length) this._barChildren.add(this.quickAccess, 0);
    }
    if (config.search === false) this._barChildren.remove(this.searchView);
    for (const tab of config.tabs) {
      const groups = tab.groups.map(group => new RibbonGroupView(this.locale, group, factory)).filter(group => !group.isEmpty);
      if (!groups.length) continue;
      const index = this.tabs.length;
      const tabId = `ck-ribbon-tab-${uid()}`;
      const panelId = `ck-ribbon-panel-${uid()}`;
      const button = new ButtonView(this.locale);
      button.set({ label: tab.label, withText: true, role: 'tab', class: tab.contextual ? 'ck-ribbon__tab ck-ribbon__tab_contextual' : 'ck-ribbon__tab' });
      // Contextual tabs appear only while their context is active.
      if (tab.contextual) button.isVisible = false;
      this._tabContexts.push(tab.contextual);
      this._tabGroups.push(groups);
      button.extendTemplate({ attributes: { id: tabId, 'aria-controls': panelId, 'aria-selected': button.bindTemplate.to('isOn', (on: boolean) => String(!!on)) } as any });
      button.on('execute', () => this._onTabClick(index));
      button.on('render', () => button.element!.addEventListener('dblclick', () => this.toggleCollapsed()));
      this.tabs.add(button);

      const panel = new RibbonPanelView(this.locale, panelId, tabId);
      for (const group of groups) {
        group.on('launch', (evt, launcher) => this.fire('launch', launcher));
        panel.groups.add(group);
      }
      this.panels.add(panel);
    }
    if (config.collapsed) this.isCollapsed = true;
    this._syncActive();
  }

  /** Names of the contexts the ribbon has tabs for (e.g. `['table', 'image']`). */
  public get contexts(): string[] {
    return [...new Set(this._tabContexts.filter((context): context is string => !!context))];
  }

  /**
   * Shows or hides the contextual tabs of a context. A tab that appears is not opened by itself (as
   * in Word); when the open tab disappears, the last normal tab is opened again.
   */
  public setContextActive(context: string, isActive: boolean): void {
    this._tabContexts.forEach((tabContext, i) => {
      if (tabContext !== context) return;
      const tab = this.tabs.get(i)!;
      if (tab.isVisible === isActive) return;
      tab.isVisible = isActive;
      // On a narrow ribbon the tab row scrolls: bring the new tab into sight.
      if (isActive) this._revealTab(i);
      if (!isActive && this.activeTab === i) this.activeTab = this._lastNormalTab;
    });
  }

  public toggleCollapsed(): void {
    this.isCollapsed = !this.isCollapsed;
  }

  /** Focuses the active tab. */
  public focus(): void {
    const tab = this.tabs.get(this.activeTab);
    if (tab) tab.focus();
    else this.quickAccess.focus();
  }

  private _onTabClick(index: number): void {
    this.activeTab = index;
    if (this.isCollapsed) this.isCollapsed = false;
  }

  private _revealTab(index: number): void {
    const element = this.tabs.get(index)?.element;
    const list = element?.parentElement;
    if (!element || !list) return;
    const tabBox = element.getBoundingClientRect();
    const listBox = list.getBoundingClientRect();
    if (tabBox.right > listBox.right) list.scrollLeft += tabBox.right - listBox.right;
    else if (tabBox.left < listBox.left) list.scrollLeft -= listBox.left - tabBox.left;
  }

  /** Every button of every visible tab, for the command search. */
  private _searchEntries(): RibbonSearchEntry[] {
    const entries: RibbonSearchEntry[] = [];
    const seen = new Set<string>();
    this._tabGroups.forEach((groups, tabIndex) => {
      const tab = this.tabs.get(tabIndex)!;
      if (!tab.isVisible) return;
      for (const group of groups) {
        const buttons = [...group.toolbars.flatMap(toolbar => [...toolbar.items]), ...(group.launcherView ? [group.launcherView] : [])]
          .map(item => item.element)
          .flatMap(element => (element ? (element.matches('.ck-button') ? [element] : [...element.querySelectorAll<HTMLElement>(':scope > .ck-button, :scope > .ck-splitbutton > .ck-button')]) : []));
        for (const element of buttons) {
          const label = buttonName(element);
          const key = label.toLowerCase();
          if (!label || seen.has(key)) continue;
          seen.add(key);
          entries.push({
            label,
            path: `${tab.label} › ${group.label}`,
            isEnabled: !element.classList.contains('ck-disabled'),
            run: () => {
              this.activeTab = tabIndex;
              if (this.isCollapsed) this.isCollapsed = false;
              element.focus();
              element.click();
            }
          });
        }
      }
    });
    return entries;
  }

  private _syncActive(): void {
    if (!this._tabContexts[this.activeTab]) this._lastNormalTab = this.activeTab;
    this.tabs.forEach((tab, i) => {
      tab.isOn = i === this.activeTab;
      // Roving tab stop: only the active tab is reachable with Tab.
      tab.tabindex = i === this.activeTab ? 0 : -1;
    });
    this.panels.forEach((panel, i) => (panel.isActive = i === this.activeTab));
  }

  private _activePanel(): RibbonPanelView | null {
    return this.isCollapsed ? null : this.panels.get(this.activeTab) || null;
  }

  private _focusedTabIndex(): number {
    const active = this.element?.ownerDocument.activeElement;
    return [...this.tabs].findIndex(tab => tab.element === active);
  }

  /** Every toolbar and launcher of every group in the panel, in reading order: the Tab stops. */
  private _rows(panel: RibbonPanelView): Array<{ element: HTMLElement | null; focus(): void }> {
    return [...panel.groups].flatMap(group => group.focusStops);
  }

  private _focusedRowIndex(rows: Array<{ element: HTMLElement | null }>): number {
    const active = this.element?.ownerDocument.activeElement;
    return rows.findIndex(row => !!row.element && !!active && row.element.contains(active));
  }

  private _setUpKeyboard(): void {
    const moveTab = (step: number) => (data: unknown, cancel: () => void) => {
      const index = this._focusedTabIndex();
      if (index === -1) return;
      // Hidden contextual tabs are skipped.
      let next = index;
      do next = (next + step + this.tabs.length) % this.tabs.length;
      while (next !== index && !this.tabs.get(next)!.isVisible);
      this.activeTab = next;
      this.tabs.get(next)!.focus();
      cancel();
    };
    this.keystrokes.set('arrowright', moveTab(1));
    this.keystrokes.set('arrowleft', moveTab(-1));

    const enterPanel = (data: unknown, cancel: () => void) => {
      if (this._focusedTabIndex() === -1) return;
      if (this.isCollapsed) this.isCollapsed = false;
      const panel = this._activePanel();
      if (panel && panel.groups.first) {
        panel.groups.first.focus();
        cancel();
      }
    };
    this.keystrokes.set('arrowdown', enterPanel);

    const moveGroup = (step: number) => (data: unknown, cancel: () => void) => {
      const panel = this._activePanel();
      if (!panel) return;
      const rows = this._rows(panel);
      const index = this._focusedRowIndex(rows);
      if (index === -1) return;
      const next = index + step;
      if (next < 0) this.focus();
      else if (next >= rows.length) return;
      else rows[next].focus();
      cancel();
    };
    this.keystrokes.set('tab', moveGroup(1));
    this.keystrokes.set('shift+tab', moveGroup(-1));
  }
}
