import { Plugin } from '../../core/plugin';
import { View } from '../../ui/view';
import { ButtonView } from '../../ui/button/buttonview';
import { SwitchButtonView } from '../../ui/button/switchbuttonview';
import { ContextualBalloon } from '../../ui/panel/contextualballoon';
import { FocusTracker } from '../../utils/focustracker';
import { KeystrokeHandler } from '../../utils/keystrokehandler';
import { FocusCycler } from '../../ui/focuscycler';
import { submitHandler, clickOutsideHandler } from '../../ui/bindings';
import { icons } from '../../ui/icons';
import { ClickObserver } from '../link/linkui';
import { MathCommand, getSelectedMathElement, renderEquation, getMathML, type MathNumberingConfig, type MathHandwritingConfig, type MathChemistryConfig } from './mathediting';
import { FormulaEditorView } from './ui/formulaview';
import { MathToolbarView } from './ui/mathtoolbarview';
import { createCatalogue, type MathToolbarConfig } from './ui/catalogue';
import { HandwritingView } from './ui/handwriting/handwritingview';
import { parseMathML, domToMathMLLike, getTexAnnotation } from './model/mathml';
import { toLatex } from './model/latex';
import type { ColorDefinition } from '../../ui/colorgrid/colorgridview';
import type { Locale } from '../../utils/locale';

export { FormulaEditorView, MathToolbarView, createCatalogue, HandwritingView };

/** Multi-line code input (LaTeX or MathML). Fires `input` on changes. */
export class MathTextareaView extends View {
  declare public value: string;
  declare public placeholder: string | undefined;
  declare public isFocused: boolean;
  public readonly focusTracker = new FocusTracker();
  declare public element: HTMLTextAreaElement | null;

  constructor(locale?: Locale, ariaLabel = 'LaTeX equation') {
    super(locale);
    this.set('value', '');
    this.set('placeholder', undefined);
    this.set('isFocused', false);
    this.bind('isFocused').to(this.focusTracker);
    const bind = this.bindTemplate;
    this.setTemplate({
      tag: 'textarea',
      attributes: {
        class: ['ck', 'ck-input', 'ck-input-text', 'ck-math-form__input', bind.if('isFocused', 'ck-input_focused')],
        rows: '3',
        spellcheck: 'false',
        placeholder: bind.to('placeholder'),
        'aria-label': this.locale ? this.locale.t(ariaLabel) : ariaLabel
      },
      on: {
        input: bind.to((evt: Event) => {
          this.value = (evt.target as HTMLTextAreaElement).value;
          this.fire('input', evt);
        })
      }
    });
  }

  public override render(): void {
    super.render();
    this.focusTracker.add(this.element!);
    this.element!.value = this.value;
    this.on('change:value', (evt, name, value: string) => {
      if (this.element && this.element.value !== value) this.element.value = value;
    });
  }

  public override destroy(): void {
    super.destroy();
    this.focusTracker.destroy();
  }

  public focus(): void {
    this.element?.focus();
  }

  public select(): void {
    this.element?.select();
  }
}

export type MathFormMode = 'visual' | 'latex' | 'mathml' | 'handwriting';

export interface MathFormOptions {
  toolbar?: MathToolbarConfig;
  colors?: ColorDefinition[];
  autoformat?: boolean;
  numbering?: MathNumberingConfig;
  handwriting?: MathHandwritingConfig;
  direction?: 'ltr' | 'rtl';
  decimalSeparator?: '.' | ',';
  /** Opens with the chemistry tab and chemistry typing. */
  chemistry?: boolean;
}

/** `true` on touch-first devices (used by `defaultMode: 'auto'`). */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  return coarse || (navigator.maxTouchPoints > 0 && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent));
}

/**
 * Equation dialog shown in a balloon: visual editor (tabbed toolbar + canvas), LaTeX code, MathML code
 * or handwriting, display-mode and numbering switches, live preview, save and cancel.
 */
