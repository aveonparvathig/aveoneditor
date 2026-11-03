import { Plugin } from '../../core/plugin';
import { Command } from '../../core/command';
import { createDropdown, addListToDropdown, type ListDropdownItemDefinition } from '../../ui/dropdown/dropdownview';
import { SplitButtonView } from '../../ui/button/splitbuttonview';
import { Collection } from '../../utils/collection';
import { Observable } from '../../utils/observable';
import { icons } from '../../ui/icons';
import { first } from '../../utils/misc';
import { ShiftEnter } from '../enter/enter';
import { keyCodes } from '../../utils/keyboard';
import type { Editor } from '../../core/editor';
import type { Element as ModelElement } from '../../engine/model/element';
import type { Writer } from '../../engine/model/writer';

export interface CodeBlockLanguageDefinition {
  language: string;
  label: string;
  class?: string;
}

const DEFAULT_LANGUAGES: CodeBlockLanguageDefinition[] = [
  { language: 'plaintext', label: 'Plain text' },
  { language: 'c', label: 'C' },
  { language: 'cs', label: 'C#' },
  { language: 'cpp', label: 'C++' },
  { language: 'css', label: 'CSS' },
  { language: 'diff', label: 'Diff' },
  { language: 'html', label: 'HTML' },
  { language: 'java', label: 'Java' },
  { language: 'javascript', label: 'JavaScript' },
  { language: 'php', label: 'PHP' },
  { language: 'python', label: 'Python' },
  { language: 'ruby', label: 'Ruby' },
  { language: 'typescript', label: 'TypeScript' },
  { language: 'xml', label: 'XML' },
  { language: 'json', label: 'JSON' },
  { language: 'sql', label: 'SQL' },
  { language: 'yaml', label: 'YAML' },
  { language: 'bash', label: 'Shell' },
  { language: 'markdown', label: 'Markdown' }
];

/** Short names used in Markdown fences (```js) for the languages above. */
const LANGUAGE_ALIASES: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  rb: 'ruby',
  csharp: 'cs',
  'c#': 'cs',
  'c++': 'cpp',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  md: 'markdown',
  htm: 'html'
};

export function getNormalizedAndLocalizedLanguageDefinitions(editor: Editor): CodeBlockLanguageDefinition[] {
  const t = editor.t;
  const languageDefs = editor.config.get('codeBlock.languages') as CodeBlockLanguageDefinition[];
  return languageDefs.map(def => ({ ...def, label: def.language === 'plaintext' ? t('Plain text') : def.label, class: def.class !== undefined ? def.class : `language-${def.language}` }));
}

export function getPropertyAssociation(languageDefs: CodeBlockLanguageDefinition[], key: 'language' | 'class', value: 'language' | 'class' | 'label'): Record<string, string> {
  const association: Record<string, string> = {};
  for (const def of languageDefs) {
    if (key === 'class') {
      association[(def.class || '').split(' ').shift()!] = def[value] as string;
    } else {
      association[def[key] as string] = def[value] as string;
    }
  }
  return association;
}

export function getLeadingWhiteSpaces(textNode: any): string {
  return textNode.data.match(/^(\s*)/)![0];
}

/** Converts selected blocks to a code block (or back to paragraphs). */
export class CodeBlockCommand extends Command {
  private _lastLanguage: string | null = null;

  public override refresh(): void {
    this.value = this._getValue();
    this.isEnabled = this._checkEnabled();
  }

  public override execute(options: { language?: string; forceValue?: boolean; usePreviousLanguageChoice?: boolean } = {}): void {
    const editor = this.editor;
    const model = editor.model;
    const selection = model.document.selection;
    const normalizedLanguagesDefs = getNormalizedAndLocalizedLanguageDefinitions(editor);
    const firstLanguageInConfig = normalizedLanguagesDefs[0];
    const blocks = Array.from(selection.getSelectedBlocks());
    const value = options.forceValue === undefined ? !this.value : options.forceValue;
    const language = getLanguage(options, this._lastLanguage, firstLanguageInConfig.language);
    model.change(writer => {
      if (value) {
        this._applyCodeBlock(writer, blocks, language);
      } else {
        this._removeCodeBlock(writer, blocks);
      }
    });
  }

