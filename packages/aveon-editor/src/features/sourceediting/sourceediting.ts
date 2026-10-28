import { Plugin } from '../../core/plugin';
import { ButtonView } from '../../ui/button/buttonview';
import { PendingActions } from '../../core/pendingactions';
import { icons } from '../../ui/icons';
import type { Editor } from '../../core/editor';

const COMMAND_FORCE_DISABLE_ID = 'SourceEditingMode';

/** Switches the editor into HTML source editing mode (a textarea replaces the editable). */
export class SourceEditing extends Plugin {
  declare public isSourceEditingMode: boolean;
  private _replacedRoots = new Map<string, HTMLElement>();
  private _dataFromRoots = new Map<string, string>();
  private _elementReplacer = new ElementReplacer();

  public static override get pluginName(): string {
    return 'SourceEditing';
  }

  public static override get requires() {
    return [PendingActions];
  }

  constructor(editor: Editor) {
    super(editor);
    this.set('isSourceEditingMode', false);
  }

  public override init(): void {
    this._checkCompatibility();
    const editor = this.editor;
    const t = editor.t;
    editor.ui.componentFactory.add('sourceEditing', locale => {
      const buttonView = new ButtonView(locale);
      buttonView.set({ label: t('Source'), icon: icons.source, tooltip: true, withText: true, class: 'ck-source-editing-button' });
      buttonView.bind('isOn').to(this, 'isSourceEditingMode');
      buttonView.bind('isEnabled').to(this, 'isEnabled', editor, 'isReadOnly', (isEnabled: boolean, isEditorReadOnly: boolean) => isEnabled && !isEditorReadOnly);
      this.listenTo(buttonView, 'execute', () => {
        this.isSourceEditingMode = !this.isSourceEditingMode;
      });
      return buttonView;
    });

    this.on('change:isSourceEditingMode', (evt, name, isSourceEditingMode: boolean) => {
      if (isSourceEditingMode) {
        this._showSourceEditing();
        this._disableCommands();
      } else {
        this._hideSourceEditing();
        this._enableCommands();
      }
    });
    this.on('change:isEnabled', (evt, name, isEnabled: boolean) => this._handleReadOnlyMode(!isEnabled));
    this.listenTo(editor, 'change:isReadOnly', (evt, name, isReadOnly: boolean) => this._handleReadOnlyMode(isReadOnly));
    editor.data.on('set', () => {
      if (this.isSourceEditingMode) this.isSourceEditingMode = false;
    }, { priority: 'high' });
  }

  public updateEditorData(): void {
    const editor = this.editor;
    const data: Record<string, string> = {};
    for (const [rootName, domSourceEditingElementWrapper] of this._replacedRoots) {
      const oldData = this._dataFromRoots.get(rootName);
      const newData = (domSourceEditingElementWrapper.querySelector('textarea') as HTMLTextAreaElement).value;
      if (oldData !== newData) {
        data[rootName] = newData;
        this._dataFromRoots.set(rootName, newData);
      }
    }
    if (Object.keys(data).length) {
      editor.data.set(data, { batchType: { isUndoable: true } });
    }
  }

  private _showSourceEditing(): void {
    const editor = this.editor;
    const editingView = editor.editing.view;
    const model = editor.model;
    model.change(writer => {
      writer.setSelection(null);
      writer.removeSelectionAttribute(model.document.selection.getAttributeKeys());
    });
    editingView.document.isReadOnly = true;
    for (const [rootName, domRootElement] of editingView.domRoots) {
      const data = formatHtml(editor.data.get({ rootName }));
      const domSourceEditingElementWrapper = document.createElement('div');
      domSourceEditingElementWrapper.className = 'ck-source-editing-area';
      domSourceEditingElementWrapper.setAttribute('data-value', data);
      const domSourceEditingElementTextarea = document.createElement('textarea');
      domSourceEditingElementTextarea.rows = 1;
      domSourceEditingElementTextarea.setAttribute('aria-label', 'Source code editing area');
      domSourceEditingElementTextarea.value = data;
      domSourceEditingElementTextarea.addEventListener('input', () => {
        domSourceEditingElementWrapper.setAttribute('data-value', domSourceEditingElementTextarea.value);
        editor.ui.update();
      });
      domSourceEditingElementWrapper.append(domSourceEditingElementTextarea);
      if (editor.isReadOnly) domSourceEditingElementTextarea.readOnly = true;
      this._replacedRoots.set(rootName, domSourceEditingElementWrapper);
      this._elementReplacer.replace(domRootElement, domSourceEditingElementWrapper);
      this._dataFromRoots.set(rootName, data);
    }
    this._focusSourceEditing();
  }

