import { Editor, type EditorConfig, getDataFromElement, attachToForm, secureSourceElement } from '../core/editor';
import { EditorUI } from '../core/editorui';
import { EditorUIView } from '../ui/editorui/editoruiview';
import { InlineEditableUIView } from '../ui/editableui/editableuiview';
import { ToolbarView } from '../ui/toolbar/toolbarview';
import { TooltipManager } from '../ui/tooltipmanager';
import { enablePlaceholder } from '../engine/view/placeholder';
import type { Locale } from '../utils/locale';
import type { EditingView } from '../engine/view';
import type { PluginConstructor } from '../core/plugin';

/** View of the decoupled (document) editor: the toolbar and editable are placed by the integrator. */
export class DecoupledEditorUIView extends EditorUIView {
  public readonly toolbar: ToolbarView;
  public readonly editable: InlineEditableUIView;

  constructor(locale: Locale, editingView: EditingView, options: { editableElement?: HTMLElement; shouldToolbarGroupWhenFull?: boolean; label?: string } = {}) {
    super(locale);
    this.toolbar = new ToolbarView(locale, { shouldGroupWhenFull: options.shouldToolbarGroupWhenFull });
    this.editable = new InlineEditableUIView(locale, editingView, options.editableElement, { label: options.label });
    this.toolbar.extendTemplate({ attributes: { class: ['ck-reset_all', 'ck-rounded-corners'], dir: locale.uiLanguageDirection } });
  }

  public override render(): void {
    super.render();
    this.registerChild([this.toolbar, this.editable]);
  }
}

export class DecoupledEditorUI extends EditorUI {
  public readonly view: DecoupledEditorUIView;
  private _tooltipManager: TooltipManager | null = null;

  constructor(editor: Editor, view: DecoupledEditorUIView) {
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
    const toolbar = view.toolbar;
    toolbar.fillFromConfig(editor.config.get('toolbar') as any, this.componentFactory);
    this.addToolbar(view.toolbar);
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

/** The decoupled editor: the integrator places `editor.ui.view.toolbar.element` and `editor.ui.view.editable.element`. */
export class DecoupledEditor extends Editor {
  public readonly ui: DecoupledEditorUI;

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
    const view = new DecoupledEditorUIView(this.locale, this.editing.view, { editableElement: isElement(sourceElementOrData) ? sourceElementOrData : undefined, shouldToolbarGroupWhenFull, label: this.config.get('label') as string | undefined });
    this.ui = new DecoupledEditorUI(this, view);
    attachToForm(this);
  }

  public override destroy(): Promise<unknown> {
    if (this.sourceElement) {
      this.updateSourceElement();
    }
    this.ui.destroy();
    return super.destroy();
  }

  public static create(sourceElementOrData: HTMLElement | string, config: EditorConfig = {}): Promise<DecoupledEditor> {
    return new Promise(resolve => {
      if (isElement(sourceElementOrData) && sourceElementOrData.tagName === 'TEXTAREA') {
        throw new Error('editor-wrong-element: The decoupled editor cannot be initialized on a <textarea>.');
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