export class MathFormView extends View {
  declare public equation: string;
  declare public display: boolean;
  declare public numbered: boolean;
  declare public mode: MathFormMode;
  declare public chemistry: boolean;
  public readonly focusTracker = new FocusTracker();
  public readonly keystrokes = new KeystrokeHandler();
  public readonly canvas: FormulaEditorView;
  public readonly toolbar: MathToolbarView;
  public readonly equationInputView: MathTextareaView;
  public readonly mathmlInputView: MathTextareaView;
  public readonly handwritingView: HandwritingView | null;
  public readonly visualModeButton: ButtonView;
  public readonly latexModeButton: ButtonView;
  public readonly mathmlModeButton: ButtonView;
  public readonly handwritingModeButton: ButtonView | null;
  public readonly useHandwritingButton: ButtonView | null;
  public readonly displayButtonView: SwitchButtonView;
  public readonly numberedButtonView: SwitchButtonView;
  public readonly previewView: View;
  public readonly saveButtonView: ButtonView;
  public readonly cancelButtonView: ButtonView;
  declare public mathmlError: string | null;
  declare public handwritingLatex: string;
  private readonly _focusables = this.createCollection();
  private readonly _focusCycler: FocusCycler;
  private readonly _renderPreview: (equation: string, element: HTMLElement, display: boolean) => void;
  private _syncing = false;

