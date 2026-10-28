import { Editor, type EditorConfig, getDataFromElement, attachToForm, secureSourceElement } from '../core/editor';
import { EditorUI } from '../core/editorui';
import { Plugin } from '../core/plugin';
import { EditorUIView } from '../ui/editorui/editoruiview';
import { InlineEditableUIView } from '../ui/editableui/editableuiview';
import { BalloonPanelView } from '../ui/panel/balloonpanelview';
import { ContextualBalloon } from '../ui/panel/contextualballoon';
import { ToolbarView, normalizeToolbarConfig } from '../ui/toolbar/toolbarview';
import { TooltipManager } from '../ui/tooltipmanager';
import { enablePlaceholder } from '../engine/view/placeholder';
import { debounce } from '../utils/misc';
import type { Locale } from '../utils/locale';
import type { EditingView } from '../engine/view';
import type { PluginConstructor } from '../core/plugin';

/** Toolbar shown in a balloon next to the selection (`config.balloonToolbar`). */
export class BalloonToolbar extends Plugin {
  public readonly toolbarView: ToolbarView;
  private readonly _balloon: ContextualBalloon;
  private readonly _fireSelectionChangeDebounced: (() => void) & { cancel(): void };
  private _resizeObserver: ResizeObserver | null = null;
  private _balloonConfig: any;

  public static override get pluginName(): string {
    return 'BalloonToolbar';
  }

  public static override get requires() {
    return [ContextualBalloon];
  }

  constructor(editor: Editor) {
    super(editor);
    this._balloonConfig = normalizeToolbarConfig(editor.config.get('balloonToolbar') as any);
    this.toolbarView = this._createToolbarView();
    this._balloon = editor.plugins.get(ContextualBalloon) as ContextualBalloon;
    this._fireSelectionChangeDebounced = debounce(() => this.fire('_selectionChangeDebounced'), 200);
    this.listenTo(editor.editing.view.document, 'selectionChange', () => {
      this._fireSelectionChangeDebounced();
    });
    this.listenTo(this, '_selectionChangeDebounced', () => {
      if (this.editor.editing.view.document.isFocused) {
        this.show();
      }
    });
    this.listenTo(editor.ui.focusTracker, 'change:isFocused', (evt, name, isFocused: boolean) => {
      if (!isFocused) {
        this.hide();
      } else {
        this.show();
      }
    });
  }

  public override init(): void {
    const editor = this.editor;
    const selection = editor.model.document.selection;
    editor.ui.addToolbar(this.toolbarView, { isContextual: true, beforeFocus: () => this.show(true), afterBlur: () => this.hide() });
    this.listenTo(selection, 'change:range', () => {
      if (!editor.editing.view.document.isFocused || selection.isCollapsed) {
        this.hide();
      }
    });
  }

  public override afterInit(): void {
    const factory = this.editor.ui.componentFactory;
    this.toolbarView.fillFromConfig(this._balloonConfig, factory);
    this.toolbarView.items.delegate('execute').to(this);
  }

  public show(showForCollapsedSelection = false): void {
    const editor = this.editor;
    const selection = editor.model.document.selection;
    const schema = editor.model.schema;
    if (this._balloon.hasView(this.toolbarView)) return;
    if (selection.isCollapsed && !showForCollapsedSelection) return;
    if (Array.from(this.toolbarView.items).every((item: any) => item.isEnabled !== undefined && !item.isEnabled)) return;
    if (selectionContainsOnlyMultipleSelectables(selection, schema)) return;
    this.listenTo(this.editor.ui, 'update', () => this._updatePosition());
    this._balloon.add({ view: this.toolbarView, position: this._getBalloonPositionData(), balloonClassName: 'ck-toolbar-container' });
  }

  public hide(): void {
    if (this._balloon.hasView(this.toolbarView)) {
      this.stopListening(this.editor.ui, 'update');
      this._balloon.remove(this.toolbarView);
    }
  }

  public override destroy(): void {
    super.destroy();
    this._fireSelectionChangeDebounced.cancel();
    this.toolbarView.destroy();
    if (this._resizeObserver) this._resizeObserver.disconnect();
  }

  private _createToolbarView(): ToolbarView {
    const shouldGroupWhenFull = !this._balloonConfig.shouldNotGroupWhenFull;
    const toolbarView = new ToolbarView(this.editor.locale, { shouldGroupWhenFull, isCompact: true });
    toolbarView.render();
    return toolbarView;
  }

  private _updatePosition(): void {
    this._balloon.updatePosition(this._getBalloonPositionData());
  }

  private _getBalloonPositionData(): any {
    const editor = this.editor;
    const view = editor.editing.view;
    const viewDocument = view.document;
    const viewSelection = viewDocument.selection;
    const isBackward = viewSelection.isBackward;
    const defaultPositions = BalloonPanelView.defaultPositions;
    return {
      target: () => {
        const range = viewSelection.getFirstRange()!;
        const domRange = view.domConverter.viewRangeToDom(range);
        const rects = Array.from(domRange.getClientRects());
        if (!rects.length) return domRange.getBoundingClientRect();
        return isBackward ? rects[0] : rects[rects.length - 1];
      },
      positions: isBackward
        ? [defaultPositions.northWestArrowSouth, defaultPositions.northWestArrowSouthWest, defaultPositions.northWestArrowSouthEast, defaultPositions.southWestArrowNorth, defaultPositions.southWestArrowNorthWest, defaultPositions.southWestArrowNorthEast]
        : [defaultPositions.southEastArrowNorth, defaultPositions.southEastArrowNorthEast, defaultPositions.southEastArrowNorthWest, defaultPositions.northEastArrowSouth, defaultPositions.northEastArrowSouthEast, defaultPositions.northEastArrowSouthWest]
    };
  }
}

