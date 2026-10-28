import { Plugin } from '../../core/plugin';
import { Command } from '../../core/command';
import { ButtonView } from '../../ui/button/buttonview';
import { SplitButtonView } from '../../ui/button/splitbuttonview';
import { createDropdown, addToolbarToDropdown } from '../../ui/dropdown/dropdownview';
import { icons } from '../../ui/icons';
import type { Editor } from '../../core/editor';

export interface HighlightOption {
  model: string;
  class: string;
  title: string;
  color: string;
  type: 'marker' | 'pen';
}

/** Applies a highlight (marker or pen) to the selection. */
export class HighlightCommand extends Command {
  public override refresh(): void {
    const model = this.editor.model;
    const doc = model.document;
    this.value = doc.selection.getAttribute('highlight');
    this.isEnabled = model.schema.checkAttributeInSelection(doc.selection, 'highlight');
  }

  public override execute(options: { value?: string | null } = {}): void {
    const model = this.editor.model;
    const document = model.document;
    const selection = document.selection;
    const highlighter = options.value;
    model.change(writer => {
      const ranges = model.schema.getValidRanges(selection.getRanges(), 'highlight');
      if (selection.isCollapsed) {
        const position = selection.getFirstPosition()!;
        if (selection.hasAttribute('highlight')) {
          const isSameHighlight = (value: any) => value.item.hasAttribute('highlight') && value.item.getAttribute('highlight') === this.value;
          const highlightStart = position.getLastMatchingPosition(isSameHighlight, { direction: 'backward' });
          const highlightEnd = position.getLastMatchingPosition(isSameHighlight);
          const highlightRange = writer.createRange(highlightStart, highlightEnd);
          if (!highlighter || this.value === highlighter) {
            if (!position.isEqual(highlightEnd)) {
              writer.remove(highlightRange as any);
            }
            writer.removeAttribute('highlight', highlightRange);
            writer.removeSelectionAttribute('highlight');
          } else {
            writer.setAttribute('highlight', highlighter, highlightRange);
            writer.setSelectionAttribute('highlight', highlighter);
          }
        } else if (highlighter) {
          writer.setSelectionAttribute('highlight', highlighter);
        }
      } else {
        for (const range of ranges) {
          if (highlighter) {
            writer.setAttribute('highlight', highlighter, range);
          } else {
            writer.removeAttribute('highlight', range);
          }
        }
      }
    });
  }
}

export class HighlightEditing extends Plugin {
  public static override get pluginName(): string {
    return 'HighlightEditing';
  }

  constructor(editor: Editor) {
    super(editor);
    editor.config.define('highlight', {
      options: [
        { model: 'yellowMarker', class: 'marker-yellow', title: 'Yellow marker', color: 'var(--ck-highlight-marker-yellow)', type: 'marker' },
        { model: 'greenMarker', class: 'marker-green', title: 'Green marker', color: 'var(--ck-highlight-marker-green)', type: 'marker' },
        { model: 'pinkMarker', class: 'marker-pink', title: 'Pink marker', color: 'var(--ck-highlight-marker-pink)', type: 'marker' },
        { model: 'blueMarker', class: 'marker-blue', title: 'Blue marker', color: 'var(--ck-highlight-marker-blue)', type: 'marker' },
        { model: 'redPen', class: 'pen-red', title: 'Red pen', color: 'var(--ck-highlight-pen-red)', type: 'pen' },
        { model: 'greenPen', class: 'pen-green', title: 'Green pen', color: 'var(--ck-highlight-pen-green)', type: 'pen' }
      ]
    });
  }

  public override init(): void {
    const editor = this.editor;
    editor.model.schema.extend('$text', { allowAttributes: 'highlight' });
    const options = editor.config.get('highlight.options') as HighlightOption[];
    editor.conversion.attributeToElement(buildDefinition(options));
    editor.commands.add('highlight', new HighlightCommand(editor));
  }
}

function buildDefinition(options: HighlightOption[]): any {
  const definition: any = { model: { key: 'highlight', values: [] }, view: {} };
  for (const option of options) {
    definition.model.values.push(option.model);
    definition.view[option.model] = { name: 'mark', classes: option.class };
  }
  return definition;
}

export class HighlightUI extends Plugin {
  public static override get pluginName(): string {
    return 'HighlightUI';
  }

  public override init(): void {
    const options = this.editor.config.get('highlight.options') as HighlightOption[];
    for (const option of options) {
      this._addHighlighterButton(option);
    }
    this._addRemoveHighlightButton();
    this._addDropdown(options);
  }

