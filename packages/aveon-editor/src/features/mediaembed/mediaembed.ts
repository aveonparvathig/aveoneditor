import { Plugin } from '../../core/plugin';
import { Command } from '../../core/command';
import { View } from '../../ui/view';
import { ButtonView } from '../../ui/button/buttonview';
import { LabeledFieldView, createLabeledInputText } from '../../ui/labeledfield/labeledfieldview';
import { createDropdown } from '../../ui/dropdown/dropdownview';
import { FocusTracker } from '../../utils/focustracker';
import { KeystrokeHandler } from '../../utils/keystrokehandler';
import { FocusCycler } from '../../ui/focuscycler';
import { submitHandler } from '../../ui/bindings';
import { icons } from '../../ui/icons';
import { toWidget } from '../widget/utils';
import { Widget } from '../widget/widget';
import { first } from '../../utils/misc';
import type { Editor } from '../../core/editor';
import type { Locale } from '../../utils/locale';
import type { InputTextView } from '../../ui/input/inputtextview';

export interface MediaProvider {
  name: string;
  url: RegExp | RegExp[];
  html?: (match: RegExpMatchArray) => string;
}

const DEFAULT_PROVIDERS: MediaProvider[] = [
  {
    name: 'youtube',
    url: [/^(?:m\.)?youtube\.com\/watch\?v=([\w-]+)(?:&t=(\d+))?/, /^(?:m\.)?youtube\.com\/v\/([\w-]+)(?:\?t=(\d+))?/, /^youtube\.com\/embed\/([\w-]+)(?:\?start=(\d+))?/, /^youtu\.be\/([\w-]+)(?:\?t=(\d+))?/],
    html: match => {
      const id = match[1];
      const time = match[2];
      return `<div style="position: relative; padding-bottom: 100%; height: 0; padding-bottom: 56.2493%;"><iframe src="https://www.youtube.com/embed/${id}${time ? `?start=${time}` : ''}" style="position: absolute; width: 100%; height: 100%; top: 0; left: 0;" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe></div>`;
    }
  },
  {
    name: 'vimeo',
    url: [/^vimeo\.com\/(\d+)/, /^vimeo\.com\/[^/]+\/[^/]+\/video\/(\d+)/, /^vimeo\.com\/album\/[^/]+\/video\/(\d+)/, /^vimeo\.com\/channels\/[^/]+\/(\d+)/, /^vimeo\.com\/groups\/[^/]+\/videos\/(\d+)/, /^vimeo\.com\/ondemand\/[^/]+\/(\d+)/, /^player\.vimeo\.com\/video\/(\d+)/],
    html: match => `<div style="position: relative; padding-bottom: 100%; height: 0; padding-bottom: 56.2493%;"><iframe src="https://player.vimeo.com/video/${match[1]}" style="position: absolute; width: 100%; height: 100%; top: 0; left: 0;" frameborder="0" webkitallowfullscreen mozallowfullscreen allowfullscreen></iframe></div>`
  },
  { name: 'spotify', url: [/^open\.spotify\.com\/(artist\/\w+)/, /^open\.spotify\.com\/(album\/\w+)/, /^open\.spotify\.com\/(track\/\w+)/], html: match => `<div style="position: relative; padding-bottom: 100%; height: 0; padding-bottom: 126%;"><iframe src="https://open.spotify.com/embed/${match[1]}" style="position: absolute; width: 100%; height: 100%; top: 0; left: 0;" frameborder="0" allowtransparency="true" allow="encrypted-media"></iframe></div>` },
  { name: 'dailymotion', url: /^dailymotion\.com\/video\/(\w+)/, html: match => `<div style="position: relative; padding-bottom: 100%; height: 0; padding-bottom: 56.2493%;"><iframe src="https://www.dailymotion.com/embed/video/${match[1]}" style="position: absolute; width: 100%; height: 100%; top: 0; left: 0;" frameborder="0" allowfullscreen allow="autoplay"></iframe></div>` },
  { name: 'instagram', url: /^instagram\.com\/p\/(\w+)/ },
  { name: 'twitter', url: /^twitter\.com/ },
  { name: 'googleMaps', url: [/^google\.com\/maps/, /^goo\.gl\/maps/, /^maps\.google\.com/, /^maps\.app\.goo\.gl/] },
  { name: 'flickr', url: /^flickr\.com/ },
  { name: 'facebook', url: /^facebook\.com/ }
];