  private _getValue(): string | false {
    const selection = this.editor.model.document.selection;
    const firstBlock = first(selection.getSelectedBlocks());
    const isCodeBlock = !!(firstBlock && firstBlock.is('element', 'codeBlock'));
    return isCodeBlock ? (firstBlock!.getAttribute('language') as string) : false;
  }

  private _checkEnabled(): boolean {
    if (this.value) return true;
    const selection = this.editor.model.document.selection;
    const schema = this.editor.model.schema;
    const firstBlock = first(selection.getSelectedBlocks());
    return !!firstBlock && canBeCodeBlock(schema, firstBlock);
  }

  private _applyCodeBlock(writer: Writer, blocks: ModelElement[], language: string): void {
    this._lastLanguage = language;
    const schema = this.editor.model.schema;
    const allowedBlocks = blocks.filter(block => canBeCodeBlock(schema, block));
    for (const block of allowedBlocks) {
      writer.rename(block, 'codeBlock');
      writer.setAttribute('language', language, block);
      schema.removeDisallowedAttributes([block], writer);
      Array.from(block.getChildren()).filter(node => node.is('element', 'softBreak')).forEach(node => writer.remove(node));
      // Join the content with the previous code block (merge consecutive blocks).
      const previous = block.previousSibling as ModelElement | null;
      if (previous && previous.is('element', 'codeBlock') && allowedBlocks.includes(previous)) {
        writer.appendElement('softBreak', previous);
        writer.move(writer.createRangeIn(block), writer.createPositionAt(previous, 'end'));
        writer.remove(block);
      }
    }
  }

  private _removeCodeBlock(writer: Writer, blocks: ModelElement[]): void {
    const codeBlocks = blocks.filter(block => block.is('element', 'codeBlock'));
    for (const block of codeBlocks) {
      const range = writer.createRangeOn(block);
      for (const item of Array.from(range.getItems({ shallow: true })).reverse()) {
        if (item.is('element', 'softBreak') && (item as any).parent.is('element', 'codeBlock')) {
          const { position } = writer.split(writer.createPositionBefore(item as any));
          const upperBlock = position.nodeBefore as ModelElement;
          writer.rename(upperBlock, 'paragraph');
          writer.removeAttribute('language', upperBlock);
          writer.remove(item as any);
        }
      }
      writer.rename(block, 'paragraph');
      writer.removeAttribute('language', block);
    }
  }
}

function canBeCodeBlock(schema: any, element: ModelElement): boolean {
  if (element.is('rootElement') || schema.isLimit(element)) return false;
  return schema.checkChild(element.parent as ModelElement, 'codeBlock');
}

function getLanguage(options: any, lastLanguage: string | null, defaultLanguage: string): string {
  if (options.language) return options.language;
  if (options.usePreviousLanguageChoice && lastLanguage) return lastLanguage;
  return defaultLanguage;
}

/** Indents code block lines with Tab. */
export class IndentCodeBlockCommand extends Command {
  private _indentSequence: string;

  constructor(editor: Editor) {
    super(editor);
    this._indentSequence = editor.config.get('codeBlock.indentSequence') as string;
  }

  public override refresh(): void {
    this.isEnabled = this._checkEnabled();
  }

  public override execute(): void {
    const editor = this.editor;
    const model = editor.model;
    model.change(writer => {
      const positions = getIndentOutdentPositions(model);
      for (const position of positions) {
        const indentSequenceTextElement = writer.createText(this._indentSequence);
        model.insertContent(indentSequenceTextElement, position);
      }
    });
  }

  private _checkEnabled(): boolean {
    if (!this._indentSequence) return false;
    const model = this.editor.model;
    return isModelSelectionInCodeBlock(model.document.selection);
  }
}

export class OutdentCodeBlockCommand extends Command {
  private _indentSequence: string;