  constructor(locale: Locale, renderPreview: (equation: string, element: HTMLElement, display: boolean) => void, options: MathFormOptions = {}) {
    super(locale);
    const t = locale.t;
    this._renderPreview = renderPreview;
    this.set('equation', '');
    this.set('display', false);
    this.set('numbered', false);
    this.set('mode', 'visual');
    this.set('mathmlError', null);
    this.set('handwritingLatex', '');
    this.set('chemistry', !!options.chemistry);

    this.canvas = new FormulaEditorView(locale);
    this.canvas.autoformat = options.autoformat !== false;
    this.canvas.direction = options.direction || 'ltr';
    this.canvas.decimalSeparator = options.decimalSeparator || '.';
    this.canvas.chemistryMode = !!options.chemistry;
    const toolbarConfig: MathToolbarConfig = { ...(options.toolbar || {}) };
    if (options.chemistry) toolbarConfig.preset = 'chemistry';
    this.toolbar = new MathToolbarView(locale, createCatalogue(toolbarConfig), this.canvas);
    if (options.colors) this.toolbar.colors = options.colors;
    this.canvas.on('change', () => {
      if (this.mode === 'visual') this._setEquation(this.canvas.getLatex());
    });

    this.equationInputView = new MathTextareaView(locale, 'LaTeX equation');
    this.equationInputView.placeholder = 'e.g. \\frac{a}{b} + \\sqrt{x^2 + y^2}';
    this.equationInputView.on('input', () => {
      if (this.mode === 'latex') this._setEquation(this.equationInputView.value);
    });

    this.mathmlInputView = new MathTextareaView(locale, 'MathML');
    this.mathmlInputView.placeholder = '<math><mfrac><mi>a</mi><mi>b</mi></mfrac></math>';
    this.mathmlInputView.on('input', () => {
      if (this.mode === 'mathml') this._applyMathML(this.mathmlInputView.value);
    });

    const handwritingEnabled = !options.handwriting || options.handwriting.enabled !== false;
    this.handwritingView = handwritingEnabled ? new HandwritingView(locale, options.handwriting || {}) : null;
    if (this.handwritingView) {
      this.handwritingView.on('recognized', (evt, result: { latex: string }) => {
        this.handwritingLatex = result.latex;
        if (this.mode === 'handwriting') this._setEquation(result.latex);
      });
    }

    this.visualModeButton = this._createModeButton(t('Visual'), 'visual');
    this.latexModeButton = this._createModeButton(t('LaTeX'), 'latex');
    this.mathmlModeButton = this._createModeButton(t('MathML'), 'mathml');
    this.handwritingModeButton = this.handwritingView ? this._createModeButton(t('Handwriting'), 'handwriting') : null;

    this.useHandwritingButton = this.handwritingView ? new ButtonView(locale) : null;
    if (this.useHandwritingButton) {
      this.useHandwritingButton.set({ label: t('Edit in the visual editor'), withText: true });
      this.useHandwritingButton.bind('isEnabled').to(this, 'handwritingLatex', (value: string) => !!value.trim());
      this.useHandwritingButton.on('execute', () => {
        this.mode = 'visual';
        this.focus();
      });
    }

    this.displayButtonView = new SwitchButtonView(locale);
    this.displayButtonView.set({ label: t('Display mode'), withText: true });
    this.displayButtonView.bind('isOn').to(this, 'display');
    this.displayButtonView.on('execute', () => {
      this.display = !this.display;
    });

    this.numberedButtonView = new SwitchButtonView(locale);
    this.numberedButtonView.set({ label: t('Numbered'), withText: true });
    this.numberedButtonView.bind('isOn').to(this, 'numbered');
    this.numberedButtonView.bind('isVisible' as any).to(this, 'display');
    this.numberedButtonView.on('execute', () => {
      this.numbered = !this.numbered;
    });
    this._bindVisibility(this.numberedButtonView);

    this.previewView = new View(locale);
    this.previewView.setTemplate({ tag: 'div', attributes: { class: ['ck', 'ck-math-form__preview', 'ck-reset_all-excluded'], 'aria-live': 'polite' } });

    this.saveButtonView = this._createButton(t('Save'), icons.check, 'ck-button-save');
    this.saveButtonView.type = 'submit';
    this.saveButtonView.bind('isEnabled').to(this, 'equation', (value: string) => !!value.trim());
    this.cancelButtonView = this._createButton(t('Cancel'), icons.cancel, 'ck-button-cancel', 'cancel');

    this._focusCycler = new FocusCycler({
      focusables: this._focusables,
      focusTracker: this.focusTracker,
      keystrokeHandler: this.keystrokes,
      actions: { focusPrevious: 'shift + tab', focusNext: 'tab' }
    });

    const modeButtons: View[] = [this.visualModeButton, this.latexModeButton, this.mathmlModeButton];
    if (this.handwritingModeButton) modeButtons.push(this.handwritingModeButton);
    const modeBar = new View(locale);
    modeBar.setTemplate({ tag: 'div', attributes: { class: ['ck', 'ck-math-form__modes'], role: 'group', 'aria-label': t('Editing mode') }, children: modeButtons });

    const visualPane = new View(locale);
    visualPane.setTemplate({ tag: 'div', attributes: { class: ['ck', 'ck-math-form__visual'] }, children: [this.toolbar, this.canvas] });
    visualPane.bind('isVisible' as any).to(this, 'mode', (mode: MathFormMode) => mode === 'visual');
    this._bindVisibility(visualPane);

    const latexPane = new View(locale);
    latexPane.setTemplate({ tag: 'div', attributes: { class: ['ck', 'ck-math-form__latex'] }, children: [this.equationInputView] });
    latexPane.bind('isVisible' as any).to(this, 'mode', (mode: MathFormMode) => mode === 'latex');
    this._bindVisibility(latexPane);

    const mathmlError = new View(locale);
    mathmlError.setTemplate({ tag: 'p', attributes: { class: ['ck', 'ck-math-form__error'], role: 'alert' }, children: [{ text: this.bindTemplate.to('mathmlError', (value: string | null) => value || '') }] });
    const mathmlPane = new View(locale);
    mathmlPane.setTemplate({ tag: 'div', attributes: { class: ['ck', 'ck-math-form__mathml'] }, children: [this.mathmlInputView, mathmlError] });
    mathmlPane.bind('isVisible' as any).to(this, 'mode', (mode: MathFormMode) => mode === 'mathml');
    this._bindVisibility(mathmlPane);

    const panes: View[] = [modeBar, visualPane, latexPane, mathmlPane];
    if (this.handwritingView) {
      const result = new View(locale);
      const code = new View(locale);
      code.setTemplate({ tag: 'code', children: [{ text: this.bindTemplate.to('handwritingLatex', (value: string) => value || t('Nothing recognised yet')) }] });
      result.setTemplate({ tag: 'div', attributes: { class: ['ck', 'ck-math-form__handwriting-result'] }, children: [code, this.useHandwritingButton!] });
      const handwritingPane = new View(locale);
      handwritingPane.setTemplate({ tag: 'div', attributes: { class: ['ck', 'ck-math-form__handwriting'] }, children: [this.handwritingView, result] });
      handwritingPane.bind('isVisible' as any).to(this, 'mode', (mode: MathFormMode) => mode === 'handwriting');
      this._bindVisibility(handwritingPane);
      panes.push(handwritingPane);
    }

    const actionsView = new View(locale);
    actionsView.setTemplate({ tag: 'div', attributes: { class: ['ck', 'ck-math-form__actions'] }, children: [this.displayButtonView, this.numberedButtonView, this.saveButtonView, this.cancelButtonView] });

    this.setTemplate({
      tag: 'form',
      attributes: { class: ['ck', 'ck-math-form', 'ck-responsive-form'], tabindex: '-1', dir: options.direction || 'ltr' },
      children: [...panes, this.previewView, actionsView]
    });

    this.on('change:equation', () => this.updatePreview());
    this.on('change:display', () => this.updatePreview());
    this.on('change:mode', (evt, name, mode: MathFormMode) => this._onModeChange(mode));
    this.on('change:chemistry', (evt, name, value: boolean) => {
      this.canvas.chemistryMode = value;
      if (value && this.toolbar.tabs.some(tab => tab.id === 'chemistry')) this.toolbar.activeTab = 'chemistry';
    });
  }