export class MediaRegistry {
  public readonly providerDefinitions: MediaProvider[];
  private readonly _locale: Locale;

  constructor(locale: Locale, config: { providers?: MediaProvider[]; extraProviders?: MediaProvider[]; removeProviders?: string[] }) {
    const providers = config.providers || DEFAULT_PROVIDERS;
    const extraProviders = config.extraProviders || [];
    const removedProviders = new Set(config.removeProviders || []);
    this._locale = locale;
    this.providerDefinitions = providers.concat(extraProviders).filter(provider => !removedProviders.has(provider.name));
  }

  public hasMedia(url: string): boolean {
    return !!this._getMedia(url);
  }

  public getMediaViewElement(writer: any, url: string, options: { renderMediaPreview?: boolean; renderForEditingView?: boolean; elementName?: string }): any {
    return this._getMedia(url)!.getViewElement(writer, options);
  }

  private _getMedia(url: string): Media | null {
    if (!url) return new Media(this._locale);
    url = url.trim();
    for (const definition of this.providerDefinitions) {
      const previewRenderer = definition.html;
      const pattern = Array.isArray(definition.url) ? definition.url : [definition.url];
      for (const subPattern of pattern) {
        const match = this._getUrlMatches(url, subPattern);
        if (match) return new Media(this._locale, url, match, previewRenderer);
      }
    }
    return null;
  }

  private _getUrlMatches(url: string, pattern: RegExp): RegExpMatchArray | null {
    let match = url.match(pattern);
    if (match) return match;
    let rawUrl = url.replace(/^https?:\/\//, '');
    match = rawUrl.match(pattern);
    if (match) return match;
    rawUrl = rawUrl.replace(/^www\./, '');
    match = rawUrl.match(pattern);
    if (match) return match;
    return null;
  }
}

class Media {
  public readonly url: string | null;
  private readonly _locale: Locale;
  private readonly _match?: RegExpMatchArray;
  private readonly _previewRenderer?: (match: RegExpMatchArray) => string;

  constructor(locale: Locale, url?: string, match?: RegExpMatchArray, previewRenderer?: (match: RegExpMatchArray) => string) {
    this.url = url ? this._getValidUrl(url) : null;
    this._locale = locale;
    this._match = match;
    this._previewRenderer = previewRenderer;
  }

  public getViewElement(writer: any, options: { renderMediaPreview?: boolean; renderForEditingView?: boolean; elementName?: string }): any {
    const attributes: Record<string, string> = {};
    let viewElement: any;
    if (options.renderForEditingView || (options.renderMediaPreview && this.url && this._previewRenderer)) {
      if (this.url) attributes['data-oembed-url'] = this.url;
      if (options.renderForEditingView) attributes.class = 'ck-media__wrapper';
      const mediaHtml = this._getPreviewHtml(options);
      viewElement = writer.createRawElement('div', attributes, (domElement: HTMLElement, domConverter: any) => {
        domConverter.setContentOf(domElement, mediaHtml);
      });
    } else {
      if (this.url) attributes.url = this.url;
      viewElement = writer.createEmptyElement(options.elementName || 'oembed', attributes);
    }
    writer.setCustomProperty('media-content', true, viewElement);
    return viewElement;
  }

  private _getPreviewHtml(options: { renderForEditingView?: boolean }): string {
    if (this._previewRenderer && this._match) {
      return this._previewRenderer(this._match);
    }
    if (this.url && options.renderForEditingView) {
      return `<div class="ck ck-media__placeholder"><div class="ck-media__placeholder__url"><a class="ck-media__placeholder__url__text" href="${this.url}" target="_blank" rel="noopener noreferrer">${this.url}</a></div></div>`;
    }
    return '';
  }

  private _getValidUrl(url: string): string {
    if (!url) return url;
    if (url.match(/^https?/)) return url;
    return 'https://' + url;
  }
}

export class MediaEmbedCommand extends Command {
  public override refresh(): void {
    const model = this.editor.model;
    const selection = model.document.selection;
    const selectedMedia = getSelectedMediaModelWidget(selection);
    this.value = selectedMedia ? (selectedMedia.getAttribute('url') as string) : undefined;
    this.isEnabled = isMediaSelected(selection) || isAllowedInParent(selection, model);
  }