  private _hideSourceEditing(): void {
    const editor = this.editor;
    const editingView = editor.editing.view;
    this.updateEditorData();
    editingView.document.isReadOnly = false;
    this._elementReplacer.restore();
    this._replacedRoots.clear();
    this._dataFromRoots.clear();
    editingView.focus();
  }

  private _focusSourceEditing(): void {
    const [domSourceEditingElementWrapper] = this._replacedRoots.values();
    const textarea = domSourceEditingElementWrapper.querySelector('textarea')!;
    textarea.focus();
  }

  private _disableCommands(): void {
    const editor = this.editor;
    for (const command of editor.commands.commands()) {
      command.forceDisabled(COMMAND_FORCE_DISABLE_ID);
    }
  }

  private _enableCommands(): void {
    const editor = this.editor;
    for (const command of editor.commands.commands()) {
      command.clearForceDisabled(COMMAND_FORCE_DISABLE_ID);
    }
  }

  private _handleReadOnlyMode(isReadOnly: boolean): void {
    if (!this.isSourceEditingMode) return;
    for (const [, domSourceEditingElementWrapper] of this._replacedRoots) {
      (domSourceEditingElementWrapper.querySelector('textarea') as HTMLTextAreaElement).readOnly = isReadOnly;
    }
  }

  private _checkCompatibility(): void {
    const editor = this.editor;
    const collaborationPluginNamesToWarn = ['RealTimeCollaborativeEditing', 'RealTimeCollaborativeComments', 'RealTimeCollaborativeTrackChanges', 'RealTimeCollaborativeRevisionHistory', 'RestrictedEditingMode'];
    for (const pluginName of collaborationPluginNamesToWarn) {
      if (editor.plugins.has(pluginName)) {
        console.warn(`source-editing-incompatible-with: ${pluginName}`);
      }
    }
  }
}

class ElementReplacer {
  private _replacedElements: Array<{ element: HTMLElement; newElement: HTMLElement }> = [];

  public replace(element: HTMLElement, newElement: HTMLElement): void {
    this._replacedElements.push({ element, newElement });
    element.style.display = 'none';
    element.parentNode!.insertBefore(newElement, element.nextSibling);
  }

  public restore(): void {
    this._replacedElements.forEach(({ element, newElement }) => {
      element.style.display = '';
      newElement.remove();
    });
    this._replacedElements = [];
  }
}

/** Formats HTML with line breaks and indentation for readability. */
export function formatHtml(input: string): string {
  const elementsToFormat = ['address', 'article', 'aside', 'blockquote', 'details', 'dialog', 'dd', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul', 'figure', 'br'];
  const lines = input
    .replace(new RegExp(`</?(${elementsToFormat.join('|')})( [^>]*)?>`, 'g'), '\n$&\n')
    .split('\n')
    .filter(line => line.length);
  let indentCount = 0;
  const isNonVoidElement = (line: string) => !!line.match(/^<(?!br|hr)[^/>]+>$/) || !!line.match(/^<(?!br|hr)[^/>]+ [^>]*>$/);
  const isClosingElement = (line: string) => !!line.match(/^<\/[^>]+>$/);
  const isPreformatted = (line: string) => !!line.match(/^<pre/);
  return lines
    .map(line => {
      if (isClosingElement(line)) indentCount = Math.max(0, indentCount - 1);
      const indent = '    '.repeat(indentCount);
      if (isNonVoidElement(line) && !isPreformatted(line) && !line.match(/^<(td|th|p|li|h[1-6]|figcaption|caption|pre|code|dt|dd)[ >]/)) {
        indentCount++;
      }
      return indent + line;
    })
    .join('\n');
}