  constructor(editor: Editor) {
    super(editor);
    this._indentSequence = editor.config.get('codeBlock.indentSequence') as string;
  }

  public override refresh(): void {
    this.isEnabled = this._checkEnabled();
  }

  public override execute(): void {
    const editor = this.editor;
    const model = editor.model;
    model.change(writer => {
      const positions = getIndentOutdentPositions(model);
      for (const position of positions) {
        const range = getLastOutdentableSequenceRange(model, position, this._indentSequence);
        if (range) writer.remove(range);
      }
    });
  }

  private _checkEnabled(): boolean {
    if (!this._indentSequence) return false;
    const model = this.editor.model;
    if (!isModelSelectionInCodeBlock(model.document.selection)) return false;
    return getIndentOutdentPositions(model).some(position => getLastOutdentableSequenceRange(model, position, this._indentSequence));
  }
}

function getIndentOutdentPositions(model: any): any[] {
  const selection = model.document.selection;
  const positions: any[] = [];
  if (selection.isCollapsed) {
    return [selection.anchor];
  }
  const walker = selection.getFirstRange().getWalker({ ignoreElementEnd: true });
  for (const { item } of walker) {
    if (item.is('$textProxy') || item.is('element', 'softBreak')) {
      const codeBlock = item.parent;
      if (!codeBlock.is('element', 'codeBlock')) continue;
      if (item.is('element', 'softBreak')) {
        positions.push(model.createPositionAfter(item));
      } else if (!positions.length || !positions[positions.length - 1].isEqual(model.createPositionAt(codeBlock, 0))) {
        const lineStart = getLineStartPosition(model, item);
        if (!positions.some(p => p.isEqual(lineStart))) positions.push(lineStart);
      }
    }
  }
  return positions.map(position => {
    const lineStart = getLineStartPosition(model, position);
    return lineStart;
  }).filter((position, index, all) => all.findIndex(p => p.isEqual(position)) === index);
}

function getLineStartPosition(model: any, itemOrPosition: any): any {
  let position = itemOrPosition.is && itemOrPosition.is('position') ? itemOrPosition : model.createPositionBefore(itemOrPosition.textNode || itemOrPosition);
  const codeBlock = position.parent;
  const walker = model.createRange(model.createPositionAt(codeBlock, 0), position).getWalker({ direction: 'backward', ignoreElementEnd: true });
  for (const { item, nextPosition } of walker) {
    if (item.is('element', 'softBreak')) {
      return model.createPositionAfter(item);
    }
    void nextPosition;
  }
  return model.createPositionAt(codeBlock, 0);
}

function getLastOutdentableSequenceRange(model: any, position: any, sequence: string): any {
  const nodeAtPosition = getCodeLineTextNodeAtPosition(position);
  if (!nodeAtPosition) return null;
  const leadingWhiteSpaces = getLeadingWhiteSpaces(nodeAtPosition);
  const lastIndexOfSequence = leadingWhiteSpaces.lastIndexOf(sequence);
  if (lastIndexOfSequence + sequence.length !== leadingWhiteSpaces.length) return null;
  if (lastIndexOfSequence === -1) return null;
  const { parent, startOffset } = nodeAtPosition;
  return model.createRange(model.createPositionAt(parent, startOffset + lastIndexOfSequence), model.createPositionAt(parent, startOffset + lastIndexOfSequence + sequence.length));
}

function getCodeLineTextNodeAtPosition(position: any): any {
  let nodeAtPosition = position.parent.getChild(position.index);
  if (!nodeAtPosition || nodeAtPosition.is('element', 'softBreak')) {
    nodeAtPosition = position.nodeBefore;
  }
  if (!nodeAtPosition || nodeAtPosition.is('element', 'softBreak')) return null;
  return nodeAtPosition;
}

function isModelSelectionInCodeBlock(selection: any): boolean {
  const firstBlock = first(selection.getSelectedBlocks()) as ModelElement | null;
  return !!firstBlock && firstBlock.is('element', 'codeBlock');
}

