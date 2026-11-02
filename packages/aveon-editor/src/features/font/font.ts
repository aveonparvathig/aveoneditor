import { Plugin } from '../../core/plugin';
import { Command } from '../../core/command';
import { ButtonView } from '../../ui/button/buttonview';
import { View } from '../../ui/view';
import { createDropdown, addListToDropdown, type ListDropdownItemDefinition } from '../../ui/dropdown/dropdownview';
import { ColorGridView, type ColorDefinition } from '../../ui/colorgrid/colorgridview';
import { Collection } from '../../utils/collection';
import { Observable } from '../../utils/observable';
import { icons } from '../../ui/icons';
import { first } from '../../utils/misc';
import type { Editor } from '../../core/editor';
import type { Locale } from '../../utils/locale';

/** Command that sets a font attribute (`fontSize`, `fontFamily`, `fontColor`, `fontBackgroundColor`). */
export class FontCommand extends Command {
  public readonly attributeKey: string;

  constructor(editor: Editor, attributeKey: string) {
    super(editor);
    this.attributeKey = attributeKey;
  }

  public override refresh(): void {
    const model = this.editor.model;
    const doc = model.document;
    this.value = doc.selection.getAttribute(this.attributeKey);
    this.isEnabled = model.schema.checkAttributeInSelection(doc.selection, this.attributeKey);
  }

  public override execute(options: { value?: unknown; batch?: any } = {}): void {
    const model = this.editor.model;
    const document = model.document;
    const selection = document.selection;
    const value = options.value;
    const batch = options.batch;
    const updateAttribute = (writer: any) => {
      if (selection.isCollapsed) {
        if (value) {
          writer.setSelectionAttribute(this.attributeKey, value);
        } else {
          writer.removeSelectionAttribute(this.attributeKey);
        }
      } else {
        const ranges = model.schema.getValidRanges(selection.getRanges(), this.attributeKey);
        for (const range of ranges) {
          if (value) {
            writer.setAttribute(this.attributeKey, value, range);
          } else {
            writer.removeAttribute(this.attributeKey, range);
          }
        }
      }
    };
    if (batch) {
      model.enqueueChange(batch, updateAttribute);
    } else {
      model.change(updateAttribute);
    }
  }
}

function buildDefinition(modelAttributeKey: string, options: any[]) {
  const definition: any = { model: { key: modelAttributeKey, values: [] as string[] }, view: {} as Record<string, any>, upcastAlso: {} as Record<string, any> };
  for (const option of options) {
    definition.model.values.push(option.model);
    definition.view[option.model] = option.view;
    if (option.upcastAlso) definition.upcastAlso[option.model] = option.upcastAlso;
  }
  return definition;
}

// ---------------- Font size ----------------

const FONT_SIZE_PRESET_UNITS: Record<string, { title: string; model: string; view: { name: string; classes: string[]; priority: number } }> = {
  tiny: { title: 'Tiny', model: 'tiny', view: { name: 'span', classes: ['text-tiny'], priority: 7 } },
  small: { title: 'Small', model: 'small', view: { name: 'span', classes: ['text-small'], priority: 7 } },
  big: { title: 'Big', model: 'big', view: { name: 'span', classes: ['text-big'], priority: 7 } },
  huge: { title: 'Huge', model: 'huge', view: { name: 'span', classes: ['text-huge'], priority: 7 } }
};

export function normalizeFontSizeOptions(configuredOptions: any[]): any[] {
  return configuredOptions.map(getOptionDefinition).filter(option => option !== undefined);
}

function getOptionDefinition(option: any): any {
  if (typeof option === 'object') return option;
  if (FONT_SIZE_PRESET_UNITS[option]) return FONT_SIZE_PRESET_UNITS[option];
  if (option === 'default') return { model: undefined, title: 'Default' };
  const sizePreset = parseFloat(option);
  if (isNaN(sizePreset)) return undefined;
  return generatePixelPreset(sizePreset);
}

