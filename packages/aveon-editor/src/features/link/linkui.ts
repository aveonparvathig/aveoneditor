import { Plugin } from '../../core/plugin';
import { View } from '../../ui/view';
import { ButtonView } from '../../ui/button/buttonview';
import { SwitchButtonView } from '../../ui/button/switchbuttonview';
import { LabeledFieldView, createLabeledInputText } from '../../ui/labeledfield/labeledfieldview';
import { ContextualBalloon } from '../../ui/panel/contextualballoon';
import { FocusTracker } from '../../utils/focustracker';
import { KeystrokeHandler } from '../../utils/keystrokehandler';
import { FocusCycler } from '../../ui/focuscycler';
import { clickOutsideHandler, submitHandler } from '../../ui/bindings';
import { icons } from '../../ui/icons';
import { LinkEditing, type LinkCommand, type ManualDecorator } from './linkediting';
import { isLinkElement, LINK_KEYSTROKE, addLinkProtocolIfApplicable, ensureSafeUrl, openLink } from './utils';
import { keyCodes } from '../../utils/keyboard';
import type { Locale } from '../../utils/locale';
import type { Editor } from '../../core/editor';
import type { Element as ViewElement } from '../../engine/view/element';
import type { InputTextView } from '../../ui/input/inputtextview';

const VISUAL_SELECTION_MARKER_NAME = 'link-ui';

/** The link form: URL input, manual decorator switches, Save/Cancel. */
export class LinkFormView extends View {
  public readonly focusTracker = new FocusTracker();
  public readonly keystrokes = new KeystrokeHandler();
  public readonly urlInputView: LabeledFieldView<InputTextView>;
  public readonly saveButtonView: ButtonView;
  public readonly cancelButtonView: ButtonView;
  public readonly children = this.createCollection();
  private readonly _manualDecoratorSwitches: any;
  private readonly _focusables = this.createCollection();
  private readonly _focusCycler: FocusCycler;

  constructor(locale: Locale, linkCommand: LinkCommand) {
    super(locale);
    const t = locale.t;
    this.urlInputView = this._createUrlInput();
    this.saveButtonView = this._createButton(t('Save'), icons.check, 'ck-button-save');
    this.saveButtonView.type = 'submit';
    this.cancelButtonView = this._createButton(t('Cancel'), icons.cancel, 'ck-button-cancel', 'cancel');
    this._manualDecoratorSwitches = this._createManualDecoratorSwitches(linkCommand);
    this.children = this._createFormChildren(linkCommand.manualDecorators);
    this._focusCycler = new FocusCycler({
      focusables: this._focusables,
      focusTracker: this.focusTracker,
      keystrokeHandler: this.keystrokes,
      actions: { focusPrevious: 'shift + tab', focusNext: 'tab' }
    });
    const classList = ['ck', 'ck-link-form', 'ck-responsive-form'];
    if (linkCommand.manualDecorators.length) {
      classList.push('ck-link-form_layout-vertical', 'ck-vertical-form');
    }
    this.setTemplate({
      tag: 'form',
      attributes: { class: classList, tabindex: '-1' },
      children: this.children
    });
  }

  public getDecoratorSwitchesState(): Record<string, boolean> {
    return Array.from(this._manualDecoratorSwitches as Iterable<any>).reduce((accumulator: Record<string, boolean>, switchButton: any) => {
      accumulator[switchButton.name] = switchButton.isOn;
      return accumulator;
    }, {});
  }

  public override render(): void {
    super.render();
    submitHandler({ view: this });
    const childViews = [this.urlInputView, ...Array.from(this._manualDecoratorSwitches as Iterable<View>), this.saveButtonView, this.cancelButtonView];
    childViews.forEach(v => {
      this._focusables.add(v);
      this.focusTracker.add(v.element!);
    });
    this.keystrokes.listenTo(this.element as any);
  }

  public override destroy(): void {
    super.destroy();
    this.focusTracker.destroy();
    this.keystrokes.destroy();
  }

  public focus(): void {
    this._focusCycler.focusFirst();
  }

  private _createUrlInput(): LabeledFieldView<InputTextView> {
    const t = this.locale!.t;
    const labeledInput = new LabeledFieldView(this.locale, createLabeledInputText);
    labeledInput.label = t('Link URL');
    return labeledInput;
  }

