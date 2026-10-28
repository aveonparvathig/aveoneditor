import { Plugin } from '../../core/plugin';
import { BalloonPanelView, type PinOptions } from './balloonpanelview';
import { ButtonView } from '../button/buttonview';
import { View } from '../view';
import { icons } from '../icons';
import type { Editor } from '../../core/editor';
import type { Rect } from '../../utils/dom';

export interface ContextualBalloonViewConfig {
  view: View;
  stackId?: string;
  position?: PinOptions;
  balloonClassName?: string;
  withArrow?: boolean;
  singleViewMode?: boolean;
}

/**
 * Shared balloon panel that features (link, image toolbar, table toolbar) stack their views in.
 */
export class ContextualBalloon extends Plugin {
  public readonly view: BalloonPanelView;
  public positionLimiter: PinOptions['limiter'];
  declare public visibleView: View | null;
  private _viewToStack = new Map<View, Map<View, ContextualBalloonViewConfig>>();
  private _idToStack = new Map<string, Map<View, ContextualBalloonViewConfig>>();
  private _rotatorView: RotatorView | null = null;
  private _fakePanelsView: View | null = null;
  declare public _numberOfStacks: number;
  declare public _singleViewMode: boolean;

  public static override get pluginName(): string {
    return 'ContextualBalloon';
  }

  constructor(editor: Editor) {
    super(editor);
    this.positionLimiter = () => {
      const view = this.editor.editing.view;
      const viewDocument = view.document;
      const editableElement = viewDocument.selection.editableElement;
      if (editableElement) {
        return view.domConverter.mapViewToDom(editableElement.root as any) as HTMLElement;
      }
      return null;
    };
    this.set('visibleView', null);
    this.view = new BalloonPanelView(editor.locale);
    editor.ui.view.body.add(this.view);
    editor.ui.focusTracker.add(this.view.element!);
    this.set('_numberOfStacks', 0);
    this.set('_singleViewMode', false);
  }

  public override destroy(): void {
    super.destroy();
    this.view.destroy();
    if (this._rotatorView) this._rotatorView.destroy();
  }

  public hasView(view: View): boolean {
    return Array.from(this._viewToStack.keys()).includes(view);
  }

  public add(data: ContextualBalloonViewConfig): void {
    if (this.hasView(data.view)) {
      throw new Error('contextualballoon-add-view-exist: The view has already been added to the balloon.');
    }
    const stackId = data.stackId || 'main';
    if (!this._idToStack.has(stackId)) {
      this._idToStack.set(stackId, new Map([[data.view, data]]));
      this._viewToStack.set(data.view, this._idToStack.get(stackId)!);
      this._numberOfStacks = this._idToStack.size;
      if (!this._visibleStack || data.singleViewMode) {
        this.showStack(stackId);
      }
      return;
    }
    const stack = this._idToStack.get(stackId)!;
    if (data.singleViewMode) {
      this.showStack(stackId);
    }
    stack.set(data.view, data);
    this._viewToStack.set(data.view, stack);
    if (stack === this._visibleStack) {
      this._showView(data);
    }
  }

  public remove(view: View): void {
    if (!this.hasView(view)) {
      throw new Error('contextualballoon-remove-view-not-exist: The view does not exist in the balloon.');
    }
    const stack = this._viewToStack.get(view)!;
    if (this._singleViewMode && this.visibleView === view) {
      this._singleViewMode = false;
    }
    if (this.visibleView === view) {
      if (stack.size === 1) {
        if (this._idToStack.size > 1) {
          this._showNextStack();
        } else {
          this.view.hide();
          this.visibleView = null;
        }
      } else {
        this._showView(Array.from(stack.values())[stack.size - 2]);
      }
    }
    if (stack.size === 1) {
      this._idToStack.delete(this._getStackId(stack));
      this._numberOfStacks = this._idToStack.size;
    } else {
      stack.delete(view);
    }
    this._viewToStack.delete(view);
  }

  public updatePosition(position?: PinOptions): void {
    if (position) {
      this._visibleStack!.get(this.visibleView!)!.position = position;
    }
    this.view.pin(this._getBalloonPosition()!);
  }

  public showStack(id: string): void {
    this.visibleStack = id;
    const stack = this._idToStack.get(id);
    if (!stack) {
      throw new Error('contextualballoon-showstack-stack-not-exist: Cannot show a stack that does not exist.');
    }
    if (this._visibleStack === stack) return;
    this._showView(Array.from(stack.values()).pop()!);
  }

  public visibleStack?: string;

  private get _visibleStack(): Map<View, ContextualBalloonViewConfig> | undefined {
    return this.visibleView ? this._viewToStack.get(this.visibleView) : undefined;
  }

  private _getStackId(stack: Map<View, ContextualBalloonViewConfig>): string {
    const entry = Array.from(this._idToStack.entries()).find(entry => entry[1] === stack)!;
    return entry[0];
  }