function selectionContainsOnlyMultipleSelectables(selection: any, schema: any): boolean {
  if (selection.rangeCount === 1) return false;
  return Array.from(selection.getRanges()).every((range: any) => {
    const element = range.getContainedElement();
    return element && schema.isSelectable(element);
  });
}

export class BalloonEditorUIView extends EditorUIView {
  public readonly editable: InlineEditableUIView;

  constructor(locale: Locale, editingView: EditingView, editableElement?: HTMLElement, options: { label?: string } = {}) {
    super(locale);
    this.editable = new InlineEditableUIView(locale, editingView, editableElement, { label: options.label });
  }

  public override render(): void {
    super.render();
    this.registerChild(this.editable);
  }
}

export class BalloonEditorUI extends EditorUI {
  public readonly view: BalloonEditorUIView;
  private _tooltipManager: TooltipManager | null = null;

  constructor(editor: Editor, view: BalloonEditorUIView) {
    super(editor);
    this.view = view;
  }

  public init(): void {
    const editor = this.editor;
    const view = this.view;
    const editingView = editor.editing.view;
    const editable = view.editable;
    const editingRoot = editingView.document.getRoot()!;
    editable.name = editingRoot.rootName;
    view.render();
    const editableElement = editable.element!;
    this.setEditableElement(editable.name, editableElement);
    editable.bind('isFocused').to(editingView.document);
    editingView.attachDomRoot(editableElement);
    this._initPlaceholder();
    this._tooltipManager = new TooltipManager(editor);
    this.fire('ready');
  }

  public override destroy(): void {
    super.destroy();
    if (this._tooltipManager) this._tooltipManager.destroy(this.editor);
    this.view.destroy();
  }

  private _initPlaceholder(): void {
    const editor = this.editor;
    const editingView = editor.editing.view;
    const editingRoot = editingView.document.getRoot()!;
    const placeholder = editor.config.get('placeholder');
    if (placeholder) {
      const placeholderText = typeof placeholder === 'string' ? placeholder : placeholder[editingRoot.rootName];
      if (placeholderText) {
        enablePlaceholder({ view: editingView, element: editingRoot, text: placeholderText, isDirectHost: false, keepOnFocus: true });
      }
    }
  }
}

/** The balloon editor: a contextual toolbar in a balloon, no fixed toolbar. */
export class BalloonEditor extends Editor {
  public readonly ui: BalloonEditorUI;

  protected constructor(sourceElementOrData: HTMLElement | string, config: EditorConfig = {}) {
    if (!isElement(sourceElementOrData) && config.initialData !== undefined) {
      throw new Error('editor-create-initial-data');
    }
    super(config);
    if (typeof this.config.get('initialData') !== 'string') {
      this.config.set('initialData', isElement(sourceElementOrData) ? getDataFromElement(sourceElementOrData) : sourceElementOrData);
    }
    if (isElement(sourceElementOrData)) {
      this.sourceElement = sourceElementOrData;
      secureSourceElement(this, sourceElementOrData);
    }
    const plugins = (this.config.get('plugins') as any[]) || [];
    plugins.push(BalloonToolbar);
    this.config.set('plugins', plugins);
    this.config.define('balloonToolbar', this.config.get('toolbar'));
    const view = new BalloonEditorUIView(this.locale, this.editing.view, isElement(sourceElementOrData) ? sourceElementOrData : undefined, { label: this.config.get('label') as string | undefined });
    this.ui = new BalloonEditorUI(this, view);
    attachToForm(this);
  }

  public override destroy(): Promise<unknown> {
    if (this.sourceElement) {
      this.updateSourceElement();
    }
    this.ui.destroy();
    return super.destroy();
  }

  public static create(sourceElementOrData: HTMLElement | string, config: EditorConfig = {}): Promise<BalloonEditor> {
    return new Promise(resolve => {
      if (isElement(sourceElementOrData) && sourceElementOrData.tagName === 'TEXTAREA') {
        throw new Error('editor-wrong-element: The balloon editor cannot be initialized on a <textarea>.');
      }
      const editor = new this(sourceElementOrData, config);
      resolve(
        editor
          .initPlugins()
          .then(() => editor.ui.init())
          .then(() => editor.data.init(editor.config.get('initialData') as string))
          .then(() => editor.fire('ready'))
          .then(() => editor)
      );
    });
  }

  public static override builtinPlugins: PluginConstructor[] | undefined;
  public static override defaultConfig: EditorConfig | undefined;
}

function isElement(value: unknown): value is HTMLElement {
  return typeof HTMLElement !== 'undefined' && value instanceof HTMLElement;
}