function generatePixelPreset(size: number): any {
  const sizeName = String(size);
  return { title: sizeName, model: `${size}px`, view: { name: 'span', styles: { 'font-size': `${size}px` }, priority: 7 } };
}

export class FontSizeEditing extends Plugin {
  public static override get pluginName(): string {
    return 'FontSizeEditing';
  }

  constructor(editor: Editor) {
    super(editor);
    editor.config.define('fontSize', { options: ['tiny', 'small', 'default', 'big', 'huge'], supportAllValues: false });
  }

  public override init(): void {
    const editor = this.editor;
    const options = normalizeFontSizeOptions(editor.config.get('fontSize.options') as any[]).filter(item => item.model);
    editor.model.schema.extend('$text', { allowAttributes: 'fontSize' });
    editor.model.schema.setAttributeProperties('fontSize', { isFormatting: true, copyOnEnter: true });
    const definition = buildDefinition('fontSize', options);
    if (editor.config.get('fontSize.supportAllValues')) {
      this._prepareAnyValueConverters();
    } else {
      editor.conversion.attributeToElement(definition);
    }
    editor.commands.add('fontSize', new FontCommand(editor, 'fontSize'));
  }

  private _prepareAnyValueConverters(): void {
    const editor = this.editor;
    editor.conversion.for('downcast').attributeToElement({
      model: 'fontSize',
      view: (attributeValue, { writer }) => (attributeValue ? writer.createAttributeElement('span', { style: 'font-size:' + attributeValue }, { priority: 7 }) : null)
    });
    editor.conversion.for('upcast').elementToAttribute({
      model: { key: 'fontSize', value: (viewElement: any) => viewElement.getStyle('font-size') },
      view: { name: 'span', styles: { 'font-size': /.*/ } }
    });
  }
}

export class FontSizeUI extends Plugin {
  public static override get pluginName(): string {
    return 'FontSizeUI';
  }

  public override init(): void {
    const editor = this.editor;
    const t = editor.t;
    const options = this._getLocalizedOptions();
    const command = editor.commands.get('fontSize')!;
    const accessibleLabel = t('Font Size');
    editor.ui.componentFactory.add('fontSize', locale => {
      const dropdownView = createDropdown(locale);
      addListToDropdown(dropdownView, () => prepareListOptions(options, command), { role: 'menu', ariaLabel: accessibleLabel });
      dropdownView.buttonView.set({ label: accessibleLabel, tooltip: true, icon: icons.fontSize });
      dropdownView.extendTemplate({ attributes: { class: ['ck-font-size-dropdown'] } });
      // The current size as text, for an input-style box (e.g. the ribbon's Font group).
      // With no size set, the size the text actually has (e.g. "16"), like Word.
      bindValueText(editor, dropdownView, command, value => {
        if (!value) return defaultStyle(editor, 'fontSize', size => String(Math.round(parseFloat(size)))) || options.find(item => item.model === undefined)?.title || '';
        const option = options.find(item => item.model === value);
        return option ? option.title : String(value).replace(/px$/, '');
      });
      dropdownView.bind('isEnabled').to(command);
      this.listenTo(dropdownView, 'execute', (evt: any) => {
        editor.execute(evt.source.commandName, { value: evt.source.commandParam });
        editor.editing.view.focus();
      });
      return dropdownView;
    });
  }

  private _getLocalizedOptions(): any[] {
    const editor = this.editor;
    const t = editor.t;
    const localizedTitles: Record<string, string> = { Default: t('Default'), Tiny: t('Tiny'), Small: t('Small'), Big: t('Big'), Huge: t('Huge') };
    const options = normalizeFontSizeOptions(editor.config.get('fontSize.options') as any[]);
    return options.map(option => {
      const title = localizedTitles[option.title];
      if (title && title !== option.title) option = Object.assign({}, option, { title });
      return option;
    });
  }
}