  public override render(): void {
    super.render();
    submitHandler({ view: this });
    const focusables: View[] = [this.visualModeButton, this.latexModeButton, this.mathmlModeButton];
    if (this.handwritingModeButton) focusables.push(this.handwritingModeButton);
    focusables.push(this.toolbar, this.canvas, this.equationInputView, this.mathmlInputView);
    if (this.handwritingView) focusables.push(this.handwritingView.undoButtonView, this.handwritingView.redoButtonView, this.handwritingView.clearButtonView, this.useHandwritingButton!);
    focusables.push(this.displayButtonView, this.numberedButtonView, this.saveButtonView, this.cancelButtonView);
    focusables.forEach(view => {
      this._focusables.add(view as any);
      this.focusTracker.add(view.element!);
    });
    this.keystrokes.listenTo(this.element as any);
    this.keystrokes.set('Ctrl+Enter', (data, cancel) => {
      if (this.equation.trim()) this.fire('submit');
      cancel();
    });
    this.keystrokes.set('Ctrl+Shift+L', (data, cancel) => {
      this.mode = this.mode === 'latex' ? 'visual' : 'latex';
      this.focus();
      cancel();
    });
    this.keystrokes.set('Ctrl+Shift+X', (data, cancel) => {
      this.mode = this.mode === 'mathml' ? 'visual' : 'mathml';
      this.focus();
      cancel();
    });
    this.keystrokes.set('Alt+F10', (data, cancel) => {
      if (this.mode === 'visual') {
        this.toolbar.focusTabs();
        cancel();
      }
    });
    this.element!.addEventListener('keydown', evt => {
      if (this.mode === 'visual' && this.toolbar.handleKeystroke(evt)) {
        evt.preventDefault();
        evt.stopPropagation();
      }
    });
    if (this.chemistry && this.toolbar.tabs.some(tab => tab.id === 'chemistry')) this.toolbar.activeTab = 'chemistry';
    this.updatePreview();
  }

  public override destroy(): void {
    super.destroy();
    this.focusTracker.destroy();
    this.keystrokes.destroy();
  }

  public focus(): void {
    if (this.mode === 'visual') this.canvas.focus();
    else if (this.mode === 'latex') this.equationInputView.focus();
    else if (this.mode === 'mathml') this.mathmlInputView.focus();
    else this.handwritingView?.focus();
  }

  /** Fills the form with the given values. */
  public setValues(equation: string, display: boolean, numbered = false): void {
    this._syncing = true;
    this.equation = equation;
    this.display = display;
    this.numbered = numbered;
    this.equationInputView.value = equation;
    this.mathmlInputView.value = this._mathmlFor(equation);
    this.canvas.setLatex(equation);
    this.handwritingLatex = '';
    this.handwritingView?.setStrokes([]);
    this._syncing = false;
    this.updatePreview();
  }

  public updatePreview(): void {
    const element = this.previewView.element;
    if (!element) return;
    element.innerHTML = '';
    const equation = this.equation.trim();
    if (!equation) {
      element.classList.add('ck-math-form__preview_empty');
      element.textContent = this.locale ? this.locale.t('Preview') : 'Preview';
      return;
    }
    element.classList.remove('ck-math-form__preview_empty');
    try {
      this._renderPreview(equation, element, this.display);
    } catch (err) {
      element.textContent = String((err as Error).message || err);
    }
  }

  private _mathmlFor(equation: string): string {
    try {
      return equation.trim() ? getMathML(equation, this.display) : '';
    } catch {
      return '';
    }
  }

