import { Editor, type EditorConfig, getDataFromElement, attachToForm, secureSourceElement } from '../core/editor';
import { EditorUI } from '../core/editorui';
import { EditorUIView } from '../ui/editorui/editoruiview';
import { InlineEditableUIView } from '../ui/editableui/editableuiview';
import { BalloonPanelView } from '../ui/panel/balloonpanelview';
import { ToolbarView } from '../ui/toolbar/toolbarview';
import { TooltipManager } from '../ui/tooltipmanager';
import { enablePlaceholder } from '../engine/view/placeholder';
import type { Locale } from '../utils/locale';
import type { EditingView } from '../engine/view';
import type { PluginConstructor } from '../core/plugin';

/** View of the inline editor: a floating toolbar above the editable. */
export class InlineEditorUIView extends EditorUIView {
  public readonly toolbar: ToolbarView;
  public readonly panel: BalloonPanelView;
  public readonly editable: InlineEditableUIView;
  public viewportTopOffset = 0;

  constructor(locale: Locale, editingView: EditingView, editableElement?: HTMLElement, options: { shouldToolbarGroupWhenFull?: boolean; label?: string } = {}) {
    super(locale);
    this.toolbar = new ToolbarView(locale, { shouldGroupWhenFull: options.shouldToolbarGroupWhenFull });
    this.panel = new BalloonPanelView(locale);
    this.panel.withArrow = false;
    this.panel.class = 'ck-toolbar-container';
    this.editable = new InlineEditableUIView(locale, editingView, editableElement, { label: options.label });
  }

  public override render(): void {
    super.render();
    this.body.add(this.panel);
    this.registerChild(this.editable);
    this.panel.content.add(this.toolbar);
  }

  public get panelPositions(): any[] {
    const positions = [
      (editableRect: any, panelRect: any) => ({ top: editableRect.top - panelRect.height, left: editableRect.left, name: 'toolbar_west', config: { withArrow: false } }),
      (editableRect: any, panelRect: any) => ({ top: editableRect.top - panelRect.height, left: editableRect.left + editableRect.width - panelRect.width, name: 'toolbar_east', config: { withArrow: false } }),
      (editableRect: any, panelRect: any, viewportRect: any) => ({ top: Math.max(viewportRect.top + this.viewportTopOffset, editableRect.top - panelRect.height), left: editableRect.left, name: 'toolbar_sticky', config: { withArrow: false } })
    ];
    if (this.locale!.uiLanguageDirection === 'ltr') return positions;
    return [positions[1], positions[0], positions[2]];
  }
}

/** UI controller of the inline editor. */
export class InlineEditorUI extends EditorUI {
  public readonly view: InlineEditorUIView;
  private _toolbarConfig: any;
  private _tooltipManager: TooltipManager | null = null;

  constructor(editor: Editor, view: InlineEditorUIView) {
    super(editor);
    this.view = view;
    this._toolbarConfig = editor.config.get('toolbar');
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
    view.editable.bind('isFocused').to(editingView.document);
    editingView.attachDomRoot(editableElement);
    this._initPlaceholder();
    this._initToolbar();
    this._tooltipManager = new TooltipManager(editor);
    this.fire('ready');
  }

  public override destroy(): void {
    super.destroy();
    if (this._tooltipManager) this._tooltipManager.destroy(this.editor);
    this.view.destroy();
  }

  private _initToolbar(): void {
    const editor = this.editor;
    const view = this.view;
    const editableElement = view.editable.element!;
    const toolbar = view.toolbar;
    view.panel.bind('isVisible').to(this.focusTracker, 'isFocused');
    view.bind('viewportTopOffset').to(this, 'viewportOffset', (offset: { top?: number }) => (offset && offset.top) || 0);
    view.listenTo(editor.ui, 'update', () => {
      if (view.panel.isVisible) {
        view.panel.pin({ target: editableElement, positions: view.panelPositions });
      }
    });
    toolbar.fillFromConfig(this._toolbarConfig, this.componentFactory);
    this.addToolbar(toolbar);
  }

  private _initPlaceholder(): void {
    const editor = this.editor;
    const editingView = editor.editing.view;
    const editingRoot = editingView.document.getRoot()!;
    const sourceElement = editor.sourceElement;
    let placeholderText: string | undefined;
    const placeholder = editor.config.get('placeholder');
    if (placeholder) {
      placeholderText = typeof placeholder === 'string' ? placeholder : placeholder[editingRoot.rootName];
    }
    if (!placeholderText && sourceElement && sourceElement.tagName.toLowerCase() === 'textarea') {
      placeholderText = (sourceElement as HTMLTextAreaElement).getAttribute('placeholder') || undefined;
    }
    if (placeholderText) {
      enablePlaceholder({ view: editingView, element: editingRoot, text: placeholderText, isDirectHost: false, keepOnFocus: true });
    }
  }
}

/** The inline editor: edits an element in place with a floating toolbar. */
export class InlineEditor extends Editor {
  public readonly ui: InlineEditorUI;

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
    const shouldToolbarGroupWhenFull = !(this.config.get('toolbar.shouldNotGroupWhenFull') as boolean);
    const view = new InlineEditorUIView(this.locale, this.editing.view, isElement(sourceElementOrData) ? sourceElementOrData : undefined, { shouldToolbarGroupWhenFull, label: this.config.get('label') as string | undefined });
    this.ui = new InlineEditorUI(this, view);
    attachToForm(this);
  }

  public override destroy(): Promise<unknown> {
    if (this.sourceElement) {
      this.updateSourceElement();
    }
    this.ui.destroy();
    return super.destroy();
  }

  public static create(sourceElementOrData: HTMLElement | string, config: EditorConfig = {}): Promise<InlineEditor> {
    return new Promise(resolve => {
      if (isElement(sourceElementOrData) && sourceElementOrData.tagName === 'TEXTAREA') {
        throw new Error('editor-wrong-element: The inline editor cannot be initialized on a <textarea>.');
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
