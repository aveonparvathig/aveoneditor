import { Plugin } from '../../core/plugin';
import { Command } from '../../core/command';
import { View } from '../../ui/view';
import { ButtonView } from '../../ui/button/buttonview';
import { SwitchButtonView } from '../../ui/button/switchbuttonview';
import { LabeledFieldView, createLabeledInputText } from '../../ui/labeledfield/labeledfieldview';
import { createDropdown } from '../../ui/dropdown/dropdownview';
import { Collection } from '../../utils/collection';
import { Observable } from '../../utils/observable';
import { uid } from '../../utils/uid';
import { icons } from '../../ui/icons';
import type { Editor } from '../../core/editor';
import type { Locale } from '../../utils/locale';
import type { Range } from '../../engine/model/range';
import type { Marker } from '../../engine/model/markercollection';
import type { InputTextView } from '../../ui/input/inputtextview';

interface ResultType {
  id: string;
  label: string;
  marker: Marker;
}

/** Find and replace: highlights matches with markers; replace one or all. */
export class FindAndReplaceEditing extends Plugin {
  public readonly state: FindAndReplaceState;

  public static override get pluginName(): string {
    return 'FindAndReplaceEditing';
  }

  constructor(editor: Editor) {
    super(editor);
    this.state = new FindAndReplaceState(editor.model);
  }

  public override init(): void {
    const editor = this.editor;
    editor.commands.add('find', new FindCommand(editor, this.state));
    editor.commands.add('findNext', new FindNextCommand(editor, this.state));
    editor.commands.add('findPrevious', new FindPreviousCommand(editor, this.state));
    editor.commands.add('replace', new ReplaceCommand(editor, this.state));
    editor.commands.add('replaceAll', new ReplaceAllCommand(editor, this.state));
    editor.conversion.for('editingDowncast').markerToHighlight({
      model: 'findResult',
      view: ({ markerName }) => {
        const [, id] = markerName.split(':');
        return { name: 'span', classes: ['ck-find-result'], attributes: { 'data-find-result': id } };
      }
    });
    editor.conversion.for('editingDowncast').markerToHighlight({
      model: 'findResultHighlighted',
      view: () => ({ name: 'span', classes: ['ck-find-result_selected'] })
    });
    this.listenTo(this.state, 'change:highlightedResult', (evt, name, newValue: ResultType | null, oldValue: ResultType | null) => {
      editor.model.change(writer => {
        if (oldValue && editor.model.markers.has('findResultHighlighted')) {
          writer.removeMarker('findResultHighlighted');
        }
        if (newValue) {
          writer.addMarker('findResultHighlighted', { usingOperation: false, affectsData: false, range: newValue.marker.getRange() });
          writer.setSelection(newValue.marker.getRange());
          editor.editing.view.scrollToTheSelection();
        }
      });
    });
    this.listenTo(editor.model.document, 'change:data', () => {
      if (this.state.searchText) this.refresh();
    });
  }

  public find(callbackOrText: string, options: { matchCase?: boolean; wholeWords?: boolean } = {}): Collection<ResultType> {
    const { editor } = this;
    const { model } = editor;
    this.state.clear(model);
    this.state.searchText = callbackOrText;
    this.state.matchCase = !!options.matchCase;
    this.state.matchWholeWords = !!options.wholeWords;
    this.refresh();
    return this.state.results;
  }

  public refresh(): void {
    const { editor } = this;
    const { model } = editor;
    const previousId = this.state.highlightedResult ? this.state.highlightedResult.id : null;
    this.state.results.clear();
    model.change(writer => {
      for (const marker of Array.from(model.markers.getMarkersGroup('findResult'))) {
        writer.removeMarker(marker);
      }
      const text = this.state.searchText;
      if (!text) return;
      const regexp = regexpFromText(text, this.state.matchCase, this.state.matchWholeWords);
      for (const root of model.document.getRoots()) {
        for (const block of Array.from(model.createRangeIn(root).getItems())) {
          if (!(block as any).is('element') || !model.schema.isBlock(block as any) || !model.schema.checkChild(block as any, '$text')) continue;
          const blockText = Array.from((block as any).getChildren()).map((c: any) => (c.is('$text') ? c.data : '￼')).join('');
          regexp.lastIndex = 0;
          let match: RegExpExecArray | null;
          while ((match = regexp.exec(blockText)) !== null) {
            const start = match.index;
            const end = start + match[0].length;
            if (end === start) {
              regexp.lastIndex++;
              continue;
            }
            const id = `findResult:${uid()}`;
            const range = model.createRange(model.createPositionAt(block as any, start), model.createPositionAt(block as any, end));
            const marker = writer.addMarker(id, { usingOperation: false, affectsData: false, range });
            this.state.results.add({ id, label: match[0], marker });
          }
        }
      }
    });
    const results = this.state.results;
    const highlighted = results.find(r => r.id === previousId) || results.first;
    this.state.highlightedResult = highlighted || null;
  }