  private _applyMathML(mathml: string): void {
    const trimmed = mathml.trim();
    if (!trimmed) {
      this.mathmlError = null;
      this._setEquation('');
      return;
    }
    try {
      const doc = new DOMParser().parseFromString(`<!doctype html><body>${trimmed}`, 'text/html');
      const math = doc.body.querySelector('math') || doc.body.firstElementChild;
      if (!math) throw new Error('no <math> element');
      const like = domToMathMLLike(math);
      const annotation = getTexAnnotation(like);
      const equation = annotation && annotation.trim() ? annotation.trim() : toLatex(parseMathML(like));
      this.mathmlError = null;
      this._setEquation(equation);
    } catch (err) {
      this.mathmlError = (this.locale ? this.locale.t('Invalid MathML') : 'Invalid MathML') + ': ' + String((err as Error).message || err);
    }
  }

  private _setEquation(value: string): void {
    if (this._syncing) return;
    this.equation = value;
  }

  private _onModeChange(mode: MathFormMode): void {
    this._syncing = true;
    if (mode === 'latex') {
      this.equationInputView.value = this.equation;
    } else if (mode === 'mathml') {
      this.mathmlInputView.value = this._mathmlFor(this.equation);
      this.mathmlError = null;
    } else if (mode === 'handwriting') {
      if (this.handwritingLatex.trim()) this.equation = this.handwritingLatex;
    } else {
      this.canvas.setLatex(this.equation);
      this.equation = this.canvas.getLatex();
    }
    this._syncing = false;
    this.updatePreview();
  }

  private _bindVisibility(view: View): void {
    view.on('change:isVisible', (evt, name, value: boolean) => {
      if (view.element) view.element.hidden = !value;
    });
    view.on('render', () => {
      if (view.element) view.element.hidden = !(view as any).isVisible;
    });
  }

  private _createModeButton(label: string, mode: MathFormMode): ButtonView {
    const button = new ButtonView(this.locale);
    button.set({ label, withText: true, tooltip: false });
    button.extendTemplate({ attributes: { class: ['ck-math-form__mode-button'] } });
    button.bind('isOn').to(this, 'mode', (current: MathFormMode) => current === mode);
    button.on('execute', () => {
      this.mode = mode;
      this.focus();
    });
    return button;
  }

  private _createButton(label: string, icon: string, className: string, eventName?: string): ButtonView {
    const button = new ButtonView(this.locale);
    button.set({ label, icon, tooltip: true });
    button.extendTemplate({ attributes: { class: className } });
    if (eventName) button.delegate('execute').to(this, eventName);
    return button;
  }
}

/** Toolbar buttons (`math`, `chemType`) and the balloon dialog for inserting and editing equations. */
export class MathUI extends Plugin {
  private _form: MathFormView | null = null;
  private _balloon!: ContextualBalloon;

  public static override get pluginName(): string {
    return 'MathUI';
  }

  public static override get requires() {
    return [ContextualBalloon];
  }

  public override init(): void {
    const editor = this.editor;
    const t = editor.t;
    this._balloon = editor.plugins.get(ContextualBalloon) as ContextualBalloon;

    editor.ui.componentFactory.add('math', locale => {
      const command = editor.commands.get('math') as MathCommand;
      const button = new ButtonView(locale);
      button.set({ label: t('Insert math equation'), icon: icons.math, tooltip: true, keystroke: 'Ctrl+Alt+M' });
      button.bind('isEnabled').to(command, 'isEnabled');
      button.bind('isOn').to(command, 'value', (value: unknown) => !!value);
      this.listenTo(button, 'execute', () => this._showForm(false));
      return button;
    });

    const chemistry = (editor.config.get('math.chemistry') as MathChemistryConfig) || {};
    if (chemistry.enabled !== false) {
      editor.ui.componentFactory.add('chemType', locale => {
        const command = editor.commands.get('math') as MathCommand;
        const button = new ButtonView(locale);
        button.set({ label: t('Insert chemical formula'), icon: icons.chemistry, tooltip: true });
        button.bind('isEnabled').to(command, 'isEnabled');
        this.listenTo(button, 'execute', () => this._showForm(true));
        return button;
      });
    }

    // Clicking an equation widget opens the editor.
    editor.editing.view.addObserver(ClickObserver);
    this.listenTo(editor.editing.view.document, 'click', () => {
      if (getSelectedMathElement(editor.model.document.selection)) {
        this._showForm(false);
      }
    });

    editor.keystrokes.set('Ctrl+Alt+M', (data: any, cancel: () => void) => {
      const command = editor.commands.get('math') as MathCommand;
      if (command.isEnabled) {
        this._showForm(false);
        cancel();
      }
    });
  }