  public override execute(url: string): void {
    const model = this.editor.model;
    const selection = model.document.selection;
    const selectedMedia = getSelectedMediaModelWidget(selection);
    if (selectedMedia) {
      model.change(writer => {
        writer.setAttribute('url', url, selectedMedia);
      });
    } else {
      insertMedia(model, url, selection as any, true);
    }
  }
}

function isAllowedInParent(selection: any, model: any): boolean {
  const insertionRange = findOptimalInsertionRangeRef()(selection, model);
  const parent = insertionRange.start.parent;
  return model.schema.checkChild(parent, 'media');
}

function isMediaSelected(selection: any): boolean {
  const element = selection.getSelectedElement();
  return !!element && element.name === 'media';
}

export function getSelectedMediaModelWidget(selection: any): any {
  const selectedElement = selection.getSelectedElement();
  if (selectedElement && selectedElement.is('element', 'media')) return selectedElement;
  return null;
}

export function insertMedia(model: any, url: string, selectable: any, findOptimalPosition: boolean): void {
  model.change((writer: any) => {
    const mediaElement = writer.createElement('media', { url });
    model.insertObject(mediaElement, selectable, null, { setSelection: 'on', findOptimalPosition: findOptimalPosition ? 'auto' : undefined });
  });
}

import { findOptimalInsertionRange } from '../../engine/model/utils/insertobject';
function findOptimalInsertionRangeRef() {
  return findOptimalInsertionRange;
}

export class MediaEmbedEditing extends Plugin {
  public registry!: MediaRegistry;

  public static override get pluginName(): string {
    return 'MediaEmbedEditing';
  }

  constructor(editor: Editor) {
    super(editor);
    editor.config.define('mediaEmbed', { elementName: 'oembed', providers: DEFAULT_PROVIDERS });
    this.registry = new MediaRegistry(editor.locale, editor.config.get('mediaEmbed') as any);
  }

  public override init(): void {
    const editor = this.editor;
    const schema = editor.model.schema;
    const t = editor.t;
    const conversion = editor.conversion;
    const renderMediaPreview = editor.config.get('mediaEmbed.previewsInData') as boolean;
    const elementName = editor.config.get('mediaEmbed.elementName') as string;
    const registry = this.registry;

    editor.commands.add('mediaEmbed', new MediaEmbedCommand(editor));
    schema.register('media', { inheritAllFrom: '$blockObject', allowAttributes: ['url'] });

    conversion.for('dataDowncast').elementToStructure({
      model: 'media',
      view: (modelElement, { writer }) => {
        const url = modelElement.getAttribute('url') as string;
        const figure = writer.createContainerElement('figure', { class: 'media' });
        const media = registry.getMediaViewElement(writer, url, { elementName, renderMediaPreview: !!url && !!renderMediaPreview });
        writer.insert(writer.createPositionAt(figure, 0), media);
        return figure;
      }
    });
    conversion.for('dataDowncast').add(dispatcher => dispatcher.on('attribute:url:media', (evt: any, data: any, conversionApi: any) => {
      conversionApi.consumable.consume(data.item, evt.name);
    }));
    conversion.for('editingDowncast').elementToStructure({
      model: 'media',
      view: (modelElement, { writer }) => {
        const url = modelElement.getAttribute('url') as string;
        const figure = writer.createContainerElement('figure', { class: 'media' });
        const media = registry.getMediaViewElement(writer, url, { renderForEditingView: true });
        writer.insert(writer.createPositionAt(figure, 0), media);
        return toWidget(figure, writer, { label: t('media widget') });
      }
    });
    conversion.for('editingDowncast').add(dispatcher => dispatcher.on('attribute:url:media', (evt: any, data: any, conversionApi: any) => {
      conversionApi.consumable.consume(data.item, evt.name);
    }));

    conversion.for('upcast').elementToElement({
      view: (element: any) => (element.is('element', elementName) && element.hasAttribute('url') ? { name: true, attributes: ['url'] } : null),
      model: (viewMedia, { writer }) => {
        const url = viewMedia.getAttribute('url')!;
        if (registry.hasMedia(url)) return writer.createElement('media', { url });
        return null;
      }
    });
    conversion.for('upcast').elementToElement({
      view: (element: any) => (element.is('element', 'div') && element.hasAttribute('data-oembed-url') ? { name: true, attributes: ['data-oembed-url'] } : null),
      model: (viewMedia, { writer }) => {
        const url = viewMedia.getAttribute('data-oembed-url')!;
        if (registry.hasMedia(url)) return writer.createElement('media', { url });
        return null;
      }
    });
    conversion.for('upcast').add(dispatcher => dispatcher.on('element:figure', (evt: any, data: any, conversionApi: any) => {
      if (!conversionApi.consumable.test(data.viewItem, { name: true, classes: 'media' })) return;
      const mediaChild = first(data.viewItem.getChildren()) as any;
      if (!mediaChild || !mediaChild.is('element')) return;
      conversionApi.consumable.consume(data.viewItem, { name: true, classes: 'media' });
      const result = conversionApi.convertItem(mediaChild, data.modelCursor);
      data.modelRange = result.modelRange;
      data.modelCursor = result.modelCursor;
    }));
  }
}

export class MediaFormView extends View {
  public readonly focusTracker = new FocusTracker();
  public readonly keystrokes = new KeystrokeHandler();
  public readonly urlInputView: LabeledFieldView<InputTextView>;
  public readonly saveButtonView: ButtonView;
  public readonly cancelButtonView: ButtonView;
  private readonly _focusables = this.createCollection();
  private readonly _focusCycler: FocusCycler;
  private readonly _validators: Array<(form: MediaFormView) => string | undefined>;
  private _urlInputViewInfoDefault = '';

