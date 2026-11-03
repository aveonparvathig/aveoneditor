import { Plugin } from '../../core/plugin';
import { Command } from '../../core/command';
import { ButtonView } from '../../ui/button/buttonview';
import { icons } from '../../ui/icons';
import type { Editor } from '../../core/editor';
import type { Item } from '../../engine/model/item';

/**
 * Toggles a boolean text attribute (bold, italic...) on the selection.
 */
export class AttributeCommand extends Command {
  public readonly attributeKey: string;

  constructor(editor: Editor, attributeKey: string) {
    super(editor);
    this.attributeKey = attributeKey;
  }

  public override refresh(): void {
    const model = this.editor.model;
    const doc = model.document;
    this.value = this._getValueFromFirstAllowedNode();
    this.isEnabled = model.schema.checkAttributeInSelection(doc.selection, this.attributeKey);
  }

  public override execute(options: { forceValue?: boolean } = {}): void {
    const model = this.editor.model;
    const doc = model.document;
    const selection = doc.selection;
    const value = options.forceValue === undefined ? !this.value : options.forceValue;
    model.change(writer => {
      if (selection.isCollapsed) {
        if (value) {
          writer.setSelectionAttribute(this.attributeKey, true);
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
    });
  }

  private _getValueFromFirstAllowedNode(): boolean {
    const model = this.editor.model;
    const schema = model.schema;
    const selection = model.document.selection;
    if (selection.isCollapsed) {
      return selection.hasAttribute(this.attributeKey);
    }
    for (const range of selection.getRanges()) {
      for (const item of range.getItems()) {
        if (schema.checkAttribute(item as Item, this.attributeKey)) {
          return item.hasAttribute(this.attributeKey);
        }
      }
    }
    return false;
  }
}

interface StyleDefinition {
  attribute: string;
  pluginName: string;
  label: string;
  icon: string;
  keystroke?: string;
  /** The browser's own formatting request for this style (e.g. the B button of the iOS text menu). */
  inputType?: string;
  view: any;
  upcastAlso?: any[];
  schema?: (editor: Editor) => void;
  addConverters?: (editor: Editor) => void;
}

function createEditingPlugin(def: StyleDefinition): any {
  return class extends Plugin {
    public static override get pluginName(): string {
      return def.pluginName + 'Editing';
    }

    public override init(): void {
      const editor = this.editor;
      editor.model.schema.extend('$text', { allowAttributes: def.attribute });
      editor.model.schema.setAttributeProperties(def.attribute, { isFormatting: true, copyOnEnter: true });
      if (def.addConverters) {
        def.addConverters(editor);
      } else {
        editor.conversion.attributeToElement({ model: def.attribute, view: def.view, upcastAlso: def.upcastAlso });
      }
      editor.commands.add(def.attribute, new AttributeCommand(editor, def.attribute));
      if (def.keystroke) {
        editor.keystrokes.set(def.keystroke, def.attribute);
      }
      if (def.inputType) {
        // Done by the editor instead of the browser, which would change the DOM behind the model's back.
        this.listenTo(editor.editing.view.document, 'beforeinput', (evt: any, data: any) => {
          if (data.inputType !== def.inputType) return;
          data.preventDefault();
          evt.stop();
          editor.execute(def.attribute);
        });
      }
    }
  };
}

function createUIPlugin(def: StyleDefinition): any {
  return class extends Plugin {
    public static override get pluginName(): string {
      return def.pluginName + 'UI';
    }

    public override init(): void {
      const editor = this.editor;
      const t = editor.t;
      editor.ui.componentFactory.add(def.attribute, locale => {
        const command = editor.commands.get(def.attribute)!;
        const view = new ButtonView(locale);
        view.set({ label: t(def.label), icon: def.icon, keystroke: def.keystroke, tooltip: true, isToggleable: true });
        view.bind('isOn', 'isEnabled').to(command, 'value', 'isEnabled');
        this.listenTo(view, 'execute', () => {
          editor.execute(def.attribute);
          editor.editing.view.focus();
        });
        return view;
      });
    }
  };
}

function createFeaturePlugin(def: StyleDefinition): any {
  const EditingPlugin = createEditingPlugin(def);
  const UIPlugin = createUIPlugin(def);
  const Feature = class extends Plugin {
    public static override get requires() {
      return [EditingPlugin, UIPlugin];
    }

    public static override get pluginName(): string {
      return def.pluginName;
    }
  };
  return { Feature, EditingPlugin, UIPlugin };
}

const boldDef: StyleDefinition = {
  attribute: 'bold',
  pluginName: 'Bold',
  inputType: 'formatBold',
  label: 'Bold',
  icon: icons.bold,
  keystroke: 'CTRL+B',
  view: 'strong',
  upcastAlso: [
    'b',
    (viewElement: any) => {
      const fontWeight = viewElement.getStyle('font-weight');
      if (!fontWeight) return null;
      if (fontWeight === 'bold' || Number(fontWeight) >= 600) {
        return { name: true, styles: ['font-weight'] };
      }
      return null;
    }
  ]
};

const italicDef: StyleDefinition = {
  attribute: 'italic',
  pluginName: 'Italic',
  inputType: 'formatItalic',
  label: 'Italic',
  icon: icons.italic,
  keystroke: 'CTRL+I',
  view: 'i',
  upcastAlso: ['em', { styles: { 'font-style': 'italic' } }]
};

const underlineDef: StyleDefinition = {
  attribute: 'underline',
  pluginName: 'Underline',
  inputType: 'formatUnderline',
  label: 'Underline',
  icon: icons.underline,
  keystroke: 'CTRL+U',
  view: 'u',
  upcastAlso: [{ styles: { 'text-decoration': 'underline' } }]
};

const strikethroughDef: StyleDefinition = {
  attribute: 'strikethrough',
  pluginName: 'Strikethrough',
  inputType: 'formatStrikeThrough',
  label: 'Strikethrough',
  icon: icons.strikethrough,
  keystroke: 'CTRL+SHIFT+X',
  view: 's',
  upcastAlso: ['del', 'strike', { styles: { 'text-decoration': 'line-through' } }]
};

const codeDef: StyleDefinition = {
  attribute: 'code',
  pluginName: 'Code',
  label: 'Code',
  icon: icons.code,
  keystroke: 'CTRL+E',
  view: { name: 'code', classes: 'ck-code_selected' },
  upcastAlso: [{ styles: { 'word-wrap': 'break-word' } }],
  addConverters(editor) {
    editor.conversion.attributeToElement({ model: 'code', view: 'code', upcastAlso: [{ styles: { 'word-wrap': 'break-word' } }] });
  }
};

const subscriptDef: StyleDefinition = {
  attribute: 'subscript',
  pluginName: 'Subscript',
  inputType: 'formatSubscript',
  label: 'Subscript',
  icon: icons.subscript,
  view: 'sub',
  upcastAlso: [{ styles: { 'vertical-align': 'sub' } }]
};

const superscriptDef: StyleDefinition = {
  attribute: 'superscript',
  pluginName: 'Superscript',
  inputType: 'formatSuperscript',
  label: 'Superscript',
  icon: icons.superscript,
  view: 'sup',
  upcastAlso: [{ styles: { 'vertical-align': 'super' } }]
};

const bold = createFeaturePlugin(boldDef);
const italic = createFeaturePlugin(italicDef);
const underline = createFeaturePlugin(underlineDef);
const strikethrough = createFeaturePlugin(strikethroughDef);
const code = createFeaturePlugin(codeDef);
const subscript = createFeaturePlugin(subscriptDef);
const superscript = createFeaturePlugin(superscriptDef);

export const Bold = bold.Feature as typeof Plugin;
export const BoldEditing = bold.EditingPlugin as typeof Plugin;
export const BoldUI = bold.UIPlugin as typeof Plugin;
export const Italic = italic.Feature as typeof Plugin;
export const ItalicEditing = italic.EditingPlugin as typeof Plugin;
export const ItalicUI = italic.UIPlugin as typeof Plugin;
export const Underline = underline.Feature as typeof Plugin;
export const UnderlineEditing = underline.EditingPlugin as typeof Plugin;
export const UnderlineUI = underline.UIPlugin as typeof Plugin;
export const Strikethrough = strikethrough.Feature as typeof Plugin;
export const StrikethroughEditing = strikethrough.EditingPlugin as typeof Plugin;
export const StrikethroughUI = strikethrough.UIPlugin as typeof Plugin;
export const Code = code.Feature as typeof Plugin;
export const CodeEditing = code.EditingPlugin as typeof Plugin;
export const CodeUI = code.UIPlugin as typeof Plugin;
export const Subscript = subscript.Feature as typeof Plugin;
export const SubscriptEditing = subscript.EditingPlugin as typeof Plugin;
export const SubscriptUI = subscript.UIPlugin as typeof Plugin;
export const Superscript = superscript.Feature as typeof Plugin;
export const SuperscriptEditing = superscript.EditingPlugin as typeof Plugin;
export const SuperscriptUI = superscript.UIPlugin as typeof Plugin;