function prepareListOptions(options: any[], command: Command): Collection<ListDropdownItemDefinition> {
  const itemDefinitions = new Collection<ListDropdownItemDefinition>();
  for (const option of options) {
    const def: ListDropdownItemDefinition = { type: 'button', model: new Observable() as any };
    def.model!.set({ commandName: 'fontSize', commandParam: option.model, label: option.title, class: 'ck-fontsize-option', role: 'menuitemradio', withText: true } as any);
    if (option.view && typeof option.view !== 'string') {
      if (option.view.styles) def.model!.set('labelStyle', `font-size:${option.view.styles['font-size']}`);
      if (option.view.classes) def.model!.set('class', `${def.model!.class} ${option.view.classes}`);
    }
    def.model!.bind('isOn').to(command, 'value', (value: unknown) => value === option.model);
    itemDefinitions.add(def);
  }
  return itemDefinitions;
}

export class FontSize extends Plugin {
  public static override get requires() {
    return [FontSizeEditing, FontSizeUI];
  }

  public static override get pluginName(): string {
    return 'FontSize';
  }
}

// ---------------- Font family ----------------

export function normalizeFontFamilyOptions(configuredOptions: any[]): any[] {
  return configuredOptions.map(getFamilyOptionDefinition).filter(option => option !== undefined);
}

function getFamilyOptionDefinition(option: any): any {
  if (typeof option === 'object') return option;
  if (option === 'default') return { title: 'Default', model: undefined };
  if (typeof option !== 'string') return undefined;
  return generateFontPreset(option);
}