  private _createButton(label: string, icon: string, className: string, eventName?: string): ButtonView {
    const button = new ButtonView(this.locale);
    button.set({ label, icon, tooltip: true });
    button.extendTemplate({ attributes: { class: className } });
    if (eventName) button.delegate('execute').to(this, eventName);
    return button;
  }

  private _createManualDecoratorSwitches(linkCommand: LinkCommand): any {
    const switches = this.createCollection();
    for (const manualDecorator of linkCommand.manualDecorators) {
      const switchButton = new SwitchButtonView(this.locale) as SwitchButtonView & { name: string };
      switchButton.set({ name: manualDecorator.id, label: manualDecorator.label, withText: true } as any);
      switchButton.bind('isOn').toMany([manualDecorator, linkCommand], 'value', (decoratorValue: boolean | undefined, commandValue: unknown) => {
        return commandValue === undefined && decoratorValue === undefined ? !!manualDecorator.defaultValue : !!decoratorValue;
      });
      switchButton.on('execute', () => {
        manualDecorator.set('value', !switchButton.isOn);
      });
      switches.add(switchButton);
    }
    return switches;
  }

  private _createFormChildren(manualDecorators: Iterable<ManualDecorator>): any {
    const children = this.createCollection();
    children.add(this.urlInputView);
    if (Array.from(manualDecorators).length) {
      const additionalButtonsView = new View();
      additionalButtonsView.setTemplate({
        tag: 'ul',
        children: Array.from(this._manualDecoratorSwitches as Iterable<View>).map(switchButton => ({ tag: 'li', children: [switchButton], attributes: { class: ['ck', 'ck-list__item'] } })),
        attributes: { class: ['ck', 'ck-reset', 'ck-list'] }
      });
      children.add(additionalButtonsView);
    }
    children.add(this.saveButtonView);
    children.add(this.cancelButtonView);
    return children;
  }
}

/** The link actions: preview, edit, unlink. */
export class LinkActionsView extends View {
  public readonly focusTracker = new FocusTracker();
  public readonly keystrokes = new KeystrokeHandler();
  public readonly previewButtonView: ButtonView;
  public readonly unlinkButtonView: ButtonView;
  public readonly editButtonView: ButtonView;
  declare public href: string | undefined;
  private readonly _focusables = this.createCollection();
  private readonly _focusCycler: FocusCycler;

  constructor(locale: Locale) {
    super(locale);
    const t = locale.t;
    this.previewButtonView = this._createPreviewButton();
    this.unlinkButtonView = this._createButton(t('Unlink'), icons.unlink, 'unlink');
    this.editButtonView = this._createButton(t('Edit link'), icons.pencil, 'edit');
    this.set('href', undefined);
    this._focusCycler = new FocusCycler({
      focusables: this._focusables,
      focusTracker: this.focusTracker,
      keystrokeHandler: this.keystrokes,
      actions: { focusPrevious: 'shift + tab', focusNext: 'tab' }
    });
    this.setTemplate({
      tag: 'div',
      attributes: { class: ['ck', 'ck-link-actions', 'ck-responsive-form'], tabindex: '-1' },
      children: [this.previewButtonView, this.editButtonView, this.unlinkButtonView]
    });
  }

  public override render(): void {
    super.render();
    const childViews = [this.previewButtonView, this.editButtonView, this.unlinkButtonView];
    childViews.forEach(v => {
      this._focusables.add(v);
      this.focusTracker.add(v.element!);
    });
    this.keystrokes.listenTo(this.element as any);
  }

  public override destroy(): void {
    super.destroy();
    this.focusTracker.destroy();
    this.keystrokes.destroy();
  }

  public focus(): void {
    this._focusCycler.focusFirst();
  }

  private _createButton(label: string, icon: string, eventName: string): ButtonView {
    const button = new ButtonView(this.locale);
    button.set({ label, icon, tooltip: true });
    button.delegate('execute').to(this, eventName);
    return button;
  }

  private _createPreviewButton(): ButtonView {
    const button = new ButtonView(this.locale);
    const bind = this.bindTemplate;
    const t = this.t!;
    button.set({ withText: true, tooltip: t('Open link in new tab') });
    button.extendTemplate({
      attributes: {
        class: ['ck', 'ck-link-actions__preview'],
        href: bind.to('href', (href: string) => href && ensureSafeUrl(href)),
        target: '_blank',
        rel: 'noopener noreferrer'
      }
    });
    button.bind('label').to(this, 'href', (href: string) => href || t('This link has no URL'));
    button.bind('isEnabled').to(this, 'href', (href: string) => !!href);
    button.template!.tag = 'a';
    button.on('execute', () => {
      if (this.href) openLink(this.href);
    });
    return button;
  }
}

