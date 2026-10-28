import { View } from '../view';
import { ButtonView } from '../button/buttonview';
import { SplitButtonView } from '../button/splitbuttonview';
import { IconView } from '../icon/iconview';
import { ListView, ListItemView, ListSeparatorView } from '../list/listview';
import { SwitchButtonView } from '../button/switchbuttonview';
import { FocusTracker } from '../../utils/focustracker';
import { KeystrokeHandler } from '../../utils/keystrokehandler';
import { clickOutsideHandler } from '../bindings';
import { icons } from '../icons';
import { Collection } from '../../utils/collection';
import { ToolbarView } from '../toolbar/toolbarview';
import type { Locale } from '../../utils/locale';
import type { ViewCollection } from '../viewcollection';
import type { Observable } from '../../utils/observable';

export type PanelPosition = 'se' | 'sw' | 'ne' | 'nw' | 's' | 'n' | 'sme' | 'smw' | 'nme' | 'nmw' | 'auto';

/** Dropdown panel attached below (or above) a button. */
export class DropdownPanelView extends View {
  declare public isVisible: boolean;
  declare public position: PanelPosition;
  public readonly children = this.createCollection();

  constructor(locale?: Locale) {
    super(locale);
    const bind = this.bindTemplate;
    this.set('isVisible', false);
    this.set('position', 'se');
    this.setTemplate({
      tag: 'div',
      attributes: {
        class: ['ck', 'ck-reset', 'ck-dropdown__panel', bind.to('position', value => `ck-dropdown__panel_${value}`), bind.if('isVisible', 'ck-dropdown__panel-visible')],
        tabindex: '-1'
      },
      children: this.children,
      on: {
        selectstart: bind.to((evt: Event) => {
          if ((evt.target as HTMLElement).tagName.toLowerCase() === 'input') return;
          evt.preventDefault();
        })
      }
    });
  }

  public focus(): void {
    if (this.children.length) {
      const firstChild = this.children.first as any;
      if (typeof firstChild.focus === 'function') firstChild.focus();
    }
  }

  public focusLast(): void {
    if (this.children.length) {
      const lastChild = this.children.last as any;
      if (typeof lastChild.focusLast === 'function') lastChild.focusLast();
      else if (typeof lastChild.focus === 'function') lastChild.focus();
    }
  }
}

/** Button that opens a dropdown (label/icon + arrow). */
export class DropdownButtonView extends ButtonView {
  public readonly arrowView: IconView;

  constructor(locale?: Locale) {
    super(locale);
    this.arrowView = this._createArrowView();
    this.extendTemplate({
      attributes: { 'aria-haspopup': true, 'aria-expanded': this.bindTemplate.to('isOn', value => String(value)) }
    });
    this.delegate('execute').to(this, 'open');
  }

  public override render(): void {
    super.render();
    this.children.add(this.arrowView);
  }

  private _createArrowView(): IconView {
    const arrowView = new IconView();
    arrowView.content = icons.dropdownArrow;
    arrowView.extendTemplate({ attributes: { class: 'ck-dropdown__arrow' } });
    return arrowView;
  }
}

/** The dropdown: a button and a panel; opens/closes and handles outside clicks, Esc and arrows. */
export class DropdownView extends View {
  public readonly buttonView: ButtonView | SplitButtonView;
  public readonly panelView: DropdownPanelView;
  public readonly focusTracker = new FocusTracker();
  public readonly keystrokes = new KeystrokeHandler();
  public listView?: ListView;
  public toolbarView?: any;
  declare public isOpen: boolean;
  declare public isEnabled: boolean;
  declare public class: string | undefined;
  declare public id: string | undefined;
  declare public panelPosition: PanelPosition;
  declare public ariaDescribedById: string | undefined;

  constructor(locale: Locale | undefined, buttonView: ButtonView | SplitButtonView, panelView: DropdownPanelView) {
    super(locale);
    const bind = this.bindTemplate;
    this.buttonView = buttonView;
    this.panelView = panelView;
    this.set('isOpen', false);
    this.set('isEnabled', true);
    this.set('class', undefined);
    this.set('id', undefined);
    this.set('panelPosition', 'auto');
    this.set('ariaDescribedById', undefined);
    (this.panelView as any).bind('isVisible').to(this, 'isOpen');

    this.setTemplate({
      tag: 'div',
      attributes: {
        class: ['ck', 'ck-dropdown', bind.to('class'), bind.if('isEnabled', 'ck-disabled', value => !value)],
        id: bind.to('id'),
        'aria-describedby': bind.to('ariaDescribedById')
      },
      children: [buttonView, panelView]
    });

    buttonView.extendTemplate({
      attributes: {
        class: ['ck-dropdown__button'],
        'data-cke-tooltip-disabled': bind.to('isOpen')
      }
    });
  }