  public override destroy(): void {
    super.destroy();
    if (this._form) this._form.destroy();
  }

  /** The dialog view (created lazily). */
  public get form(): MathFormView | null {
    return this._form;
  }

  private _createForm(): void {
    const editor = this.editor;
    this._form = new MathFormView(editor.locale, (equation, element, display) => renderEquation(editor, equation, element, display), {
      toolbar: editor.config.get('math.toolbar') as MathToolbarConfig | undefined,
      colors: editor.config.get('math.colors') as ColorDefinition[] | undefined,
      autoformat: editor.config.get('math.autoformat') as boolean | undefined,
      numbering: editor.config.get('math.numbering') as MathNumberingConfig | undefined,
      handwriting: editor.config.get('math.handwriting') as MathHandwritingConfig | undefined,
      direction: editor.config.get('math.direction') as 'ltr' | 'rtl' | undefined,
      decimalSeparator: editor.config.get('math.decimalSeparator') as '.' | ',' | undefined
    });
    this._form.render();

    this.listenTo(this._form, 'submit', () => {
      const form = this._form!;
      if (!form.equation.trim()) return;
      editor.execute('math', { equation: form.equation, display: form.display, numbered: form.display && form.numbered });
      this._hideForm(true);
    });
    this.listenTo(this._form, 'cancel', () => this._hideForm(true));
    this._form.keystrokes.set('Esc', (data, cancel) => {
      this._hideForm(true);
      cancel();
    });

    this.listenTo(editor.ui, 'update', () => {
      if (this._isVisible) {
        this._balloon.updatePosition(this._getBalloonPositionData());
      }
    });

    clickOutsideHandler({
      emitter: this._form,
      activator: () => this._isVisible,
      contextElements: () => [this._balloon.view.element],
      callback: () => this._hideForm()
    });
  }

  private _defaultMode(): MathFormMode {
    const configured = (this.editor.config.get('math.defaultMode') as MathFormMode | 'auto' | undefined) || 'visual';
    if (configured === 'auto') return isTouchDevice() && this._form?.handwritingView ? 'handwriting' : 'visual';
    if (configured === 'handwriting' && !this._form?.handwritingView) return 'visual';
    return configured;
  }

  private _showForm(chemistry: boolean): void {
    if (!this._form) this._createForm();
    const command = this.editor.commands.get('math') as MathCommand;
    const form = this._form!;
    if (!this._isInBalloon) {
      this._balloon.add({ view: form, position: this._getBalloonPositionData() });
    }
    const value = command.value;
    const numbering = (this.editor.config.get('math.numbering') as MathNumberingConfig) || {};
    form.mode = this._defaultMode();
    form.chemistry = chemistry;
    form.setValues(value ? value.equation : '', value ? value.display : false, value ? !!value.numbered : !!numbering.all);
    // The dialog's height depends on its content: position it again now that it is filled.
    this._balloon.updatePosition(this._getBalloonPositionData());
    form.focus();
  }

  private _hideForm(focusEditable = false): void {
    if (!this._isInBalloon) return;
    if (this._form!.focusTracker.isFocused) {
      this._form!.saveButtonView.focus();
    }
    this._balloon.remove(this._form!);
    if (focusEditable) this.editor.editing.view.focus();
  }

  private _getBalloonPositionData(): any {
    const editor = this.editor;
    const view = editor.editing.view;
    return {
      target: () => {
        const selected = getSelectedMathElement(editor.model.document.selection);
        if (selected) {
          const viewElement = editor.editing.mapper.toViewElement(selected);
          if (viewElement) return view.domConverter.mapViewToDom(viewElement as any);
        }
        const range = view.document.selection.getFirstRange();
        return range ? view.domConverter.viewRangeToDom(range) : null;
      }
    };
  }

  private get _isVisible(): boolean {
    return !!this._form && this._balloon.visibleView === this._form;
  }

  private get _isInBalloon(): boolean {
    return !!this._form && this._balloon.hasView(this._form);
  }
}