/** Link UI: toolbar button, balloon form and actions. */
export class LinkUI extends Plugin {
  public actionsView: LinkActionsView | null = null;
  public formView: LinkFormView | null = null;
  private _balloon!: ContextualBalloon;

  public static override get requires() {
    return [ContextualBalloon, LinkEditing];
  }

  public static override get pluginName(): string {
    return 'LinkUI';
  }

  public override init(): void {
    const editor = this.editor;
    editor.editing.view.addObserver(ClickObserverRef());
    this._balloon = editor.plugins.get(ContextualBalloon) as ContextualBalloon;
    this._createToolbarLinkButton();
    this._enableBalloonActivators();
    editor.conversion.for('editingDowncast').markerToHighlight({ model: VISUAL_SELECTION_MARKER_NAME, view: { classes: ['ck-fake-link-selection'] } });
    editor.conversion.for('editingDowncast').markerToElement({
      model: VISUAL_SELECTION_MARKER_NAME,
      view: { name: 'span', classes: ['ck-fake-link-selection', 'ck-fake-link-selection_collapsed'] }
    });
  }

  public override destroy(): void {
    super.destroy();
    if (this.formView) this.formView.destroy();
    if (this.actionsView) this.actionsView.destroy();
  }

  private _createViews(): void {
    this.actionsView = this._createActionsView();
    this.formView = this._createFormView();
    this._enableUserBalloonInteractions();
  }

  private _createActionsView(): LinkActionsView {
    const editor = this.editor;
    const actionsView = new LinkActionsView(editor.locale);
    const linkCommand = editor.commands.get('link') as LinkCommand;
    const unlinkCommand = editor.commands.get('unlink')!;
    actionsView.bind('href').to(linkCommand, 'value');
    actionsView.editButtonView.bind('isEnabled').to(linkCommand);
    actionsView.unlinkButtonView.bind('isEnabled').to(unlinkCommand);
    this.listenTo(actionsView, 'edit', () => this._addFormView());
    this.listenTo(actionsView, 'unlink', () => {
      editor.execute('unlink');
      this._hideUI();
    });
    actionsView.keystrokes.set('Esc', (data, cancel) => {
      this._hideUI();
      cancel();
    });
    actionsView.keystrokes.set(LINK_KEYSTROKE, (data, cancel) => {
      this._addFormView();
      cancel();
    });
    return actionsView;
  }

  private _createFormView(): LinkFormView {
    const editor = this.editor;
    const linkCommand = editor.commands.get('link') as LinkCommand;
    const defaultProtocol = editor.config.get('link.defaultProtocol') as string | undefined;
    const formView = new LinkFormView(editor.locale, linkCommand);
    formView.urlInputView.fieldView.bind('value').to(linkCommand, 'value');
    formView.urlInputView.bind('isEnabled').to(linkCommand, 'isEnabled');
    formView.saveButtonView.bind('isEnabled').to(linkCommand);
    this.listenTo(formView, 'submit', () => {
      const { value } = formView.urlInputView.fieldView.element!;
      const parsedUrl = addLinkProtocolIfApplicable(value, defaultProtocol);
      editor.execute('link', parsedUrl, formView.getDecoratorSwitchesState());
      this._closeFormView();
    });
    this.listenTo(formView, 'cancel', () => this._closeFormView());
    formView.keystrokes.set('Esc', (data, cancel) => {
      this._closeFormView();
      cancel();
    });
    return formView;
  }

  private _createToolbarLinkButton(): void {
    const editor = this.editor;
    const linkCommand = editor.commands.get('link')!;
    const t = editor.t;
    editor.keystrokes.set(LINK_KEYSTROKE, (keyEvtData, cancel) => {
      cancel();
      if (linkCommand.isEnabled) this._showUI(true);
    });
    editor.ui.componentFactory.add('link', locale => {
      const button = new ButtonView(locale);
      button.isEnabled = true;
      button.label = t('Link');
      button.icon = icons.link;
      button.keystroke = LINK_KEYSTROKE;
      button.tooltip = true;
      button.isToggleable = true;
      button.bind('isEnabled').to(linkCommand, 'isEnabled');
      button.bind('isOn').to(linkCommand, 'value', (value: unknown) => !!value);
      this.listenTo(button, 'execute', () => this._showUI(true));
      return button;
    });
  }