  public stop(): void {
    this.state.clear(this.editor.model);
  }
}

function regexpFromText(text: string, matchCase: boolean, wholeWords: boolean): RegExp {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = wholeWords ? `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])` : escaped;
  return new RegExp(pattern, matchCase ? 'gu' : 'giu');
}

export class FindAndReplaceState extends Observable {
  public readonly results = new Collection<ResultType>();
  declare public highlightedResult: ResultType | null;
  declare public searchText: string;
  declare public replaceText: string;
  declare public matchCase: boolean;
  declare public matchWholeWords: boolean;

  constructor(_model: any) {
    super();
    this.set('highlightedResult', null);
    this.set('searchText', '');
    this.set('replaceText', '');
    this.set('matchCase', false);
    this.set('matchWholeWords', false);
  }

  public clear(model: any): void {
    this.searchText = '';
    model.change((writer: any) => {
      if (this.highlightedResult && model.markers.has('findResultHighlighted')) {
        writer.removeMarker('findResultHighlighted');
      }
      for (const marker of Array.from(model.markers.getMarkersGroup('findResult'))) {
        writer.removeMarker(marker as any);
      }
    });
    this.results.clear();
    this.highlightedResult = null;
  }
}

class FindCommand extends Command {
  private _state: FindAndReplaceState;

  constructor(editor: Editor, state: FindAndReplaceState) {
    super(editor);
    this.isEnabled = true;
    this.affectsData = false;
    this._state = state;
  }

  public override execute(text: string, options: { matchCase?: boolean; wholeWords?: boolean } = {}): { results: Collection<ResultType> } {
    const editing = this.editor.plugins.get('FindAndReplaceEditing') as FindAndReplaceEditing;
    return { results: editing.find(text, options) };
  }

  public override refresh(): void {
    this.isEnabled = true;
    void this._state;
  }
}

class FindNextCommand extends Command {
  protected _state: FindAndReplaceState;

  constructor(editor: Editor, state: FindAndReplaceState) {
    super(editor);
    this._state = state;
    this.affectsData = false;
    this.listenTo(this._state.results, 'change', () => this.refresh());
  }

  public override refresh(): void {
    this.isEnabled = this._state.results.length > 1;
  }

  public override execute(): void {
    const results = this._state.results;
    const currentIndex = results.getIndex(this._state.highlightedResult!);
    const nextIndex = currentIndex + 1 >= results.length ? 0 : currentIndex + 1;
    this._state.highlightedResult = results.get(nextIndex);
  }
}

class FindPreviousCommand extends FindNextCommand {
  public override execute(): void {
    const results = this._state.results;
    const currentIndex = results.getIndex(this._state.highlightedResult!);
    const previousIndex = currentIndex - 1 < 0 ? results.length - 1 : currentIndex - 1;
    this._state.highlightedResult = results.get(previousIndex);
  }
}

class ReplaceCommand extends Command {
  protected _state: FindAndReplaceState;

  constructor(editor: Editor, state: FindAndReplaceState) {
    super(editor);
    this._state = state;
    this.listenTo(this._state.results, 'change', () => this.refresh());
  }

  public override refresh(): void {
    this.isEnabled = this._state.results.length > 0;
  }

  public override execute(replacementText: string, result?: ResultType): void {
    const target = result || this._state.highlightedResult;
    if (!target) return;
    this._replace(replacementText, target);
  }