export class CodeBlockEditing extends Plugin {
  public static override get pluginName(): string {
    return 'CodeBlockEditing';
  }

  public static override get requires() {
    return [ShiftEnter];
  }

  constructor(editor: Editor) {
    super(editor);
    editor.config.define('codeBlock', { languages: DEFAULT_LANGUAGES, indentSequence: '\t' });
  }

  public override init(): void {
    const editor = this.editor;
    const schema = editor.model.schema;
    const model = editor.model;
    const view = editor.editing.view;
    const normalizedLanguagesDefs = getNormalizedAndLocalizedLanguageDefinitions(editor);
    const languageToClass = getPropertyAssociation(normalizedLanguagesDefs, 'language', 'class');
    const classToLanguage = getPropertyAssociation(normalizedLanguagesDefs, 'class', 'language');

    editor.commands.add('codeBlock', new CodeBlockCommand(editor));
    editor.commands.add('indentCodeBlock', new IndentCodeBlockCommand(editor));
    editor.commands.add('outdentCodeBlock', new OutdentCodeBlockCommand(editor));

    this.listenTo(view.document, 'tab', (evt, data: any) => {
      const commandName = data.shiftKey ? 'outdentCodeBlock' : 'indentCodeBlock';
      const command = editor.commands.get(commandName)!;
      if (!command.isEnabled) return;
      editor.execute(commandName);
      data.stopPropagation();
      data.preventDefault();
      evt.stop();
    }, { context: 'pre' });

    schema.register('codeBlock', { allowWhere: '$block', allowChildren: '$text', isBlock: true, allowAttributes: ['language'] });
    schema.addAttributeCheck((context, attributeName) => {
      if (context.endsWith('codeBlock $text') && attributeName !== 'language') return false;
      return undefined;
    });
    schema.addChildCheck((context, childDefinition) => {
      if (context.endsWith('codeBlock') && childDefinition.isObject) return false;
      return undefined;
    });
    schema.extend('softBreak', { allowIn: 'codeBlock' });

    editor.conversion.for('editingDowncast').elementToElement({
      model: 'codeBlock',
      view: (modelElement, { writer }) => {
        const languageAttr = String(modelElement.getAttribute('language'));
        const pre = writer.createContainerElement('pre', { 'data-language': getLabelForLanguage(normalizedLanguagesDefs, languageAttr), spellcheck: 'false' });
        const code = writer.createContainerElement('code', languageToClass[languageAttr] ? { class: languageToClass[languageAttr] } : {});
        writer.insert(writer.createPositionAt(pre, 0), code);
        return pre;
      }
    });
    editor.conversion.for('dataDowncast').elementToElement({
      model: 'codeBlock',
      view: (modelElement, { writer }) => {
        const languageAttr = String(modelElement.getAttribute('language'));
        const pre = writer.createContainerElement('pre');
        const code = writer.createContainerElement('code', languageToClass[languageAttr] ? { class: languageToClass[languageAttr] } : {});
        writer.insert(writer.createPositionAt(pre, 0), code);
        return pre;
      }
    });
    // Soft breaks inside code blocks are serialized as new lines in the data output.
    editor.data.downcastDispatcher.on('insert:softBreak', (evt: any, data: any, conversionApi: any) => {
      const parent = data.item.parent;
      if (!parent || !parent.is('element', 'codeBlock')) return;
      if (!conversionApi.consumable.consume(data.item, 'insert')) return;
      const writer = conversionApi.writer;
      const position = conversionApi.mapper.toViewPosition(model.createPositionBefore(data.item));
      writer.insert(position, writer.createText(String.fromCharCode(10)));
    }, { priority: 'high' });
    // Children of codeBlock live in <code>, not directly in <pre>.
    editor.editing.mapper.on('modelToViewPosition', mapCodeBlockPosition(), { priority: 'high' });
    editor.data.mapper.on('modelToViewPosition', mapCodeBlockPosition(), { priority: 'high' });

    editor.conversion.for('upcast').elementToElement({
      view: 'pre',
      model: (viewElement, { writer }) => {
        const codeElement = Array.from(viewElement.getChildren()).find((c: any) => c.is('element', 'code')) as any;
        const classes = (codeElement ? Array.from(codeElement.getClassNames()) : []) as string[];
        let language = normalizedLanguagesDefs[0].language;
        for (const cls of classes) {
          const alias = LANGUAGE_ALIASES[cls.replace(/^language-/, '')];
          const match = classToLanguage[cls] || (alias && classToLanguage[`language-${alias}`]);
          if (match) {
            language = match;
            break;
          }
        }
        return writer.createElement('codeBlock', { language });
      },
      converterPriority: 'high'
    });
    editor.conversion.for('upcast').add(dispatcher => {
      dispatcher.on('element:code', (evt: any, data: any, conversionApi: any) => {
        const parent = data.viewItem.parent;
        if (parent && parent.is('element', 'pre')) {
          conversionApi.consumable.consume(data.viewItem, { name: true });
          const { modelRange, modelCursor } = conversionApi.convertChildren(data.viewItem, data.modelCursor);
          data.modelRange = modelRange;
          data.modelCursor = modelCursor;
        }
      }, { priority: 'high' });
      // Convert text with new lines inside code blocks into softBreaks.
      dispatcher.on('text', (evt: any, data: any, conversionApi: any) => {
        const parent = data.modelCursor.parent;
        if (!parent || !parent.is('element', 'codeBlock')) return;
        if (!conversionApi.consumable.consume(data.viewItem)) return;
        const writer = conversionApi.writer;
        const lines = data.viewItem.data.replace(/\r?\n$/, '').split(/\r?\n/);
        let position = data.modelCursor;
        lines.forEach((line: string, index: number) => {
          if (line) {
            const text = writer.createText(line);
            writer.insert(text, position);
            position = position.getShiftedBy(text.offsetSize);
          }
          if (index < lines.length - 1) {
            const softBreak = writer.createElement('softBreak');
            writer.insert(softBreak, position);
            position = position.getShiftedBy(1);
          }
        });
        data.modelRange = writer.createRange(data.modelCursor, position);
        data.modelCursor = position;
      }, { priority: 'high' });
    });

    // Enter: insert a soft break; double Enter at the end leaves the block.
    this.listenTo(view.document, 'enter', (evt, data: any) => {
      const positionParent = model.document.selection.getLastPosition()!.parent as ModelElement;
      if (!positionParent.is('element', 'codeBlock')) return;
      if (!leaveBlockEndOnEnter(editor, data.isSoft) && !leaveBlockStartOnEnter(editor, data.isSoft)) {
        breakLineOnEnter(editor);
      }
      data.preventDefault();
      evt.stop();
    }, { context: 'pre' });

    // Paste into a code block as plain text.
    const clipboardPipeline = editor.plugins.has('ClipboardPipeline') ? editor.plugins.get('ClipboardPipeline') : null;
    if (clipboardPipeline) {
      this.listenTo(clipboardPipeline as any, 'inputTransformation', (evt, data: any) => {
        const modelSelection = model.document.selection;
        if (!modelSelection.anchor!.parent.is('element', 'codeBlock')) return;
        const text = data.dataTransfer.getData('text/plain');
        const writer = new (require_writer())(view.document);
        data.content = rawSnippetTextToViewDocumentFragment(writer, text);
      });
    }
  }