  private _enableBalloonActivators(): void {
    const editor = this.editor;
    const viewDocument = editor.editing.view.document;
    this.listenTo(viewDocument, 'click', () => {
      const parentLink = this._getSelectedLinkElement();
      if (parentLink) {
        this._showUI();
      }
    });
  }

  private _enableUserBalloonInteractions(): void {
    this.listenTo(this.editor.editing.view.document, 'selectionChange', () => {
      if (this._isUIVisible) {
        // Keep the UI in sync while the caret is inside the link; hide when leaving.
        setTimeout(() => {
          if (!this._getSelectedLinkElement() && this._areActionsVisible) this._hideUI();
        }, 0);
      }
    });
    this.editor.keystrokes.set('Esc', (data, cancel) => {
      if (this._isUIVisible) {
        this._hideUI();
        cancel();
      }
    });
    clickOutsideHandler({
      emitter: this.formView!,
      activator: () => this._isUIInPanel,
      contextElements: () => [this._balloon.view.element],
      callback: () => this._hideUI()
    });
  }

  private _addActionsView(): void {
    if (!this.actionsView) this._createViews();
    if (this._areActionsInPanel) return;
    this._balloon.add({ view: this.actionsView!, position: this._getBalloonPositionData() });
  }

  private _addFormView(): void {
    if (!this.formView) this._createViews();
    if (this._isFormInPanel) return;
    const editor = this.editor;
    const linkCommand = editor.commands.get('link') as LinkCommand;
    this.formView!.disableCssTransitions?.();
    this._balloon.add({ view: this.formView!, position: this._getBalloonPositionData() });
    if (this._balloon.visibleView === this.formView) {
      this.formView!.urlInputView.fieldView.select();
    }
    this.formView!.urlInputView.fieldView.value = (linkCommand.value as string) || '';
  }

  private _closeFormView(): void {
    const linkCommand = this.editor.commands.get('link') as LinkCommand;
    linkCommand.restoreManualDecoratorStates();
    if (linkCommand.value !== undefined) {
      this._removeFormView();
    } else {
      this._hideUI();
    }
  }

  private _removeFormView(): void {
    if (this._isFormInPanel) {
      this.formView!.saveButtonView.focus();
      this.formView!.urlInputView.fieldView.reset();
      this._balloon.remove(this.formView!);
      this.editor.editing.view.focus();
      this._hideFakeVisualSelection();
    }
  }

  private _showUI(forceVisible = false): void {
    if (!this.formView) this._createViews();
    if (!this._getSelectedLinkElement()) {
      this._showFakeVisualSelection();
      this._addActionsView();
      if (forceVisible) this._balloon.showStack('main');
      this._addFormView();
    } else {
      if (this._areActionsVisible) {
        this._addFormView();
      } else {
        this._addActionsView();
      }
      if (forceVisible) this._balloon.showStack('main');
    }
    this._startUpdatingUI();
  }

  private _hideUI(): void {
    if (!this._isUIInPanel) return;
    const editor = this.editor;
    this.stopListening(editor.ui, 'update');
    this.stopListening(this._balloon, 'change:visibleView');
    editor.editing.view.focus();
    this._removeFormView();
    if (this._areActionsInPanel) {
      this._balloon.remove(this.actionsView!);
    }
    this._hideFakeVisualSelection();
  }

  private _startUpdatingUI(): void {
    const editor = this.editor;
    const viewDocument = editor.editing.view.document;
    let prevSelectedLink = this._getSelectedLinkElement();
    let prevSelectionParent = getSelectionParent();
    const update = () => {
      const selectedLink = this._getSelectedLinkElement();
      const selectionParent = getSelectionParent();
      if ((prevSelectedLink && !selectedLink) || (!prevSelectedLink && selectionParent !== prevSelectionParent)) {
        this._hideUI();
      } else if (this._isUIVisible) {
        this._balloon.updatePosition(this._getBalloonPositionData());
      }
      prevSelectedLink = selectedLink;
      prevSelectionParent = selectionParent;
    };
    function getSelectionParent() {
      return viewDocument.selection.focus!.getAncestors().reverse().find((node: any) => node.is('element'));
    }
    this.listenTo(editor.ui, 'update', update);
    this.listenTo(this._balloon, 'change:visibleView', update);
  }