  public override render(): void {
    super.render();
    this.focusTracker.add(this.element!);
    this.buttonView.on('open', () => {
      this.isOpen = !this.isOpen;
    });
    this.on('change:isOpen', (evt, name, isOpen: boolean) => {
      if (!isOpen) return;
      if (this.panelPosition === 'auto') {
        this.panelView.position = this._getOptimalPosition();
      } else {
        this.panelView.position = this.panelPosition;
      }
    });

    clickOutsideHandler({
      emitter: this,
      activator: () => this.isOpen,
      callback: () => {
        this.isOpen = false;
      },
      contextElements: () => [this.element]
    });

    this.keystrokes.listenTo(this.element as any);
    const closeDropdown = (data: unknown, cancel: () => void) => {
      if (this.isOpen) {
        this.isOpen = false;
        cancel();
      }
    };
    this.keystrokes.set('arrowdown', (data, cancel) => {
      if (this.buttonView.isEnabled && !this.isOpen) {
        this.isOpen = true;
        cancel();
      }
    });
    this.keystrokes.set('arrowright', (data, cancel) => {
      if (this.isOpen) cancel();
    });
    this.keystrokes.set('arrowleft', closeDropdown);
    this.keystrokes.set('esc', closeDropdown);
    this.on('change:isOpen', (evt, name, isOpen: boolean) => {
      if (isOpen) {
        if (this.element!.ownerDocument.activeElement && this.element!.contains(this.element!.ownerDocument.activeElement)) {
          // keep button focus
        }
      } else if (this.element!.contains(this.element!.ownerDocument.activeElement)) {
        this.buttonView.focus();
      }
    });
  }

  public focus(): void {
    this.buttonView.focus();
  }

  public override destroy(): void {
    super.destroy();
    this.focusTracker.destroy();
    this.keystrokes.destroy();
  }

  private _getOptimalPosition(): PanelPosition {
    const button = this.buttonView.element!.getBoundingClientRect();
    const panel = this.panelView.element!;
    const panelWidth = panel.offsetWidth || 200;
    const panelHeight = panel.offsetHeight || 200;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const isRtl = this.locale && this.locale.uiLanguageDirection === 'rtl';
    const fitsBelow = button.bottom + panelHeight <= viewportHeight || button.top - panelHeight < 0;
    const vertical = fitsBelow ? 's' : 'n';
    let horizontal: 'e' | 'w' = isRtl ? 'w' : 'e';
    if (horizontal === 'e' && button.left + panelWidth > viewportWidth && button.right - panelWidth >= 0) horizontal = 'w';
    if (horizontal === 'w' && button.right - panelWidth < 0) horizontal = 'e';
    return `${vertical}${horizontal}` as PanelPosition;
  }
}

/** Creates a dropdown with the given button class (default: DropdownButtonView). */
export function createDropdown(locale?: Locale, ButtonClassOrInstance: (new (locale?: Locale) => ButtonView | SplitButtonView) | ButtonView | SplitButtonView = DropdownButtonView): DropdownView {
  const buttonView = typeof ButtonClassOrInstance === 'function' ? new ButtonClassOrInstance(locale) : ButtonClassOrInstance;
  const panelView = new DropdownPanelView(locale);
  const dropdownView = new DropdownView(locale, buttonView, panelView);
  buttonView.bind('isEnabled').to(dropdownView);
  if (buttonView instanceof DropdownButtonView) {
    buttonView.bind('isOn').to(dropdownView, 'isOpen');
  } else if (buttonView instanceof SplitButtonView) {
    buttonView.arrowView.bind('isOn').to(dropdownView, 'isOpen');
  } else {
    (buttonView as ButtonView).bind('isOn').to(dropdownView, 'isOpen');
  }
  // Close on execute from inside the panel.
  dropdownView.on('execute', (evt: any) => {
    if (evt.source instanceof SplitButtonView) return;
    dropdownView.isOpen = false;
  });
  // Focus the panel on open (via keyboard).
  dropdownView.on('change:isOpen', (evt, name, isOpen: boolean) => {
    if (!isOpen) return;
    if (dropdownView.listView) {
      (dropdownView.listView as any).focus();
    } else if (dropdownView.toolbarView) {
      // Keep focus on the button for toolbar dropdowns opened with the mouse.
    } else {
      dropdownView.panelView.focus();
    }
  });
  return dropdownView;
}