function generateFontPreset(fontDefinition: string): any {
  const fontNames = fontDefinition.replace(/"|'/g, '').split(',');
  const firstFontName = fontNames[0];
  const cssFontNames = fontNames.map(normalizeFontNameForCSS).join(', ');
  return {
    title: firstFontName,
    model: cssFontNames,
    view: { name: 'span', styles: { 'font-family': cssFontNames }, priority: 7 }
  };
}

function normalizeFontNameForCSS(fontName: string): string {
  fontName = fontName.trim();
  if (fontName.indexOf(' ') > 0) fontName = `'${fontName}'`;
  return fontName;
}

export class FontFamilyEditing extends Plugin {
  public static override get pluginName(): string {
    return 'FontFamilyEditing';
  }

  constructor(editor: Editor) {
    super(editor);
    editor.config.define('fontFamily', {
      options: ['default', 'Arial, Helvetica, sans-serif', 'Courier New, Courier, monospace', 'Georgia, serif', 'Lucida Sans Unicode, Lucida Grande, sans-serif', 'Tahoma, Geneva, sans-serif', 'Times New Roman, Times, serif', 'Trebuchet MS, Helvetica, sans-serif', 'Verdana, Geneva, sans-serif'],
      supportAllValues: false
    });
  }

  public override init(): void {
    const editor = this.editor;
    editor.model.schema.extend('$text', { allowAttributes: 'fontFamily' });
    editor.model.schema.setAttributeProperties('fontFamily', { isFormatting: true, copyOnEnter: true });
    const options = normalizeFontFamilyOptions(editor.config.get('fontFamily.options') as any[]).filter(item => item.model);
    const definition = buildDefinition('fontFamily', options);
    if (editor.config.get('fontFamily.supportAllValues')) {
      this._prepareAnyValueConverters();
    } else {
      editor.conversion.attributeToElement(definition);
    }
    editor.commands.add('fontFamily', new FontCommand(editor, 'fontFamily'));
  }

  private _prepareAnyValueConverters(): void {
    const editor = this.editor;
    editor.conversion.for('downcast').attributeToElement({
      model: 'fontFamily',
      view: (attributeValue, { writer }) => (attributeValue ? writer.createAttributeElement('span', { style: 'font-family:' + attributeValue }, { priority: 7 }) : null)
    });
    editor.conversion.for('upcast').elementToAttribute({
      model: { key: 'fontFamily', value: (viewElement: any) => viewElement.getStyle('font-family') },
      view: { name: 'span', styles: { 'font-family': /.*/ } }
    });
  }
}

export class FontFamilyUI extends Plugin {
  public static override get pluginName(): string {
    return 'FontFamilyUI';
  }

  public override init(): void {
    const editor = this.editor;
    const t = editor.t;
    const command = editor.commands.get('fontFamily')!;
    const options = this._getLocalizedOptions();
    const accessibleLabel = t('Font Family');
    editor.ui.componentFactory.add('fontFamily', locale => {
      const dropdownView = createDropdown(locale);
      addListToDropdown(dropdownView, () => prepareFamilyListOptions(options, command), { role: 'menu', ariaLabel: accessibleLabel });
      dropdownView.buttonView.set({ label: accessibleLabel, icon: icons.fontFamily, tooltip: true });
      dropdownView.extendTemplate({ attributes: { class: 'ck-font-family-dropdown' } });
      // The current font name as text, for an input-style box (e.g. the ribbon's Font group).
      // With no font set, the font the text actually uses (e.g. "Inter").
      bindValueText(editor, dropdownView, command, value => {
        if (!value) return defaultStyle(editor, 'fontFamily', firstFamily) || options.find(item => item.model === undefined)?.title || '';
        const option = options.find(item => item.model === value);
        return option ? option.title : firstFamily(String(value));
      });
      dropdownView.bind('isEnabled').to(command);
      this.listenTo(dropdownView, 'execute', (evt: any) => {
        editor.execute(evt.source.commandName, { value: evt.source.commandParam });
        editor.editing.view.focus();
      });
      return dropdownView;
    });
  }

  private _getLocalizedOptions(): any[] {
    const editor = this.editor;
    const t = editor.t;
    const options = normalizeFontFamilyOptions(editor.config.get('fontFamily.options') as any[]);
    return options.map(option => {
      if (option.title === 'Default') option.title = t('Default');
      return option;
    });
  }
}

function prepareFamilyListOptions(options: any[], command: Command): Collection<ListDropdownItemDefinition> {
  const itemDefinitions = new Collection<ListDropdownItemDefinition>();
  for (const option of options) {
    const def: ListDropdownItemDefinition = { type: 'button', model: new Observable() as any };
    def.model!.set({ commandName: 'fontFamily', commandParam: option.model, label: option.title, role: 'menuitemradio', withText: true } as any);
    def.model!.bind('isOn').to(command, 'value', (value: unknown) => {
      if (value === option.model) return true;
      if (!value || !option.model) return false;
      return String(value).split(',')[0].replace(/'/g, '').toLowerCase() === String(option.model).split(',')[0].replace(/'/g, '').toLowerCase();
    });
    if (option.view && typeof option.view !== 'string' && option.view.styles) {
      def.model!.set('labelStyle', `font-family: ${option.view.styles['font-family']}`);
    }
    itemDefinitions.add(def);
  }
  return itemDefinitions;
}

export class FontFamily extends Plugin {
  public static override get requires() {
    return [FontFamilyEditing, FontFamilyUI];
  }

  public static override get pluginName(): string {
    return 'FontFamily';
  }
}

// ---------------- Font color / background color ----------------

export const FONT_COLOR = 'fontColor';
export const FONT_BACKGROUND_COLOR = 'fontBackgroundColor';

const DEFAULT_COLORS: ColorDefinition[] = [
  { color: 'hsl(0, 0%, 0%)', label: 'Black' },
  { color: 'hsl(0, 0%, 30%)', label: 'Dim grey' },
  { color: 'hsl(0, 0%, 60%)', label: 'Grey' },
  { color: 'hsl(0, 0%, 90%)', label: 'Light grey' },
  { color: 'hsl(0, 0%, 100%)', label: 'White', options: { hasBorder: true } },
  { color: 'hsl(0, 75%, 60%)', label: 'Red' },
  { color: 'hsl(30, 75%, 60%)', label: 'Orange' },
  { color: 'hsl(60, 75%, 60%)', label: 'Yellow' },
  { color: 'hsl(90, 75%, 60%)', label: 'Light green' },
  { color: 'hsl(120, 75%, 60%)', label: 'Green' },
  { color: 'hsl(150, 75%, 60%)', label: 'Aquamarine' },
  { color: 'hsl(180, 75%, 60%)', label: 'Turquoise' },
  { color: 'hsl(210, 75%, 60%)', label: 'Light blue' },
  { color: 'hsl(240, 75%, 60%)', label: 'Blue' },
  { color: 'hsl(270, 75%, 60%)', label: 'Purple' }
];

/** Color picker panel: a "Remove color" button and a color grid. */
export class ColorSelectorView extends View {
  public readonly colorGridView: ColorGridView;
  public readonly removeColorButtonView: ButtonView;
  declare public selectedColor: string | undefined;

  constructor(locale: Locale, { colors, columns, removeButtonLabel }: { colors: ColorDefinition[]; columns: number; removeButtonLabel: string }) {
    super(locale);
    this.set('selectedColor', undefined);
    this.removeColorButtonView = new ButtonView(locale);
    this.removeColorButtonView.set({ withText: true, icon: icons.eraser, label: removeButtonLabel });
    this.removeColorButtonView.class = 'ck-color-selector__remove-color';
    this.removeColorButtonView.on('execute', () => this.fire('execute', { value: null }));
    this.colorGridView = new ColorGridView(locale, { colorDefinitions: colors, columns });
    this.colorGridView.delegate('execute').to(this);
    this.colorGridView.bind('selectedColor').to(this);
    this.setTemplate({
      tag: 'div',
      attributes: { class: ['ck', 'ck-color-selector'] },
      children: [this.removeColorButtonView, this.colorGridView]
    });
  }

  public focus(): void {
    this.removeColorButtonView.focus();
  }
}

function createFontColorPlugins(attributeKey: string, pluginBaseName: string, cssProperty: string, icon: string, defaultLabel: string, removeLabel: string) {
  class Editing extends Plugin {
    public static override get pluginName(): string {
      return pluginBaseName + 'Editing';
    }

    constructor(editor: Editor) {
      super(editor);
      editor.config.define(attributeKey, { colors: DEFAULT_COLORS, columns: 5 });
    }

    public override init(): void {
      const editor = this.editor;
      editor.conversion.for('upcast').elementToAttribute({
        view: { name: 'span', styles: { [cssProperty]: /[\s\S]+/ } },
        model: { key: attributeKey, value: (viewElement: any) => viewElement.getStyle(cssProperty) }
      });
      if (attributeKey === FONT_COLOR) {
        editor.conversion.for('upcast').elementToAttribute({
          view: { name: 'font', attributes: { color: /^#?\w+$/ } },
          model: { key: attributeKey, value: (viewElement: any) => viewElement.getAttribute('color') }
        });
      }
      editor.conversion.for('downcast').attributeToElement({
        model: attributeKey,
        view: (modelAttributeValue, { writer }) => (modelAttributeValue ? writer.createAttributeElement('span', { style: `${cssProperty}:${modelAttributeValue}` }, { priority: 7 }) : null)
      });
      editor.commands.add(attributeKey, new FontCommand(editor, attributeKey));
      editor.model.schema.extend('$text', { allowAttributes: attributeKey });
      editor.model.schema.setAttributeProperties(attributeKey, { isFormatting: true, copyOnEnter: true });
    }
  }

  class UI extends Plugin {
    public static override get pluginName(): string {
      return pluginBaseName + 'UI';
    }

    public override init(): void {
      const editor = this.editor;
      const t = editor.t;
      const command = editor.commands.get(attributeKey)!;
      const colorsConfig = editor.config.get(`${attributeKey}.colors`) as ColorDefinition[];
      const columns = (editor.config.get(`${attributeKey}.columns`) as number) || 5;
      editor.ui.componentFactory.add(attributeKey, locale => {
        const dropdownView = createDropdown(locale);
        const colorSelectorView = new ColorSelectorView(locale, { colors: colorsConfig.map(c => ({ ...c, label: t(c.label || c.color) })), columns, removeButtonLabel: t(removeLabel) });
        colorSelectorView.bind('selectedColor').to(command, 'value');
        dropdownView.panelView.children.add(colorSelectorView);
        dropdownView.buttonView.set({ label: t(defaultLabel), icon, tooltip: true });
        dropdownView.extendTemplate({ attributes: { class: 'ck-color-ui-dropdown' } });
        dropdownView.bind('isEnabled').to(command);
        // A bar under the icon shows the colour at the cursor (like Word's colour buttons).
        const button = dropdownView.buttonView;
        button.on('render', () => {
          const indicator = button.element!.ownerDocument.createElement('span');
          indicator.className = 'ck-color-indicator';
          indicator.setAttribute('aria-hidden', 'true');
          button.element!.appendChild(indicator);
          const update = () => {
            const value = command.value as string | undefined;
            indicator.style.background = value || '';
            indicator.classList.toggle('ck-color-indicator_auto', !value);
          };
          command.on('change:value', update);
  // The default size depends on the paragraph (headings are bigger): read once the view is rendered.
  editor.editing.view.on('render', update, { priority: 'low' });
          update();
        });
        colorSelectorView.on('execute', (evt, data: { value: string | null }) => {
          if (dropdownView.isOpen) {
            editor.execute(attributeKey, { value: data.value });
          }
          dropdownView.isOpen = false;
          editor.editing.view.focus();
        });
        return dropdownView;
      });
    }
  }

  class Feature extends Plugin {
    public static override get requires() {
      return [Editing, UI];
    }

    public static override get pluginName(): string {
      return pluginBaseName;
    }
  }

  return { Editing, UI, Feature };
}

const fontColor = createFontColorPlugins(FONT_COLOR, 'FontColor', 'color', icons.fontColor, 'Font Color', 'Remove color');
const fontBackgroundColor = createFontColorPlugins(FONT_BACKGROUND_COLOR, 'FontBackgroundColor', 'background-color', icons.fontBackground, 'Font Background Color', 'Remove color');

export const FontColorEditing: typeof Plugin = fontColor.Editing as typeof Plugin;
export const FontColorUI: typeof Plugin = fontColor.UI as typeof Plugin;
export const FontColor: typeof Plugin = fontColor.Feature as typeof Plugin;
export const FontBackgroundColorEditing: typeof Plugin = fontBackgroundColor.Editing as typeof Plugin;
export const FontBackgroundColorUI: typeof Plugin = fontBackgroundColor.UI as typeof Plugin;
export const FontBackgroundColor: typeof Plugin = fontBackgroundColor.Feature as typeof Plugin;

/** All font features. */
export class Font extends Plugin {
  public static override get requires() {
    return [FontFamily, FontSize, FontColor, FontBackgroundColor];
  }

  public static override get pluginName(): string {
    return 'Font';
  }
}

export { first };

function firstFamily(value: string): string {
  return value.split(',')[0].replace(/['"]/g, '').trim();
}

/** The style the text at the cursor has without a font setting (e.g. a heading's size), or '' before the editor is shown. */
function defaultStyle(editor: any, property: 'fontSize' | 'fontFamily', format: (value: string) => string): string {
  const root = editor.editing.view.getDomRoot();
  if (!root || !root.ownerDocument.defaultView) return '';
  const block = editor.model.document.selection.getFirstPosition()?.parent;
  const viewBlock = block && editor.editing.mapper.toViewElement(block);
  const domBlock = viewBlock && editor.editing.view.domConverter.mapViewToDom(viewBlock);
  const element = domBlock && domBlock.nodeType === 1 ? domBlock : root;
  const value = root.ownerDocument.defaultView.getComputedStyle(element)[property];
  return value ? format(value) : '';
}

/** Keeps `valueText` (the current value as text, shown by input-style boxes) up to date. */
function bindValueText(editor: any, dropdownView: any, command: any, toText: (value: unknown) => string): void {
  dropdownView.set('valueText', '');
  const update = () => (dropdownView.valueText = toText(command.value));
  command.on('change:value', update);
  // The default size depends on the paragraph (headings are bigger): read once the view is rendered.
  editor.editing.view.on('render', update, { priority: 'low' });
  // The default look is known once the editable is in the page.
  editor.on('ready', update);
  update();
}