  constructor(validators: Array<(form: MediaFormView) => string | undefined>, locale: Locale) {
    super(locale);
    const t = locale.t;
    this.urlInputView = this._createUrlInput();
    this.saveButtonView = this._createButton(t('Save'), icons.check, 'ck-button-save');
    this.saveButtonView.type = 'submit';
    this.cancelButtonView = this._createButton(t('Cancel'), icons.cancel, 'ck-button-cancel', 'cancel');
    this._validators = validators;
    this._focusCycler = new FocusCycler({ focusables: this._focusables, focusTracker: this.focusTracker, keystrokeHandler: this.keystrokes, actions: { focusPrevious: 'shift + tab', focusNext: 'tab' } });
    this.setTemplate({
      tag: 'form',
      attributes: { class: ['ck', 'ck-media-form', 'ck-insert-url-form', 'ck-responsive-form'], tabindex: '-1' },
      children: [this.urlInputView, this.saveButtonView, this.cancelButtonView]
    });
  }

  public override render(): void {
    super.render();
    submitHandler({ view: this });
    [this.urlInputView, this.saveButtonView, this.cancelButtonView].forEach(v => {
      this._focusables.add(v);
      this.focusTracker.add(v.element!);
    });
    this.keystrokes.listenTo(this.element as any);
  }

  public override destroy(): void {
    super.destroy();
    this.focusTracker.destroy();
    this.keystrokes.destroy();
  }

  public focus(): void {
    this._focusCycler.focusFirst();
  }

  public get url(): string {
    return this.urlInputView.fieldView.element!.value.trim();
  }

  public set url(url: string) {
    this.urlInputView.fieldView.element!.value = url.trim();
  }

  public isValid(): boolean {
    this.resetFormStatus();
    for (const validator of this._validators) {
      const errorText = validator(this);
      if (errorText) {
        this.urlInputView.errorText = errorText;
        return false;
      }
    }
    return true;
  }

  public resetFormStatus(): void {
    this.urlInputView.errorText = null;
    this.urlInputView.infoText = this._urlInputViewInfoDefault;
  }

  private _createUrlInput(): LabeledFieldView<InputTextView> {
    const t = this.locale!.t;
    const labeledInput = new LabeledFieldView(this.locale, createLabeledInputText);
    const inputField = labeledInput.fieldView;
    this._urlInputViewInfoDefault = t('Paste the media URL in the input.');
    labeledInput.label = t('Media URL');
    labeledInput.infoText = this._urlInputViewInfoDefault;
    inputField.on('input', () => {
      labeledInput.infoText = inputField.element!.value ? t('Tip: Paste the URL into the content to embed faster.') : this._urlInputViewInfoDefault;
    });
    return labeledInput;
  }

