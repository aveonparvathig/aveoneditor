import { Editor, type EditorConfig, getDataFromElement, attachToForm, secureSourceElement } from '../core/editor';
import { EditorUI } from '../core/editorui';
import { BoxedEditorUIView } from '../ui/editorui/editoruiview';
import { InlineEditableUIView } from '../ui/editableui/editableuiview';
import { StickyPanelView } from '../ui/panel/stickypanelview';
import { ToolbarView } from '../ui/toolbar/toolbarview';
import { RibbonView, type RibbonConfig } from '../ui/ribbon/ribbonview';
import { TooltipManager } from '../ui/tooltipmanager';
import { enablePlaceholder } from '../engine/view/placeholder';
import type { Locale } from '../utils/locale';
import type { EditingView } from '../engine/view';
import type { PluginConstructor } from '../core/plugin';

/** View of the classic editor: a sticky toolbar (or Word-style ribbon) above a boxed editable. */
export class ClassicEditorUIView extends BoxedEditorUIView {
  public readonly stickyPanel: StickyPanelView;
  public readonly toolbar: ToolbarView;
  /** Present when the editor is configured with `ribbon`; it then replaces the toolbar. */
  public readonly ribbon: RibbonView | null;
  public readonly editable: InlineEditableUIView;

  constructor(locale: Locale, editingView: EditingView, options: { shouldToolbarGroupWhenFull?: boolean; label?: string; useRibbon?: boolean } = {}) {
    super(locale);
    this.stickyPanel = new StickyPanelView(locale);
    this.toolbar = new ToolbarView(locale, { shouldGroupWhenFull: options.shouldToolbarGroupWhenFull });
    this.ribbon = options.useRibbon ? new RibbonView(locale) : null;
    this.editable = new InlineEditableUIView(locale, editingView, undefined, { label: options.label });
  }

  public override render(): void {
    super.render();
    this.stickyPanel.content.add(this.ribbon || this.toolbar);
    this.top.add(this.stickyPanel);
    this.main.add(this.editable);
  }
}

/** UI controller of the classic editor. */
export class ClassicEditorUI extends EditorUI {
  public readonly view: ClassicEditorUIView;
  private _toolbarConfig: any;
  private _elementReplacer: { element: HTMLElement; display: string } | null = null;
  private _tooltipManager: TooltipManager | null = null;

  constructor(editor: Editor, view: ClassicEditorUIView) {
    super(editor);
    this.view = view;
    this._toolbarConfig = editor.config.get('toolbar');
  }

  public init(replacementElement: HTMLElement | null): void {
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

    if (replacementElement) {
      replacementElement.parentNode!.insertBefore(view.element!, replacementElement.nextSibling);
      this._elementReplacer = { element: replacementElement, display: replacementElement.style.display };
      replacementElement.style.display = 'none';
    }

    this._initPlaceholder();
    this._initToolbar();
    this._tooltipManager = new TooltipManager(editor);
    this.fire('ready');
  }

  public override destroy(): void {
    super.destroy();
    if (this._elementReplacer) {
      this._elementReplacer.element.style.display = this._elementReplacer.display;
      this._elementReplacer = null;
    }
    if (this._tooltipManager) this._tooltipManager.destroy(this.editor);
    this.view.destroy();
  }

  private _initToolbar(): void {
    const view = this.view;
    view.stickyPanel.bind('isActive').to(this.focusTracker, 'isFocused');
    view.stickyPanel.limiterElement = view.element;
    view.stickyPanel.bind('viewportTopOffset').to(this, 'viewportOffset', (offset: { top?: number }) => (offset && offset.top) || 0);
    if (view.ribbon) {
      const ribbon = view.ribbon;
      ribbon.fillFromConfig(this.editor.config.get('ribbon') as RibbonConfig, this.componentFactory);
      this.addToolbar(ribbon);
      ribbon.on('launch', (evt, launcher: { command: string }) => {
        if (this.editor.commands.get(launcher.command)) this.editor.execute(launcher.command);
      });
      this._initRibbonContexts(ribbon);
      this.editor.keystrokes.set('Ctrl+F1', (data, cancel) => {
        ribbon.toggleCollapsed();
        cancel();
      });
      return;
    }
    view.toolbar.fillFromConfig(this._toolbarConfig, this.componentFactory);
    this.addToolbar(view.toolbar);
  }

  /** Shows the contextual tabs (Table, Picture) while the cursor is in a table or a picture is selected. */
  private _initRibbonContexts(ribbon: RibbonView): void {
    const model = this.editor.model;
    const contexts = ribbon.contexts;
    if (!contexts.length) return;
    const update = () => {
      const selection = model.document.selection;
      const selected = selection.getSelectedElement();
      const position = selection.getFirstPosition();
      if (contexts.includes('table')) ribbon.setContextActive('table', !!(position && position.findAncestor('table')) || !!(selected && selected.is('element', 'table')));
      if (contexts.includes('image')) ribbon.setContextActive('image', !!(selected && (selected.is('element', 'imageBlock') || selected.is('element', 'imageInline'))));
    };
    this.listenTo(model.document.selection, 'change:range', update);
    this.listenTo(model.document, 'change:data', update);
    update();
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

/**
 * The classic editor: a toolbar above a boxed editing area, replacing a DOM element or textarea.
 */
export class ClassicEditor extends Editor {
  public readonly ui: ClassicEditorUI;

  protected constructor(sourceElementOrData: HTMLElement | string, config: EditorConfig = {}) {
    if (!isElement(sourceElementOrData) && config.initialData !== undefined) {
      throw new Error('editor-create-initial-data: The config.initialData option cannot be used together with initial data passed as a string.');
    }
    super(config);
    if (typeof this.config.get('initialData') !== 'string') {
      this.config.set('initialData', getInitialData(sourceElementOrData));
    }
    if (isElement(sourceElementOrData)) {
      this.sourceElement = sourceElementOrData;
      secureSourceElement(this, sourceElementOrData);
    }
    const shouldToolbarGroupWhenFull = !(this.config.get('toolbar.shouldNotGroupWhenFull') as boolean);
    const ribbon = this.config.get('ribbon') as RibbonConfig | false | undefined;
    const useRibbon = !!(ribbon && ribbon.tabs && ribbon.tabs.length);
    const view = new ClassicEditorUIView(this.locale, this.editing.view, { shouldToolbarGroupWhenFull, label: this.config.get('label') as string | undefined, useRibbon });
    this.ui = new ClassicEditorUI(this, view);
    attachToForm(this);
  }

  public override destroy(): Promise<unknown> {
    if (this.sourceElement) {
      this.updateSourceElement();
    }
    this.ui.destroy();
    return super.destroy();
  }

  public static create(sourceElementOrData: HTMLElement | string, config: EditorConfig = {}): Promise<ClassicEditor> {
    return new Promise(resolve => {
      const editor = new this(sourceElementOrData, config);
      resolve(
        editor
          .initPlugins()
          .then(() => editor.ui.init(isElement(sourceElementOrData) ? sourceElementOrData : null))
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

function getInitialData(sourceElementOrData: HTMLElement | string): string {
  return isElement(sourceElementOrData) ? getDataFromElement(sourceElementOrData) : sourceElementOrData;
}