  private _showNextStack(): void {
    const stacks = Array.from(this._idToStack.values());
    let nextIndex = stacks.indexOf(this._visibleStack!) + 1;
    if (!stacks[nextIndex]) nextIndex = 0;
    this.showStack(this._getStackId(stacks[nextIndex]));
  }

  private _showPrevStack(): void {
    const stacks = Array.from(this._idToStack.values());
    let nextIndex = stacks.indexOf(this._visibleStack!) - 1;
    if (!stacks[nextIndex]) nextIndex = stacks.length - 1;
    this.showStack(this._getStackId(stacks[nextIndex]));
  }

  private _showView({ view, balloonClassName = '', withArrow = true, singleViewMode = false }: ContextualBalloonViewConfig): void {
    this.view.class = balloonClassName;
    this.view.withArrow = withArrow;
    if (!this._rotatorView) {
      this._rotatorView = this._createRotatorView();
      this.view.content.add(this._rotatorView);
    }
    this._rotatorView.showView(view);
    this.visibleView = view;
    this.view.pin(this._getBalloonPosition()!);
    this._singleViewMode = singleViewMode;
    this._rotatorView.updateRotator();
  }

  private _createRotatorView(): RotatorView {
    const view = new RotatorView(this.editor.locale);
    const t = this.editor.locale.t;
    view.bind('isNavigationVisible').to(this, '_numberOfStacks', this, '_singleViewMode', (value: number, isSingleViewMode: boolean) => !isSingleViewMode && value > 1);
    view.on('change:isNavigationVisible', () => this.updatePosition(), { priority: 'low' });
    view.bind('counter').to(this, 'visibleView', this, '_numberOfStacks', (visibleView: View | null, numberOfStacks: number) => {
      if (numberOfStacks < 2) return '';
      const current = Array.from(this._idToStack.values()).indexOf(this._visibleStack!) + 1;
      return t('%0 of %1', [current, numberOfStacks]);
    });
    view.buttonNextView.on('execute', () => {
      if (view.focusTracker.isFocused) this.editor.editing.view.focus();
      this._showNextStack();
    });
    view.buttonPrevView.on('execute', () => {
      if (view.focusTracker.isFocused) this.editor.editing.view.focus();
      this._showPrevStack();
    });
    return view;
  }

  private _getBalloonPosition(): PinOptions | undefined {
    let position = Array.from(this._visibleStack!.values()).pop()!.position;
    if (position) {
      if (!position.limiter) {
        position = Object.assign({}, position, { limiter: this.positionLimiter });
      }
      position = Object.assign({}, position, { viewportOffsetConfig: this.editor.ui.viewportOffset });
    }
    return position;
  }
}

class RotatorView extends View {
  declare public isNavigationVisible: boolean;
  declare public counter: string;
  public readonly focusTracker: any;
  public readonly content = this.createCollection();
  public readonly buttonPrevView: ButtonView;
  public readonly buttonNextView: ButtonView;

  constructor(locale: any) {
    super(locale);
    const t = locale.t;
    const bind = this.bindTemplate;
    this.set('isNavigationVisible', true);
    this.set('counter', '');
    const { FocusTracker } = require_focus();
    this.focusTracker = new FocusTracker();
    this.buttonPrevView = this._createButtonView(t('Previous'), icons.previousArrow);
    this.buttonNextView = this._createButtonView(t('Next'), icons.nextArrow);
    this.setTemplate({
      tag: 'div',
      attributes: { class: ['ck', 'ck-balloon-rotator'], 'z-index': '-1' },
      children: [
        {
          tag: 'div',
          attributes: { class: ['ck-balloon-rotator__navigation', bind.to('isNavigationVisible', value => (value ? '' : 'ck-hidden'))] },
          children: [this.buttonPrevView, { tag: 'span', attributes: { class: ['ck-balloon-rotator__counter'] }, children: [{ text: bind.to('counter') }] }, this.buttonNextView]
        },
        { tag: 'div', attributes: { class: 'ck-balloon-rotator__content' }, children: this.content }
      ]
    });
  }

  public override render(): void {
    super.render();
    this.focusTracker.add(this.element!);
  }

  public override destroy(): void {
    super.destroy();
    this.focusTracker.destroy();
  }

  public showView(view: View): void {
    this.hideView();
    this.content.add(view);
  }

  public hideView(): void {
    this.content.clear();
  }

  public updateRotator(): void {
    /* no-op */
  }

  private _createButtonView(label: string, icon: string): ButtonView {
    const view = new ButtonView(this.locale);
    view.set({ label, icon, tooltip: true });
    return view;
  }
}

function require_focus(): { FocusTracker: any } {
  return { FocusTracker: focusTrackerCtor };
}

import { FocusTracker as focusTrackerCtor } from '../../utils/focustracker';
export type { Rect };
