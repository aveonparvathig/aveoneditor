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
import { getEnvKeystrokeText } from '../../utils/keyboard';
import type { Locale } from '../../utils/locale';
import type { ComponentFactory } from '../../core/componentfactory';

export type RibbonItemSize = 'large' | 'medium' | 'small';

/**
 * A ribbon item: a component name (small, icon-only button) or an object giving its size and an
 * optional short label. Large items show a big icon above the label (the group's main action);
 * medium items show a small icon beside the label, stacked up to three high.
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
}

export interface RibbonConfig {
  tabs: RibbonTabConfig[];
  /** Items always visible at the start of the tab row (e.g. undo and redo). */
  quickAccess?: string[];
  /** Start with only the tab row visible. */
  collapsed?: boolean;
}

function itemName(item: RibbonItem): string {
  return typeof item === 'string' ? item : item.name;
}

/** Makes a component show its label (and use a short one), keeping the full name in its tooltip. */
function applyItemSize(view: View, size: RibbonItemSize, label?: string): void {
  const anyView = view as any;
  // Dropdowns carry their button in `buttonView`; split buttons also have an `actionView`.
  const host: any = anyView.buttonView || anyView;
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
  private readonly _blocks = this.createCollection();

  constructor(locale: Locale | undefined, config: RibbonGroupConfig, factory: ComponentFactory) {
    super(locale);
    const label = config.label;
    const newToolbar = (className: string) => {
      const toolbar = new ToolbarView(locale);
      toolbar.ariaLabel = label;
      toolbar.class = className;
      this.toolbars.push(toolbar);
      return toolbar;
    };

    let medium: ToolbarView | null = null;
    let smallRows: string[][] | null = null;
    const flushSmall = () => {
      if (!smallRows) return;
      const rows = smallRows.map(row => row.filter(name => name === '|' || factory.has(name))).filter(row => row.some(name => name !== '|'));
      smallRows = null;
      if (!rows.length) return;
      const block = new View(locale);
      const rowViews = block.createCollection();
      for (const row of rows) {
        const toolbar = newToolbar('ck-ribbon__group-row');
        toolbar.fillFromConfig(row, factory);
        rowViews.add(toolbar);
      }
      block.setTemplate({ tag: 'div', attributes: { class: ['ck', 'ck-ribbon__block', 'ck-ribbon__block_small'] }, children: rowViews });
      this._blocks.add(block);
    };

    for (const item of config.items) {
      const size: RibbonItemSize = typeof item === 'string' ? 'small' : item.size || 'small';
      const name = itemName(item);
      if (size === 'small') {
        medium = null;
        if (!smallRows) smallRows = [[]];
        if (name === '-') smallRows.push([]);
        else smallRows[smallRows.length - 1].push(name);
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
    this.setTemplate({
      tag: 'div',
      attributes: { class: ['ck', 'ck-ribbon__group'], role: 'group', 'aria-labelledby': labelId },
      children: [
        { tag: 'div', attributes: { class: ['ck', 'ck-ribbon__group-body'] }, children: this._blocks },
        { tag: 'div', attributes: { class: ['ck', 'ck-ribbon__group-footer'] }, children: footer }
      ]
    });
  }

  /** Whether any item made it into the group (unavailable components are skipped). */
  public get isEmpty(): boolean {
    return this.toolbars.every(toolbar => !toolbar.items.length);
  }

  /** Keyboard stops: each toolbar, then the launcher. */
  public get focusStops(): Array<{ element: HTMLElement | null; focus(): void }> {
    return [...this.toolbars, ...(this.launcherView ? [this.launcherView] : [])];
  }

  public focus(): void {
    this.toolbars[0]?.focus();
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
      const groups = tab.groups.map(group => new RibbonGroupView(this.locale, group, factory)).filter(group => !group.isEmpty);
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
        group.on('launch', (evt, launcher) => this.fire('launch', launcher));
        panel.groups.add(group);
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