export interface ListDropdownItemDefinition {
  type: 'button' | 'switchbutton' | 'separator';
  model?: Observable & { label?: string; withText?: boolean; isOn?: boolean; isEnabled?: boolean; class?: string; icon?: string; role?: string; [key: string]: unknown };
}

/** Adds a list of buttons to the dropdown panel. */
export function addListToDropdown(dropdownView: DropdownView, itemsOrCallback: Collection<ListDropdownItemDefinition> | (() => Collection<ListDropdownItemDefinition>), options: { ariaLabel?: string; role?: string } = {}): void {
  const build = () => {
    const items = typeof itemsOrCallback === 'function' ? itemsOrCallback() : itemsOrCallback;
    const listView = new ListView(dropdownView.locale);
    dropdownView.listView = listView;
    listView.ariaLabel = options.ariaLabel;
    listView.role = options.role;
    const addItem = (definition: ListDropdownItemDefinition, index?: number) => {
      let itemView: View;
      if (definition.type === 'separator') {
        itemView = new ListSeparatorView(dropdownView.locale);
      } else {
        const listItemView = new ListItemView(dropdownView.locale);
        const ButtonClass = definition.type === 'switchbutton' ? SwitchButtonView : ButtonView;
        const buttonView = new ButtonClass(dropdownView.locale);
        buttonView.bind('label', 'withText', 'isOn', 'isEnabled', 'class', 'icon', 'role', 'tooltip', 'withKeystroke', 'keystroke').to(definition.model as any);
        buttonView.delegate('execute').to(listItemView);
        listItemView.children.add(buttonView);
        listItemView.bind('isVisible').to(definition.model as any, 'isVisible', (v: unknown) => v !== false);
        itemView = listItemView;
      }
      listView.items.add(itemView, index);
    };
    for (const definition of items) addItem(definition);
    items.on('change', (evt, data: any) => {
      for (const removed of data.removed) {
        const index = items.getIndex(removed);
        void index;
      }
      listView.items.clear();
      for (const definition of items) addItem(definition);
    });
    listView.items.delegate('execute').to(dropdownView);
    dropdownView.panelView.children.add(listView);
    listView.items.on('add', () => undefined);
  };
  if (typeof itemsOrCallback === 'function') {
    dropdownView.once('change:isOpen', build);
  } else {
    build();
  }
}

/** Adds a toolbar (buttons) to the dropdown panel. */
export function addToolbarToDropdown(dropdownView: DropdownView, buttonsOrCallback: ViewCollection | View[] | (() => View[] | ViewCollection), options: { enableActiveItemFocusOnDropdownOpen?: boolean; isVertical?: boolean; ariaLabel?: string; maxWidth?: string; class?: string; isCompact?: boolean } = {}): void {
  const build = () => {
    const toolbarView = new ToolbarView(dropdownView.locale);
    dropdownView.toolbarView = toolbarView;
    toolbarView.set({ isVertical: !!options.isVertical, isCompact: !!options.isCompact });
    if (options.ariaLabel) toolbarView.ariaLabel = options.ariaLabel;
    if (options.maxWidth) toolbarView.maxWidth = options.maxWidth;
    if (options.class) toolbarView.class = options.class;
    const buttons = typeof buttonsOrCallback === 'function' ? buttonsOrCallback() : buttonsOrCallback;
    if (buttons instanceof Collection) {
      for (const button of buttons) toolbarView.items.add(button);
      buttons.on('add', (evt: any, item: View, index: number) => toolbarView.items.add(item, index));
      buttons.on('remove', (evt: any, item: View) => toolbarView.items.remove(item));
    } else {
      toolbarView.items.addMany(buttons as View[]);
    }
    toolbarView.items.delegate('execute').to(dropdownView);
    dropdownView.panelView.children.add(toolbarView);
    dropdownView.extendTemplate({ attributes: { class: ['ck-toolbar-dropdown'] } });
  };
  if (typeof buttonsOrCallback === 'function') {
    dropdownView.once('change:isOpen', build);
  } else {
    build();
  }
}