  private get _isFormInPanel(): boolean {
    return !!this.formView && this._balloon.hasView(this.formView);
  }

  private get _areActionsInPanel(): boolean {
    return !!this.actionsView && this._balloon.hasView(this.actionsView);
  }

  private get _areActionsVisible(): boolean {
    return !!this.actionsView && this._balloon.visibleView === this.actionsView;
  }

  private get _isUIInPanel(): boolean {
    return this._isFormInPanel || this._areActionsInPanel;
  }

  private get _isUIVisible(): boolean {
    const visibleView = this._balloon.visibleView;
    return !!this.formView && (visibleView === this.formView || this._areActionsVisible);
  }

  private _getBalloonPositionData(): any {
    const view = this.editor.editing.view;
    const model = this.editor.model;
    const viewDocument = view.document;
    let target: any = null;
    if (model.markers.has(VISUAL_SELECTION_MARKER_NAME)) {
      const markerViewElements = Array.from(this.editor.editing.mapper.markerNameToElements(VISUAL_SELECTION_MARKER_NAME) || []);
      const newRange = view.createRange(view.createPositionBefore(markerViewElements[0]), view.createPositionAfter(markerViewElements[markerViewElements.length - 1]));
      target = view.domConverter.viewRangeToDom(newRange);
    } else {
      target = () => {
        const targetLink = this._getSelectedLinkElement();
        return targetLink ? view.domConverter.mapViewToDom(targetLink) : view.domConverter.viewRangeToDom(viewDocument.selection.getFirstRange()!);
      };
    }
    return { target };
  }

  private _getSelectedLinkElement(): ViewElement | null {
    const view = this.editor.editing.view;
    const selection = view.document.selection;
    const selectedElement = selection.getSelectedElement();
    if (selection.isCollapsed || (selectedElement && (selectedElement as any).getCustomProperty('widget'))) {
      return findLinkElementAncestor(selection.getFirstPosition()!);
    }
    const range = selection.getFirstRange()!.getTrimmed();
    const startLink = findLinkElementAncestor(range.start);
    const endLink = findLinkElementAncestor(range.end);
    if (!startLink || startLink !== endLink) return null;
    if (view.createRangeIn(startLink).getTrimmed().isEqual(range)) {
      return startLink;
    }
    return null;
  }

  private _showFakeVisualSelection(): void {
    const model = this.editor.model;
    model.change(writer => {
      const range = model.document.selection.getFirstRange()!;
      if (model.markers.has(VISUAL_SELECTION_MARKER_NAME)) {
        writer.updateMarker(VISUAL_SELECTION_MARKER_NAME, { range });
      } else if (range.start.isAtEnd) {
        const startPosition = range.start.getLastMatchingPosition(({ item }) => !model.schema.isContent(item as any), { boundaries: range });
        writer.addMarker(VISUAL_SELECTION_MARKER_NAME, { usingOperation: false, affectsData: false, range: writer.createRange(startPosition, range.end) });
      } else {
        writer.addMarker(VISUAL_SELECTION_MARKER_NAME, { usingOperation: false, affectsData: false, range });
      }
    });
  }

  private _hideFakeVisualSelection(): void {
    const model = this.editor.model;
    if (model.markers.has(VISUAL_SELECTION_MARKER_NAME)) {
      model.change(writer => {
        writer.removeMarker(VISUAL_SELECTION_MARKER_NAME);
      });
    }
  }
}

function findLinkElementAncestor(position: any): ViewElement | null {
  return position.getAncestors().find((ancestor: any) => isLinkElement(ancestor)) || null;
}

import { DomEventObserver } from '../../engine/view/observer/domeventobserver';
class ClickObserver extends DomEventObserver<MouseEvent> {
  public readonly domEventType = 'click';
  public onDomEvent(domEvent: MouseEvent): void {
    this.fire(domEvent.type, domEvent);
  }
}
function ClickObserverRef(): typeof ClickObserver {
  return ClickObserver;
}

export { ClickObserver, keyCodes };
export type { Editor };

declare module '../../ui/view' {
  interface View {
    disableCssTransitions?(): void;
    enableCssTransitions?(): void;
  }
}