  public override afterInit(): void {
    const editor = this.editor;
    const commands = editor.commands;
    const indent = commands.get('indent') as any;
    const outdent = commands.get('outdent') as any;
    if (indent && indent.registerChildCommand) {
      indent.registerChildCommand(commands.get('indentCodeBlock'), { priority: 'highest' });
    }
    if (outdent && outdent.registerChildCommand) {
      outdent.registerChildCommand(commands.get('outdentCodeBlock'), { priority: 'highest' });
    }
    void keyCodes;
  }
}

function mapCodeBlockPosition() {
  return (evt: any, data: any) => {
    if (data.viewPosition) return;
    const parent = data.modelPosition.parent;
    if (!parent || !parent.is || !parent.is('element', 'codeBlock')) return;
    const viewPre = data.mapper.toViewElement(parent);
    if (!viewPre) return;
    const code = Array.from(viewPre.getChildren()).find((c: any) => c.is('element', 'code'));
    if (!code) return;
    data.viewPosition = data.mapper.findPositionIn(code, data.modelPosition.offset);
  };
}

function getLabelForLanguage(defs: CodeBlockLanguageDefinition[], language: string): string {
  const def = defs.find(d => d.language === language);
  return def ? def.label : language;
}

function breakLineOnEnter(editor: Editor): void {
  const model = editor.model;
  const modelDoc = model.document;
  const lastSelectionPosition = modelDoc.selection.getLastPosition()!;
  const node = lastSelectionPosition.nodeBefore || lastSelectionPosition.textNode;
  let leadingWhiteSpaces: string | undefined;
  if (node && (node as any).is('$text')) {
    leadingWhiteSpaces = getLeadingWhiteSpaces(node);
  }
  editor.model.change(writer => {
    editor.execute('shiftEnter');
    if (leadingWhiteSpaces) {
      writer.insertText(leadingWhiteSpaces, modelDoc.selection.anchor!);
    }
  });
}