  private _addRemoveHighlightButton(): void {
    const t = this.editor.t;
    const command = this.editor.commands.get('highlight')!;
    this._addButton('removeHighlight', t('Remove highlight'), icons.eraser, null, (button: ButtonView) => {
      button.bind('isEnabled').to(command, 'isEnabled');
    });
  }

  private _addHighlighterButton(option: HighlightOption): void {
    const command = this.editor.commands.get('highlight')!;
    this._addButton('highlight:' + option.model, option.title, getIconForType(option.type), option.model, decorateHighlightButton);
    function decorateHighlightButton(button: ButtonView) {
      button.bind('isEnabled').to(command, 'isEnabled');
      button.bind('isOn').to(command, 'value', (value: unknown) => value === option.model);
      button.iconView.fillColor = option.color;
      button.isToggleable = true;
    }
  }

  private _addButton(name: string, label: string, icon: string, value: string | null, decorateButton: (button: ButtonView) => void): void {
    const editor = this.editor;
    editor.ui.componentFactory.add(name, locale => {
      const buttonView = new ButtonView(locale);
      buttonView.set({ label, icon, tooltip: true });
      buttonView.on('execute', () => {
        editor.execute('highlight', { value });
        editor.editing.view.focus();
      });
      decorateButton(buttonView);
      return buttonView;
    });
  }

  private _addDropdown(options: HighlightOption[]): void {
    const editor = this.editor;
    const t = editor.t;
    const componentFactory = editor.ui.componentFactory;
    const startingHighlighter = options[0];
    const optionsMap = options.reduce((retVal: Record<string, HighlightOption>, option) => {
      retVal[option.model] = option;
      return retVal;
    }, {});
    componentFactory.add('highlight', locale => {
      const command = editor.commands.get('highlight')!;
      const dropdownView = createDropdown(locale, SplitButtonView);
      const splitButtonView = dropdownView.buttonView as SplitButtonView;
      (splitButtonView as any).set({ label: t('Highlight'), tooltip: true, lastExecuted: startingHighlighter.model, commandValue: startingHighlighter.model, isToggleable: true });
      (splitButtonView as any).bind('icon').to(command, 'value', (value: string) => getIconForType(getActiveOption(value, 'type')));
      (splitButtonView as any).bind('color').to(command, 'value', (value: string) => getActiveOption(value, 'color'));
      (splitButtonView as any).bind('commandValue').to(command, 'value', (value: string) => getActiveOption(value, 'model'));
      splitButtonView.bind('isOn').to(command, 'value', (value: unknown) => !!value);
      (splitButtonView as any).delegate('execute').to(dropdownView);
      function getActiveOption(current: string, key: keyof HighlightOption): any {
        const whichHighlighter = !current || (splitButtonView as any).commandValue === current ? (splitButtonView as any).lastExecuted : current;
        return optionsMap[whichHighlighter] ? optionsMap[whichHighlighter][key] : undefined;
      }
      const buttonsCreator = () => {
        const buttons: any[] = options.map(option => {
          const buttonView = componentFactory.create('highlight:' + option.model) as ButtonView;
          this.listenTo(buttonView, 'execute', () => ((dropdownView.buttonView as any).lastExecuted = option.model));
          return buttonView;
        });
        buttons.push(new (require_toolbar_separator())());
        buttons.push(componentFactory.create('removeHighlight') as ButtonView);
        return buttons;
      };
      dropdownView.bind('isEnabled').to(command, 'isEnabled');
      addToolbarToDropdown(dropdownView, buttonsCreator, { enableActiveItemFocusOnDropdownOpen: true, ariaLabel: t('Text highlight toolbar') });
      bindToolbarIconStyleToActiveColor(dropdownView);
      dropdownView.on('execute', (evt: any) => {
        editor.execute('highlight', { value: evt.source.commandValue });
      });
      dropdownView.on('execute', () => {
        editor.editing.view.focus();
      });
      return dropdownView;
    });
  }
}

function bindToolbarIconStyleToActiveColor(dropdownView: any): void {
  const actionView = dropdownView.buttonView.actionView;
  actionView.iconView.bind('fillColor').to(dropdownView.buttonView, 'color');
}

function getIconForType(type: string): string {
  return type === 'marker' ? icons.fontBackground : icons.pencil;
}

import { ToolbarSeparatorView } from '../../ui/toolbar/toolbarseparatorview';
function require_toolbar_separator(): typeof ToolbarSeparatorView {
  return ToolbarSeparatorView;
}

export class Highlight extends Plugin {
  public static override get requires() {
    return [HighlightEditing, HighlightUI];
  }

  public static override get pluginName(): string {
    return 'Highlight';
  }
}
