import { Plugin } from '../../core/plugin';
import { Command } from '../../core/command';
import { Paragraph } from '../paragraph/paragraph';
import { createDropdown, addListToDropdown, type ListDropdownItemDefinition } from '../../ui/dropdown/dropdownview';
import { Collection } from '../../utils/collection';
import { Observable } from '../../utils/observable';
import { first } from '../../utils/misc';
import { priorities } from '../../utils/priorities';
import type { Editor } from '../../core/editor';
import type { Element } from '../../engine/model/element';
import type { ElementDefinition } from '../../engine/conversion/downcasthelpers';

export interface HeadingOption {
  model: string;
  view?: string | ElementDefinition;
  title: string;
  class: string;
  icon?: string;
  upcastAlso?: any;
  converterPriority?: any;
}

const defaultModelElement = 'paragraph';

/** Changes selected blocks to the given heading model element. */
export class HeadingCommand extends Command {
  public readonly modelElements: string[];

  constructor(editor: Editor, modelElements: string[]) {
    super(editor);
    this.modelElements = modelElements;
  }

  public override refresh(): void {
    const block = first(this.editor.model.document.selection.getSelectedBlocks());
    this.value = !!block && this.modelElements.includes(block.name) && block.name;
    this.isEnabled = !!block && this.modelElements.some(heading => checkCanBecomeHeading(block, heading, this.editor.model.schema));
  }

  public override execute(options: { value: string }): void {
    const model = this.editor.model;
    const document = model.document;
    const modelElement = options.value;
    model.change(writer => {
      const blocks = Array.from(document.selection.getSelectedBlocks()).filter(block => checkCanBecomeHeading(block, modelElement, model.schema));
      for (const block of blocks) {
        if (!block.is('element', modelElement)) {
          writer.rename(block, modelElement);
        }
      }
    });
  }
}

function checkCanBecomeHeading(block: Element, heading: string, schema: any): boolean {
  return schema.checkChild(block.parent as Element, heading) && !schema.isObject(block);
}

export class HeadingEditing extends Plugin {
  public static override get pluginName(): string {
    return 'HeadingEditing';
  }

  public static override get requires() {
    return [Paragraph];
  }

  constructor(editor: Editor) {
    super(editor);
    editor.config.define('heading', {
      options: [
        { model: 'paragraph', title: 'Paragraph', class: 'ck-heading_paragraph' },
        { model: 'heading1', view: 'h2', title: 'Heading 1', class: 'ck-heading_heading1' },
        { model: 'heading2', view: 'h3', title: 'Heading 2', class: 'ck-heading_heading2' },
        { model: 'heading3', view: 'h4', title: 'Heading 3', class: 'ck-heading_heading3' }
      ]
    });
  }

  public override init(): void {
    const editor = this.editor;
    const options = editor.config.get('heading.options') as HeadingOption[];
    const modelElements: string[] = [];
    for (const option of options) {
      if (option.model !== defaultModelElement) {
        editor.model.schema.register(option.model, { inheritAllFrom: '$block' });
        editor.conversion.elementToElement(option as any);
        modelElements.push(option.model);
      }
    }
    this._addDefaultH1Conversion(editor);
    editor.commands.add('heading', new HeadingCommand(editor, modelElements));
  }

  public override afterInit(): void {
    const editor = this.editor;
    const enterCommand = editor.commands.get('enter');
    const options = editor.config.get('heading.options') as HeadingOption[];
    if (enterCommand) {
      this.listenTo(enterCommand, 'afterExecute', (evt, data: any) => {
        const positionParent = editor.model.document.selection.getFirstPosition()!.parent as Element;
        const isHeading = options.some(option => positionParent.is('element', option.model));
        if (isHeading && !positionParent.is('element', defaultModelElement) && positionParent.childCount === 0) {
          data.writer.rename(positionParent, defaultModelElement);
        }
      });
    }
  }

  private _addDefaultH1Conversion(editor: Editor): void {
    editor.conversion.for('upcast').elementToElement({
      model: 'heading1',
      view: 'h1',
      converterPriority: priorities.get('low') + 1 as any
    });
  }
}

export class HeadingUI extends Plugin {
  public static override get pluginName(): string {
    return 'HeadingUI';
  }

  public override init(): void {
    const editor = this.editor;
    const t = editor.t;
    const options = getLocalizedOptions(editor);
    const defaultTitle = t('Choose heading');
    const accessibleLabel = t('Heading');

    editor.ui.componentFactory.add('heading', locale => {
      const titles: Record<string, string> = {};
      const itemDefinitions = new Collection<ListDropdownItemDefinition>();
      const headingCommand = editor.commands.get('heading')!;
      const paragraphCommand = editor.commands.get('paragraph')!;
      const commands = [headingCommand];

      for (const option of options) {
        const def: ListDropdownItemDefinition = { type: 'button', model: new Observable() as any };
        def.model!.set({ label: option.title, class: option.class, role: 'menuitemradio', withText: true });
        if (option.model === 'paragraph') {
          def.model!.bind('isOn').to(paragraphCommand, 'value');
          (def.model as any).commandName = 'paragraph';
          commands.push(paragraphCommand);
        } else {
          def.model!.bind('isOn').to(headingCommand, 'value', (value: unknown) => value === option.model);
          (def.model as any).commandName = 'heading';
          (def.model as any).commandValue = option.model;
        }
        itemDefinitions.add(def);
        titles[option.model] = option.title;
      }

      const dropdownView = createDropdown(locale);
      addListToDropdown(dropdownView, itemDefinitions, { ariaLabel: accessibleLabel, role: 'menu' });
      dropdownView.buttonView.set({ ariaLabel: accessibleLabel, ariaLabelledBy: undefined, isOn: false, withText: true, tooltip: accessibleLabel });
      dropdownView.extendTemplate({ attributes: { class: ['ck-heading-dropdown'] } });
      dropdownView.bind('isEnabled').toMany(commands, 'isEnabled', (...areEnabled: boolean[]) => areEnabled.some(isEnabled => isEnabled));
      (dropdownView.buttonView as any).bind('label').to(headingCommand, 'value', paragraphCommand, 'value', (value: unknown, para: unknown) => {
        const whichModel = value || (para && 'paragraph');
        if (typeof whichModel === 'boolean') return defaultTitle;
        if (!titles[whichModel as string]) return defaultTitle;
        return titles[whichModel as string];
      });
      this.listenTo(dropdownView, 'execute', (evt: any) => {
        const { commandName, commandValue } = evt.source;
        editor.execute(commandName, commandValue ? { value: commandValue } : undefined);
        editor.editing.view.focus();
      });
      return dropdownView;
    });
  }
}

function getLocalizedOptions(editor: Editor): HeadingOption[] {
  const t = editor.t;
  const localizedTitles: Record<string, string> = {
    Paragraph: t('Paragraph'),
    'Heading 1': t('Heading 1'),
    'Heading 2': t('Heading 2'),
    'Heading 3': t('Heading 3'),
    'Heading 4': t('Heading 4'),
    'Heading 5': t('Heading 5'),
    'Heading 6': t('Heading 6')
  };
  return (editor.config.get('heading.options') as HeadingOption[]).map(option => {
    const title = localizedTitles[option.title];
    if (title && title !== option.title) option.title = title;
    return option;
  });
}

export class Heading extends Plugin {
  public static override get requires() {
    return [HeadingEditing, HeadingUI];
  }

  public static override get pluginName(): string {
    return 'Heading';
  }
}