function leaveBlockStartOnEnter(editor: Editor, isSoftEnter: boolean): boolean {
  const model = editor.model;
  const modelDoc = model.document;
  const view = editor.editing.view;
  const lastSelectionPosition = modelDoc.selection.getLastPosition()!;
  const nodeAfter = lastSelectionPosition.nodeAfter;
  if (isSoftEnter || !modelDoc.selection.isCollapsed || !lastSelectionPosition.isAtStart) return false;
  if (!isSoftBreakNode(nodeAfter)) return false;
  editor.model.change(writer => {
    editor.execute('enter');
    const newBlock = modelDoc.selection.anchor!.parent.previousSibling as ModelElement;
    writer.rename(newBlock, 'paragraph');
    writer.setSelection(newBlock, 'in');
    editor.model.schema.removeDisallowedAttributes([newBlock], writer);
    writer.remove(nodeAfter as any);
  });
  view.scrollToTheSelection();
  return true;
}

function leaveBlockEndOnEnter(editor: Editor, isSoftEnter: boolean): boolean {
  const model = editor.model;
  const modelDoc = model.document;
  const view = editor.editing.view;
  const lastSelectionPosition = modelDoc.selection.getLastPosition()!;
  const nodeBefore = lastSelectionPosition.nodeBefore;
  let emptyLineRangeToRemoveOnEnter: any;
  if (isSoftEnter || !modelDoc.selection.isCollapsed || !lastSelectionPosition.isAtEnd || !nodeBefore || !nodeBefore.previousSibling) {
    return false;
  }
  if (isSoftBreakNode(nodeBefore) && isSoftBreakNode(nodeBefore.previousSibling)) {
    emptyLineRangeToRemoveOnEnter = model.createRange(model.createPositionBefore(nodeBefore.previousSibling), model.createPositionAfter(nodeBefore));
  } else if (isEmptyishTextNode(nodeBefore) && isSoftBreakNode(nodeBefore.previousSibling) && isSoftBreakNode(nodeBefore.previousSibling.previousSibling)) {
    emptyLineRangeToRemoveOnEnter = model.createRange(model.createPositionBefore(nodeBefore.previousSibling.previousSibling!), model.createPositionAfter(nodeBefore));
  } else if (isEmptyishTextNode(nodeBefore) && isSoftBreakNode(nodeBefore.previousSibling) && isEmptyishTextNode(nodeBefore.previousSibling.previousSibling) && nodeBefore.previousSibling.previousSibling && isSoftBreakNode(nodeBefore.previousSibling.previousSibling.previousSibling)) {
    emptyLineRangeToRemoveOnEnter = model.createRange(model.createPositionBefore(nodeBefore.previousSibling.previousSibling.previousSibling!), model.createPositionAfter(nodeBefore));
  } else {
    return false;
  }
  editor.model.change(writer => {
    writer.remove(emptyLineRangeToRemoveOnEnter);
    editor.execute('enter');
    const newBlock = modelDoc.selection.anchor!.parent as ModelElement;
    writer.rename(newBlock, 'paragraph');
    editor.model.schema.removeDisallowedAttributes([newBlock], writer);
  });
  view.scrollToTheSelection();
  return true;
}