  private _createButton(label: string, icon: string, className: string, eventName?: string): ButtonView {
    const button = new ButtonView(this.locale);
    button.set({ label, icon, tooltip: true });
    button.extendTemplate({ attributes: { class: className } });
    if (eventName) button.delegate('execute').to(this, eventName);
    return button;
  }
}

export class MediaEmbedUI extends Plugin {
  public static override get requires() {
    return [MediaEmbedEditing];
  }

  public static override get pluginName(): string {
    return 'MediaEmbedUI';
  }

  public override init(): void {
    const editor = this.editor;
    const command = editor.commands.get('mediaEmbed')!;
    editor.ui.componentFactory.add('mediaEmbed', locale => {
      const dropdown = createDropdown(locale);
      this._setUpDropdown(dropdown, command);
      return dropdown;
    });
  }

  private _setUpDropdown(dropdown: any, command: Command): void {
    const editor = this.editor;
    const t = editor.t;
    const button = dropdown.buttonView;
    const registry = (editor.plugins.get(MediaEmbedEditing) as MediaEmbedEditing).registry;
    dropdown.once('change:isOpen', () => {
      const form = new MediaFormView(getFormValidators(editor.t, registry), editor.locale);
      dropdown.panelView.children.add(form);
      dropdown.on('change:isOpen', () => form.resetFormStatus());
      form.urlInputView.fieldView.bind('value').to(command, 'value');
      form.urlInputView.bind('isEnabled').to(command, 'isEnabled');
      form.saveButtonView.bind('isEnabled').to(command);
      form.on('submit', () => {
        if (form.isValid()) {
          editor.execute('mediaEmbed', form.url);
          closeUI();
        }
      });
      form.on('cancel', () => closeUI());
      form.keystrokes.set('Esc', (data, cancel) => {
        closeUI();
        cancel();
      });
      setTimeout(() => form.focus(), 0);
      dropdown.on('change:isOpen', () => {
        if (dropdown.isOpen) setTimeout(() => form.focus(), 0);
      });
    });
    dropdown.bind('isEnabled').to(command);
    button.set({ label: t('Insert media'), icon: icons.media, tooltip: true });
    function closeUI() {
      editor.editing.view.focus();
      dropdown.isOpen = false;
    }
  }
}

function getFormValidators(t: any, registry: MediaRegistry): Array<(form: MediaFormView) => string | undefined> {
  return [
    form => {
      if (!form.url.length) return t('The URL must not be empty.');
      return undefined;
    },
    form => {
      if (!registry.hasMedia(form.url)) return t('This media URL is not supported.');
      return undefined;
    }
  ];
}

/** Converts pasted media URLs into embeds automatically. */
export class AutoMediaEmbed extends Plugin {
  public static override get pluginName(): string {
    return 'AutoMediaEmbed';
  }

  public override init(): void {
    const editor = this.editor;
    const modelDocument = editor.model.document;
    const clipboardPipeline = editor.plugins.has('ClipboardPipeline') ? editor.plugins.get('ClipboardPipeline') : null;
    if (!clipboardPipeline) return;
    this.listenTo(clipboardPipeline as any, 'inputTransformation', (evt, data: any) => {
      const text = data.dataTransfer.getData('text/plain').trim();
      if (!text || /\s/.test(text)) return;
      const registry = (editor.plugins.get(MediaEmbedEditing) as MediaEmbedEditing).registry;
      if (!registry.hasMedia(text)) return;
      const selection = modelDocument.selection;
      const firstBlock = first(selection.getSelectedBlocks());
      if (firstBlock && firstBlock.is('element', 'codeBlock')) return;
      if (!firstBlock || !firstBlock.isEmpty) return;
      evt.stop();
      editor.model.change(() => {
        insertMedia(editor.model, text, selection, true);
      });
    }, { priority: 'high' });
  }
}

export class MediaEmbed extends Plugin {
  public static override get requires() {
    return [MediaEmbedEditing, MediaEmbedUI, AutoMediaEmbed, Widget];
  }

  public static override get pluginName(): string {
    return 'MediaEmbed';
  }
}
