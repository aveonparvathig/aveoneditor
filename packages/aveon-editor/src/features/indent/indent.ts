import { Plugin } from '../../core/plugin';
import { Command } from '../../core/command';
import { MultiCommand } from '../../core/multicommand';
import { ButtonView } from '../../ui/button/buttonview';
import { icons } from '../../ui/icons';
import { first } from '../../utils/misc';
import type { Editor } from '../../core/editor';
import type { Element } from '../../engine/model/element';

/** Registers the `indent` and `outdent` multi-commands (lists and blocks register as children). */
export class IndentEditing extends Plugin {
  public static override get pluginName(): string {
    return 'IndentEditing';
  }

  public override init(): void {
    const editor = this.editor;
    editor.commands.add('indent', new MultiCommand(editor));
    editor.commands.add('outdent', new MultiCommand(editor));
  }
}

export class IndentUI extends Plugin {
  public static override get pluginName(): string {
    return 'IndentUI';
  }

  public override init(): void {
    const editor = this.editor;
    const locale = editor.locale;
    const t = editor.t;
    const localizedIndentIcon = locale.uiLanguageDirection === 'ltr' ? icons.indent : icons.outdent;
    const localizedOutdentIcon = locale.uiLanguageDirection === 'ltr' ? icons.outdent : icons.indent;
    this._defineButton('indent', t('Increase indent'), localizedIndentIcon);
    this._defineButton('outdent', t('Decrease indent'), localizedOutdentIcon);
  }

  private _defineButton(commandName: string, label: string, icon: string): void {
    const editor = this.editor;
    editor.ui.componentFactory.add(commandName, locale => {
      const command = editor.commands.get(commandName)!;
      const view = new ButtonView(locale);
      view.set({ label, icon, tooltip: true });
      view.bind('isEnabled').to(command, 'isEnabled');
      this.listenTo(view, 'execute', () => {
        editor.execute(commandName);
        editor.editing.view.focus();
      });
      return view;
    });
  }
}

export class Indent extends Plugin {
  public static override get pluginName(): string {
    return 'Indent';
  }

  public static override get requires() {
    return [IndentEditing, IndentUI];
  }
}

interface IndentBehavior {
  checkEnabled(value: string | undefined): boolean;
  getNextIndent(value: string | undefined): string | undefined;
}

/** Indents blocks by changing their `blockIndent` attribute. */
export class IndentBlockCommand extends Command {
  private readonly _indentBehavior: IndentBehavior;

  constructor(editor: Editor, indentBehavior: IndentBehavior) {
    super(editor);
    this._indentBehavior = indentBehavior;
  }

  public override refresh(): void {
    const editor = this.editor;
    const model = editor.model;
    const block = first(model.document.selection.getSelectedBlocks());
    if (!block || !model.schema.checkAttribute(block, 'blockIndent')) {
      this.isEnabled = false;
      return;
    }
    this.isEnabled = this._indentBehavior.checkEnabled(block.getAttribute('blockIndent') as string | undefined);
  }

  public override execute(): void {
    const model = this.editor.model;
    const blocksToChange = getBlocksToChange(model);
    model.change(writer => {
      for (const block of blocksToChange) {
        const currentIndent = block.getAttribute('blockIndent') as string | undefined;
        const nextIndent = this._indentBehavior.getNextIndent(currentIndent);
        if (nextIndent) {
          writer.setAttribute('blockIndent', nextIndent, block);
        } else {
          writer.removeAttribute('blockIndent', block);
        }
      }
    });
  }
}

function getBlocksToChange(model: any): Element[] {
  const selection = model.document.selection;
  const schema = model.schema;
  const blocksInSelection = Array.from(selection.getSelectedBlocks()) as Element[];
  return blocksInSelection.filter(block => schema.checkAttribute(block, 'blockIndent'));
}

class IndentUsingOffset implements IndentBehavior {
  public readonly isForward: boolean;
  public readonly offset: number;
  public readonly unit: string;

  constructor(config: { direction: 'forward' | 'backward'; offset: number; unit: string }) {
    this.isForward = config.direction === 'forward';
    this.offset = config.offset;
    this.unit = config.unit;
  }

  public checkEnabled(indentAttributeValue: string | undefined): boolean {
    const currentOffset = parseFloat(indentAttributeValue || '0');
    return this.isForward || currentOffset > 0;
  }

