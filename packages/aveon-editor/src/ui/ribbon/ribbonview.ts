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
import { FocusTracker } from '../../utils/focustracker';
import { KeystrokeHandler } from '../../utils/keystrokehandler';
import { icons } from '../icons';
import { uid } from '../../utils/uid';
import type { Locale } from '../../utils/locale';
import type { ComponentFactory } from '../../core/componentfactory';

export interface RibbonGroupConfig {
  label: string;
  /** Toolbar item names; `-` starts a new row and `|` adds a separator. */
  items: string[];
}

export interface RibbonTabConfig {
  label: string;
  groups: RibbonGroupConfig[];
}

export interface RibbonConfig {
  tabs: RibbonTabConfig[];
  /** Items always visible at the start of the tab row (e.g. undo and redo). */
  quickAccess?: string[];
  /** Start with only the tab row visible. */
  collapsed?: boolean;
}

/**
 * One labelled group (e.g. "Font") inside a ribbon tab. Each row is its own toolbar, so the group is
 * only as wide as its widest row.
 */
export class RibbonGroupView extends View {
  public readonly rows = this.createCollection<ToolbarView>();

  constructor(locale: Locale | undefined, label: string, items: string[], factory: ComponentFactory) {
    super(locale);
    const rowItems: string[][] = [[]];
    for (const item of items) {
      if (item === '-') rowItems.push([]);
      else rowItems[rowItems.length - 1].push(item);
    }
    for (const row of rowItems.filter(r => r.some(item => item !== '|'))) {
      const toolbar = new ToolbarView(locale);
      toolbar.ariaLabel = label;
      toolbar.class = 'ck-ribbon__group-row';
      toolbar.fillFromConfig(row, factory);
      this.rows.add(toolbar);
    }
    const labelId = `ck-ribbon-group-${uid()}`;
    this.setTemplate({
      tag: 'div',
      attributes: { class: ['ck', 'ck-ribbon__group'], role: 'group', 'aria-labelledby': labelId },
      children: [
        { tag: 'div', attributes: { class: ['ck', 'ck-ribbon__group-rows'] }, children: this.rows },
        { tag: 'span', attributes: { class: ['ck', 'ck-ribbon__group-label'], id: labelId }, children: [label] }
      ]
    });
  }

  public focus(): void {
    this.rows.first?.focus();
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

export class RibbonView extends View {
  public readonly tabs = this.createCollection<ButtonView>();
  public readonly panels = this.createCollection<RibbonPanelView>();
  public readonly quickAccess: ToolbarView;
  public readonly collapseButton: ButtonView;
  public readonly focusTracker = new FocusTracker();
  public readonly keystrokes = new KeystrokeHandler();
  declare public activeTab: number;
  declare public isCollapsed: boolean;
  declare public ariaLabel: string;
  private readonly _barChildren = this.createCollection();

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
    this._barChildren.addMany([tabList, this.collapseButton]);

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
  }

  public override destroy(): void {
    this.focusTracker.destroy();
    this.keystrokes.destroy();
    super.destroy();
  }

  /** Builds tabs and groups; items that are not available (plugin not loaded) are skipped. */
  public fillFromConfig(config: RibbonConfig, factory: ComponentFactory): void {
    if (config.quickAccess && config.quickAccess.length) {
      this.quickAccess.fillFromConfig(config.quickAccess.filter(name => name === '|' || factory.has(name)), factory);
      if (this.quickAccess.items.length) this._barChildren.add(this.quickAccess, 0);
    }
    for (const tab of config.tabs) {
      const groups = tab.groups
        .map(group => ({ ...group, items: group.items.filter(name => name === '|' || name === '-' || factory.has(name)) }))
        .filter(group => group.items.some(name => name !== '|' && name !== '-'));
      if (!groups.length) continue;
      const index = this.tabs.length;
      const tabId = `ck-ribbon-tab-${uid()}`;
      const panelId = `ck-ribbon-panel-${uid()}`;
      const button = new ButtonView(this.locale);
      button.set({ label: tab.label, withText: true, role: 'tab', class: 'ck-ribbon__tab' });
      button.extendTemplate({ attributes: { id: tabId, 'aria-controls': panelId, 'aria-selected': button.bindTemplate.to('isOn', (on: boolean) => String(!!on)) } as any });
      button.on('execute', () => this._onTabClick(index));
      button.on('render', () => button.element!.addEventListener('dblclick', () => this.toggleCollapsed()));
      this.tabs.add(button);

      const panel = new RibbonPanelView(this.locale, panelId, tabId);
      for (const group of groups) {
        panel.groups.add(new RibbonGroupView(this.locale, group.label, group.items, factory));
      }
      this.panels.add(panel);
    }
    if (config.collapsed) this.isCollapsed = true;
    this._syncActive();
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

  private _syncActive(): void {
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

  /** Every row of every group in the panel, in reading order: the Tab stops. */
  private _rows(panel: RibbonPanelView): ToolbarView[] {
    return [...panel.groups].flatMap(group => [...group.rows]);
  }

  private _focusedRowIndex(rows: ToolbarView[]): number {
    const active = this.element?.ownerDocument.activeElement;
    return rows.findIndex(row => !!row.element && !!active && row.element.contains(active));
  }

  private _setUpKeyboard(): void {
    const moveTab = (step: number) => (data: unknown, cancel: () => void) => {
      const index = this._focusedTabIndex();
      if (index === -1) return;
      const next = (index + step + this.tabs.length) % this.tabs.length;
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