  protected _replace(replacementText: string, result: ResultType): void {
    const { model } = this.editor;
    const range = result.marker.getRange();
    const text = (model.schema.checkAttributeInSelection as any) && null;
    void text;
    model.change(writer => {
      const attributes = getTextAttributes(range);
      model.insertContent(writer.createText(replacementText, attributes), range);
      if (this._state.results.has(result)) {
        this._state.results.remove(result);
      }
      if (model.markers.has(result.id)) {
        writer.removeMarker(result.id);
      }
    });
  }
}

function getTextAttributes(range: Range): Record<string, unknown> {
  for (const item of range.getItems()) {
    if ((item as any).is('$textProxy')) return Object.fromEntries((item as any).getAttributes());
  }
  return {};
}

class ReplaceAllCommand extends ReplaceCommand {
  public override execute(newText: string, textToReplace?: any): void {
    const { editor } = this;
    const { model } = editor;
    const editing = editor.plugins.get('FindAndReplaceEditing') as FindAndReplaceEditing;
    const results = textToReplace ? editing.find(textToReplace) : this._state.results;
    if (results.length) {
      model.change(() => {
        Array.from(results).reverse().forEach(result => this._replace(newText, result));
      });
    }
  }
}

/** The find and replace form shown in a dropdown. */
export class FindAndReplaceFormView extends View {
  public readonly findInputView: LabeledFieldView<InputTextView>;
  public readonly replaceInputView: LabeledFieldView<InputTextView>;
  public readonly findButtonView: ButtonView;
  public readonly findPrevButtonView: ButtonView;
  public readonly findNextButtonView: ButtonView;
  public readonly replaceButtonView: ButtonView;
  public readonly replaceAllButtonView: ButtonView;
  public readonly matchCaseSwitchView: SwitchButtonView;
  public readonly wholeWordsSwitchView: SwitchButtonView;
  declare public matchCount: number;
  declare public highlightOffset: number;
  declare public isDirty: boolean;
  declare public _resultsCounterText: string;

  constructor(locale: Locale) {
    super(locale);
    const t = locale.t;
    this.set('matchCount', 0);
    this.set('highlightOffset', 0);
    this.set('isDirty', false);
    this.bind('_resultsCounterText').to(this, 'highlightOffset', this, 'matchCount', (highlightOffset: number, matchCount: number) => t('%0 of %1', [highlightOffset, matchCount]));

    this.findInputView = new LabeledFieldView(locale, createLabeledInputText);
    this.findInputView.label = t('Find in text…');
    this.replaceInputView = new LabeledFieldView(locale, createLabeledInputText);
    this.replaceInputView.label = t('Replace with…');
    this.findButtonView = this._createButton(t('Find'), undefined, 'ck-button-find ck-button-action', 'find', true);
    this.findPrevButtonView = this._createButton(t('Previous result'), icons.previousArrow, 'ck-button-prev', 'findPrevious');
    this.findNextButtonView = this._createButton(t('Next result'), icons.nextArrow, 'ck-button-next', 'findNext');
    this.replaceButtonView = this._createButton(t('Replace'), undefined, 'ck-button-replace', 'replace', true);
    this.replaceAllButtonView = this._createButton(t('Replace all'), undefined, 'ck-button-replaceall', 'replaceAll', true);
    this.matchCaseSwitchView = this._createSwitch(t('Match case'));
    this.wholeWordsSwitchView = this._createSwitch(t('Whole words only'));

    const bind = this.bindTemplate;
    this.setTemplate({
      tag: 'form',
      attributes: { class: ['ck', 'ck-find-and-replace-form'], style: { padding: '12px', minWidth: '360px' } as any, tabindex: '-1' },
      children: [
        { tag: 'div', attributes: { class: ['ck', 'ck-find-and-replace-form__find'], style: { display: 'flex', gap: '8px', alignItems: 'flex-start' } as any }, children: [this.findInputView, { tag: 'span', attributes: { class: ['ck', 'ck-results-counter'], style: { alignSelf: 'center', whiteSpace: 'nowrap' } as any }, children: [{ text: bind.to('_resultsCounterText') }] }, this.findPrevButtonView, this.findNextButtonView, this.findButtonView] },
        { tag: 'div', attributes: { class: ['ck', 'ck-find-and-replace-form__replace'], style: { display: 'flex', gap: '8px', marginTop: '12px', alignItems: 'flex-start' } as any }, children: [this.replaceInputView, this.replaceButtonView, this.replaceAllButtonView] },
        { tag: 'div', attributes: { class: ['ck', 'ck-find-and-replace-form__options'], style: { display: 'flex', gap: '8px', marginTop: '8px' } as any }, children: [this.matchCaseSwitchView, this.wholeWordsSwitchView] }
      ],
      on: {
        submit: bind.to((evt: Event) => {
          evt.preventDefault();
          this.fire('find');
        })
      }
    });
    this.findInputView.fieldView.on('input', () => {
      this.isDirty = true;
    });
  }