  public getNextIndent(indentAttributeValue: string | undefined): string | undefined {
    const currentOffset = parseFloat(indentAttributeValue || '0');
    const isSameUnit = !indentAttributeValue || indentAttributeValue.endsWith(this.unit);
    if (!isSameUnit) return this.isForward ? this.offset + this.unit : undefined;
    const nextOffset = this.isForward ? this.offset : -this.offset;
    const offsetToSet = currentOffset + nextOffset;
    return offsetToSet > 0 ? offsetToSet + this.unit : undefined;
  }
}

class IndentUsingClasses implements IndentBehavior {
  public readonly isForward: boolean;
  public readonly classes: string[];

  constructor(config: { direction: 'forward' | 'backward'; classes: string[] }) {
    this.isForward = config.direction === 'forward';
    this.classes = config.classes;
  }

  public checkEnabled(indentAttributeValue: string | undefined): boolean {
    const currentIndex = this.classes.indexOf(indentAttributeValue || '');
    if (this.isForward) return currentIndex < this.classes.length - 1;
    return currentIndex >= 0;
  }

  public getNextIndent(indentAttributeValue: string | undefined): string | undefined {
    const currentIndex = this.classes.indexOf(indentAttributeValue || '');
    const indexStep = this.isForward ? 1 : -1;
    return this.classes[currentIndex + indexStep];
  }
}

export class IndentBlock extends Plugin {
  public static override get pluginName(): string {
    return 'IndentBlock';
  }

  constructor(editor: Editor) {
    super(editor);
    editor.config.define('indentBlock', { offset: 40, unit: 'px' });
  }

  public override init(): void {
    const editor = this.editor;
    const configuration = editor.config.get('indentBlock') as { offset?: number; unit?: string; classes?: string[] };
    if (configuration.classes && configuration.classes.length) {
      this._setupConversionUsingClasses(configuration.classes);
      editor.commands.add('indentBlock', new IndentBlockCommand(editor, new IndentUsingClasses({ direction: 'forward', classes: configuration.classes })));
      editor.commands.add('outdentBlock', new IndentBlockCommand(editor, new IndentUsingClasses({ direction: 'backward', classes: configuration.classes })));
    } else {
      editor.data.addStyleProcessorRules(null);
      this._setupConversionUsingOffset();
      editor.commands.add('indentBlock', new IndentBlockCommand(editor, new IndentUsingOffset({ direction: 'forward', offset: configuration.offset!, unit: configuration.unit! })));
      editor.commands.add('outdentBlock', new IndentBlockCommand(editor, new IndentUsingOffset({ direction: 'backward', offset: configuration.offset!, unit: configuration.unit! })));
    }
  }

  public override afterInit(): void {
    const editor = this.editor;
    const schema = editor.model.schema;
    const indentCommand = editor.commands.get('indent') as MultiCommand | undefined;
    const outdentCommand = editor.commands.get('outdent') as MultiCommand | undefined;
    const knownElements = ['paragraph', 'heading1', 'heading2', 'heading3', 'heading4', 'heading5', 'heading6'];
    knownElements.forEach(elementName => {
      if (schema.isRegistered(elementName)) {
        schema.extend(elementName, { allowAttributes: 'blockIndent' });
      }
    });
    schema.setAttributeProperties('blockIndent', { isFormatting: true });
    if (indentCommand) indentCommand.registerChildCommand(editor.commands.get('indentBlock')!);
    if (outdentCommand) outdentCommand.registerChildCommand(editor.commands.get('outdentBlock')!);
  }

  private _setupConversionUsingOffset(): void {
    const conversion = this.editor.conversion;
    const locale = this.editor.locale;
    const marginProperty = locale.contentLanguageDirection === 'rtl' ? 'margin-right' : 'margin-left';
    conversion.for('upcast').attributeToAttribute({
      view: { styles: { [marginProperty]: /[\s\S]+/ } },
      model: { key: 'blockIndent', value: (viewElement: any) => viewElement.getStyle(marginProperty) }
    });
    conversion.for('downcast').attributeToAttribute({
      model: 'blockIndent',
      view: (modelAttributeValue: unknown) => ({ key: 'style', value: { [marginProperty]: modelAttributeValue as string } })
    });
  }

  private _setupConversionUsingClasses(classes: string[]): void {
    const definition = { model: { key: 'blockIndent', values: [] as string[] }, view: {} as Record<string, { key: string; value: string[] }> };
    for (const className of classes) {
      definition.model.values.push(className);
      definition.view[className] = { key: 'class', value: [className] };
    }
    this.editor.conversion.attributeToAttribute(definition);
  }
}