function isSoftBreakNode(node: any): boolean {
  return !!node && node.is('element', 'softBreak');
}

function isEmptyishTextNode(node: any): boolean {
  return !!node && node.is('$text') && !node.data.match(/\S/);
}

function rawSnippetTextToViewDocumentFragment(writer: any, text: string): any {
  const fragment = writer.createDocumentFragment();
  const textLines = text.split('\n');
  const nodes = textLines.reduce((nodes: any[], line: string, lineIndex: number) => {
    nodes.push(line);
    if (lineIndex < textLines.length - 1) {
      nodes.push(writer.createElement('br'));
    }
    return nodes;
  }, []);
  writer.appendChild(nodes, fragment);
  return fragment;
}

import { UpcastWriter } from '../../engine/view/upcastwriter';
function require_writer(): typeof UpcastWriter {
  return UpcastWriter;
}

export class CodeBlockUI extends Plugin {
  public static override get pluginName(): string {
    return 'CodeBlockUI';
  }

  public override init(): void {
    const editor = this.editor;
    const t = editor.t;
    const componentFactory = editor.ui.componentFactory;
    const normalizedLanguageDefs = getNormalizedAndLocalizedLanguageDefinitions(editor);
    componentFactory.add('codeBlock', locale => {
      const command = editor.commands.get('codeBlock')!;
      const dropdownView = createDropdown(locale, SplitButtonView);
      const splitButtonView = dropdownView.buttonView as SplitButtonView;
      const accessibleLabel = t('Insert code block');
      splitButtonView.set({ label: accessibleLabel, tooltip: true, icon: icons.codeBlock, isToggleable: true });
      splitButtonView.bind('isOn').to(command, 'value', (value: unknown) => !!value);
      splitButtonView.on('execute', () => {
        editor.execute('codeBlock', { usePreviousLanguageChoice: true });
        editor.editing.view.focus();
      });
      dropdownView.on('execute', (evt: any) => {
        editor.execute('codeBlock', { language: evt.source._codeBlockLanguage, forceValue: true });
        editor.editing.view.focus();
      });
      dropdownView.class = 'ck-code-block-dropdown';
      dropdownView.bind('isEnabled').to(command);
      addListToDropdown(dropdownView, () => this._getLanguageListItemDefinitions(normalizedLanguageDefs), { role: 'menu', ariaLabel: accessibleLabel });
      return dropdownView;
    });
  }

  private _getLanguageListItemDefinitions(normalizedLanguageDefs: CodeBlockLanguageDefinition[]): Collection<ListDropdownItemDefinition> {
    const editor = this.editor;
    const command = editor.commands.get('codeBlock')!;
    const itemDefinitions = new Collection<ListDropdownItemDefinition>();
    for (const languageDef of normalizedLanguageDefs) {
      const definition: ListDropdownItemDefinition = { type: 'button', model: new Observable() as any };
      definition.model!.set({ _codeBlockLanguage: languageDef.language, label: languageDef.label, role: 'menuitemradio', withText: true } as any);
      definition.model!.bind('isOn').to(command, 'value', (value: unknown) => value === languageDef.language);
      itemDefinitions.add(definition);
    }
    return itemDefinitions;
  }
}

export class CodeBlock extends Plugin {
  public static override get requires() {
    return [CodeBlockEditing, CodeBlockUI];
  }

  public static override get pluginName(): string {
    return 'CodeBlock';
  }
}
