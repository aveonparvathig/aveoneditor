import { Plugin } from '../../core/plugin';
import { Command } from '../../core/command';
import { ButtonView } from '../../ui/button/buttonview';
import { createDropdown, addToolbarToDropdown } from '../../ui/dropdown/dropdownview';
import { icons } from '../../ui/icons';
import { first } from '../../utils/misc';
import type { Editor } from '../../core/editor';
import type { Element } from '../../engine/model/element';
import type { Locale } from '../../utils/locale';

export const supportedOptions = ['left', 'right', 'center', 'justify'] as const;
export type AlignmentValue = (typeof supportedOptions)[number];

export function isSupported(option: string): boolean {
  return (supportedOptions as readonly string[]).includes(option);
}

export function isDefault(alignment: string, locale: Locale): boolean {
  if (locale.contentLanguageDirection === 'rtl') return alignment === 'right';
  return alignment === 'left';
}

/** Sets text alignment of selected blocks. */
export class AlignmentCommand extends Command {
  public override refresh(): void {
    const editor = this.editor;
    const locale = editor.locale;
    const firstBlock = first(editor.model.document.selection.getSelectedBlocks());
    this.isEnabled = !!firstBlock && this._canBeAligned(firstBlock);
    if (this.isEnabled && firstBlock!.hasAttribute('alignment')) {
      this.value = firstBlock!.getAttribute('alignment');
    } else {
      this.value = locale.contentLanguageDirection === 'rtl' ? 'right' : 'left';
    }
  }

  public override execute(options: { value?: AlignmentValue } = {}): void {
    const editor = this.editor;
    const locale = editor.locale;
    const model = editor.model;
    const doc = model.document;
    const value = options.value;
    model.change(writer => {
      const blocks = Array.from(doc.selection.getSelectedBlocks()).filter(block => this._canBeAligned(block));
      const currentAlignment = blocks[0].getAttribute('alignment');
      const removeAlignment = !value || isDefault(value, locale) || currentAlignment === value;
      if (removeAlignment) {
        for (const block of blocks) writer.removeAttribute('alignment', block);
      } else {
        for (const block of blocks) writer.setAttribute('alignment', value, block);
      }
    });
  }

  private _canBeAligned(block: Element): boolean {
    return this.editor.model.schema.checkAttribute(block, 'alignment');
  }
}

export class AlignmentEditing extends Plugin {
  public static override get pluginName(): string {
    return 'AlignmentEditing';
  }

  constructor(editor: Editor) {
    super(editor);
    editor.config.define('alignment', { options: [...supportedOptions.map(option => ({ name: option }))] });
  }

  public override init(): void {
    const editor = this.editor;
    const locale = editor.locale;
    const schema = editor.model.schema;
    const options = normalizeAlignmentOptions(editor.config.get('alignment.options') as any[]);
    const optionsToConvert = options.filter(option => isSupported(option.name) && !isDefault(option.name, locale));
    const shouldUseClasses = optionsToConvert.some(option => !!option.className);

    schema.extend('$block', { allowAttributes: 'alignment' });
    editor.model.schema.setAttributeProperties('alignment', { isFormatting: true });

    if (shouldUseClasses) {
      const definition = { model: { key: 'alignment', values: optionsToConvert.map(option => option.name) }, view: {} as Record<string, any> };
      for (const option of optionsToConvert) {
        definition.view[option.name] = { key: 'class', value: option.className };
      }
      editor.conversion.attributeToAttribute(definition);
    } else {
      const definition = { model: { key: 'alignment', values: optionsToConvert.map(option => option.name) }, view: {} as Record<string, any> };
      for (const option of optionsToConvert) {
        definition.view[option.name] = { key: 'style', value: { 'text-align': option.name } };
      }
      editor.conversion.attributeToAttribute(definition);
    }
    editor.commands.add('alignment', new AlignmentCommand(editor));
  }
}

export function normalizeAlignmentOptions(configuredOptions: Array<string | { name: string; className?: string }>): Array<{ name: string; className?: string }> {
  const normalizedOptions = configuredOptions.map(option => (typeof option === 'string' ? { name: option } : option)).filter(option => isSupported(option.name));
  const names = new Set<string>();
  for (const option of normalizedOptions) {
    if (names.has(option.name)) throw new Error('alignment-config-name-already-defined');
    names.add(option.name);
  }
  return normalizedOptions;
}

export class AlignmentUI extends Plugin {
  public static override get pluginName(): string {
    return 'AlignmentUI';
  }

  public get localizedOptionTitles(): Record<string, string> {
    const t = this.editor.t;
    return { left: t('Align left'), right: t('Align right'), center: t('Align center'), justify: t('Justify') };
  }

  public override init(): void {
    const editor = this.editor;
    const componentFactory = editor.ui.componentFactory;
    const t = editor.t;
    const options = normalizeAlignmentOptions(editor.config.get('alignment.options') as any[]);
    options.map(option => option.name).filter(isSupported).forEach(option => this._addButton(option as AlignmentValue));

    componentFactory.add('alignment', locale => {
      const dropdownView = createDropdown(locale);
      addToolbarToDropdown(dropdownView, () => options.map(option => componentFactory.create(`alignment:${option.name}`)) as any, { enableActiveItemFocusOnDropdownOpen: true, isVertical: true, ariaLabel: t('Text alignment toolbar') });
      dropdownView.buttonView.set({ label: t('Text alignment'), tooltip: true });
      dropdownView.extendTemplate({ attributes: { class: 'ck-alignment-dropdown' } });
      const defaultIcon = locale.contentLanguageDirection === 'rtl' ? icons.alignRight : icons.alignLeft;
      const command = editor.commands.get('alignment')!;
      (dropdownView.buttonView as any).bind('icon').to(command, 'value', (value: string) => iconMap[value] || defaultIcon);
      dropdownView.bind('isEnabled').to(command, 'isEnabled');
      return dropdownView;
    });
  }

  private _addButton(option: AlignmentValue): void {
    const editor = this.editor;
    editor.ui.componentFactory.add(`alignment:${option}`, locale => {
      const command = editor.commands.get('alignment')!;
      const buttonView = new ButtonView(locale);
      buttonView.set({ label: this.localizedOptionTitles[option], icon: iconMap[option], tooltip: true, isToggleable: true });
      buttonView.bind('isEnabled').to(command);
      buttonView.bind('isOn').to(command, 'value', (value: string) => value === option);
      this.listenTo(buttonView, 'execute', () => {
        editor.execute('alignment', { value: option });
        editor.editing.view.focus();
      });
      return buttonView;
    });
  }
}

const iconMap: Record<string, string> = { left: icons.alignLeft, right: icons.alignRight, center: icons.alignCenter, justify: icons.alignJustify };

export class Alignment extends Plugin {
  public static override get requires() {
    return [AlignmentEditing, AlignmentUI];
  }

  public static override get pluginName(): string {
    return 'Alignment';
  }
}