  public get textToFind(): string {
    return this.findInputView.fieldView.element!.value;
  }

  public get textToReplace(): string {
    return this.replaceInputView.fieldView.element!.value;
  }

  public focus(): void {
    this.findInputView.focus();
  }

  private _createButton(label: string, icon: string | undefined, className: string, eventName: string, withText = false): ButtonView {
    const button = new ButtonView(this.locale);
    button.set({ label, icon, withText, tooltip: !withText });
    button.extendTemplate({ attributes: { class: className } });
    button.delegate('execute').to(this, eventName);
    return button;
  }

  private _createSwitch(label: string): SwitchButtonView {
    const switchButton = new SwitchButtonView(this.locale);
    switchButton.set({ label, withText: true });
    switchButton.on('execute', () => {
      switchButton.isOn = !switchButton.isOn;
    });
    return switchButton;
  }
}

export class FindAndReplaceUI extends Plugin {
  public formView: FindAndReplaceFormView | null = null;

  public static override get pluginName(): string {
    return 'FindAndReplaceUI';
  }

  public override init(): void {
    const editor = this.editor;
    const t = editor.t;
    editor.ui.componentFactory.add('findAndReplace', locale => {
      const dropdown = createDropdown(locale);
      dropdown.buttonView.set({ label: t('Find and replace'), icon: icons.findReplace, keystroke: 'CTRL+F', tooltip: true });
      dropdown.once('change:isOpen', () => {
        const formView = (this.formView = new FindAndReplaceFormView(locale));
        dropdown.panelView.children.add(formView);
        this._setupFormView(formView);
      });
      dropdown.on('change:isOpen', () => {
        if (dropdown.isOpen && this.formView) {
          setTimeout(() => this.formView!.focus(), 0);
        } else if (!dropdown.isOpen) {
          (editor.plugins.get('FindAndReplaceEditing') as FindAndReplaceEditing).stop();
        }
      });
      editor.keystrokes.set('Ctrl+F', (data, cancel) => {
        dropdown.isOpen = true;
        cancel();
      });
      return dropdown;
    });
  }

  private _setupFormView(formView: FindAndReplaceFormView): void {
    const editor = this.editor;
    const editing = editor.plugins.get('FindAndReplaceEditing') as FindAndReplaceEditing;
    const state = editing.state;
    formView.on('find', () => {
      editor.execute('find', formView.textToFind, { matchCase: formView.matchCaseSwitchView.isOn, wholeWords: formView.wholeWordsSwitchView.isOn });
      formView.isDirty = false;
    });
    formView.on('findNext', () => editor.execute('findNext'));
    formView.on('findPrevious', () => editor.execute('findPrevious'));
    formView.on('replace', () => editor.execute('replace', formView.textToReplace));
    formView.on('replaceAll', () => editor.execute('replaceAll', formView.textToReplace));
    const updateCounters = () => {
      formView.matchCount = state.results.length;
      formView.highlightOffset = state.highlightedResult ? state.results.getIndex(state.highlightedResult) + 1 : 0;
    };
    this.listenTo(state.results, 'change', updateCounters);
    this.listenTo(state, 'change:highlightedResult', updateCounters);
  }
}

export class FindAndReplace extends Plugin {
  public static override get requires() {
    return [FindAndReplaceEditing, FindAndReplaceUI];
  }

  public static override get pluginName(): string {
    return 'FindAndReplace';
  }
}
