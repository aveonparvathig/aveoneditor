import { Observable } from '../utils/observable';
import { FocusTracker } from '../utils/focustracker';
import { ComponentFactory } from './componentfactory';
import type { Editor } from './editor';
import type { EditorUIView } from '../ui/editorui/editoruiview';
import { isVisible } from '../utils/dom';

/**
 * Base class for editor UIs: owns the component factory, focus tracker and editable elements.
 */
export abstract class EditorUI extends Observable {
  public readonly editor: Editor;
  public readonly componentFactory: ComponentFactory;
  public readonly focusTracker = new FocusTracker();
  public abstract readonly view: EditorUIView;
  declare public viewportOffset: { top?: number; right?: number; bottom?: number; left?: number };
  declare public isReady: boolean;
  private _editableElementsMap = new Map<string, HTMLElement>();
  private _focusableToolbarDefinitions: Array<{ toolbarView: any; options: { isContextual?: boolean; beforeFocus?: () => void; afterBlur?: () => void } }> = [];

  constructor(editor: Editor) {
    super();
    this.editor = editor;
    this.componentFactory = new ComponentFactory(editor);
    this.set('viewportOffset', this._readViewportOffsetFromConfig());
    this.set('isReady', false);
    this.once('ready', () => {
      this.isReady = true;
    });
    this.listenTo(editor.editing.view, 'render', () => this.update());
    this.listenTo(editor.editing.view.document, 'layoutChanged', () => this.update());
    this._initFocusTracking();
  }

  public get element(): HTMLElement | null {
    return this.view ? this.view.element : null;
  }

  /** Fires `update` so the UI can reposition balloons etc. */
  public update(): void {
    this.fire('update');
  }

  public destroy(): void {
    this.stopListening();
    this.focusTracker.destroy();
    for (const domElement of this._editableElementsMap.values()) {
      (domElement as any).aveonEditable = null;
      (domElement as any).aveonEditorInstance = null;
    }
    this._editableElementsMap = new Map();
    this._focusableToolbarDefinitions = [];
  }

  public setEditableElement(rootName: string, domElement: HTMLElement): void {
    this._editableElementsMap.set(rootName, domElement);
    if (!(domElement as any).aveonEditorInstance) {
      (domElement as any).aveonEditorInstance = this.editor;
    }
    this.focusTracker.add(domElement);
    const setUpKeystrokeHandling = () => {
      if (this.editor.editing.view.getDomRoot(rootName)) return;
      this.editor.keystrokes.listenTo(this.editor.editing.view.document);
    };
    if (this.isReady) {
      setUpKeystrokeHandling();
    } else {
      this.once('ready', setUpKeystrokeHandling);
    }
  }

  public removeEditableElement(rootName: string): void {
    const domElement = this._editableElementsMap.get(rootName);
    if (!domElement) return;
    this._editableElementsMap.delete(rootName);
    (domElement as any).aveonEditorInstance = null;
    this.focusTracker.remove(domElement);
  }

  public getEditableElement(rootName = 'main'): HTMLElement | undefined {
    return this._editableElementsMap.get(rootName);
  }

  public *getEditableElementsNames(): IterableIterator<string> {
    yield* this._editableElementsMap.keys();
  }

  public addToolbar(toolbarView: any, options: { isContextual?: boolean; beforeFocus?: () => void; afterBlur?: () => void } = {}): void {
    if (toolbarView.element) {
      this.focusTracker.add(toolbarView.element);
      // Views do not emit DOM events, so listen on the element (Esc returns to the content).
      this.editor.keystrokes.listenTo(toolbarView.element);
    }
    this._focusableToolbarDefinitions.push({ toolbarView, options });
  }

  /** @internal */
  public get _editableElements(): Map<string, HTMLElement> {
    return this._editableElementsMap;
  }

  private _readViewportOffsetFromConfig(): { top?: number; right?: number; bottom?: number; left?: number } {
    const editor = this.editor;
    const viewportOffsetConfig = editor.config.get('ui.viewportOffset') as any;
    if (viewportOffsetConfig) return viewportOffsetConfig;
    const legacy = editor.config.get('toolbar.viewportTopOffset') as number | undefined;
    if (legacy) return { top: legacy };
    return { top: 0 };
  }

  private _initFocusTracking(): void {
    const editor = this.editor;
    const editingView = editor.editing.view;
    let candidateDefinitions: typeof this._focusableToolbarDefinitions | null = null;

    // Alt+F10: focus the (first visible) toolbar.
    editor.keystrokes.set('Alt+F10', (data, cancel) => {
      const focusedElement = this.focusTracker.focusedElement;
      const definitions = this._focusableToolbarDefinitions.filter(({ toolbarView, options }) => {
        if (!toolbarView.element || !isVisible(toolbarView.element)) return false;
        return !options.isContextual || true;
      });
      if (!definitions.length) return;
      if (!candidateDefinitions || !candidateDefinitions.length) {
        candidateDefinitions = definitions;
      }
      const definition = candidateDefinitions.shift();
      if (!definition) return;
      const { toolbarView, options } = definition;
      if (options.beforeFocus) options.beforeFocus();
      toolbarView.focus();
      void focusedElement;
      cancel();
    });

    // Esc: go back to the editing root from a toolbar.
    editor.keystrokes.set('Esc', (data, cancel) => {
      // Focus events can be missed (e.g. while the window is in the background); the active element cannot.
      const focused = this.focusTracker.focusedElement || (this.element && this.element.ownerDocument.activeElement);
      const definition = this._focusableToolbarDefinitions.find(({ toolbarView }) => toolbarView.element && focused && toolbarView.element.contains(focused));
      if (definition) {
        editingView.focus();
        if (definition.options.afterBlur) definition.options.afterBlur();
        cancel();
      }
    });
    candidateDefinitions = null;
  }
}
