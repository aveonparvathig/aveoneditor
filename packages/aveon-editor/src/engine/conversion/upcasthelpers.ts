import { ConversionHelpers } from './conversionhelpers';
import { Matcher, type MatcherPattern, type Match } from '../view/matcher';
import type { UpcastDispatcher, UpcastConversionApi, UpcastConversionData } from './upcastdispatcher';
import type { Element as ViewElement } from '../view/element';
import type { Element as ModelElement } from '../model/element';
import type { Range as ModelRange } from '../model/range';
import type { Model } from '../model/model';
import type { Mapper } from './mapper';
import type { EventInfo } from '../../utils/eventinfo';
import type { PriorityString } from '../../utils/priorities';
import { isParagraphable, wrapInParagraph } from '../model/utils/autoparagraphing';

export type ModelElementCreator = (viewElement: ViewElement, conversionApi: UpcastConversionApi) => ModelElement | null;
export type ModelAttributeValueCreator = (viewElement: ViewElement, conversionApi: UpcastConversionApi) => unknown;

export interface UpcastElementToElementConfig {
  view: MatcherPattern;
  model: string | ModelElementCreator;
  converterPriority?: PriorityString;
}

export interface UpcastElementToAttributeConfig {
  view: MatcherPattern;
  model: string | { key: string; value?: unknown | ModelAttributeValueCreator };
  converterPriority?: PriorityString;
}

export interface UpcastAttributeToAttributeConfig {
  view: string | { key?: string; value?: unknown; name?: string; classes?: unknown; styles?: unknown; attributes?: unknown };
  model: string | { key: string; value?: unknown | ModelAttributeValueCreator };
  converterPriority?: PriorityString;
}

/** Upcast (view → model) conversion helpers. */
export class UpcastHelpers extends ConversionHelpers<UpcastDispatcher> {
  public elementToElement(config: UpcastElementToElementConfig): this {
    return this.add(upcastElementToElement(config));
  }

  public elementToAttribute(config: UpcastElementToAttributeConfig): this {
    return this.add(upcastElementToAttribute(config));
  }

  public attributeToAttribute(config: UpcastAttributeToAttributeConfig): this {
    return this.add(upcastAttributeToAttribute(config));
  }

  public elementToMarker(config: { view: MatcherPattern; model: string | ((viewElement: ViewElement, conversionApi: UpcastConversionApi) => string); converterPriority?: PriorityString }): this {
    return this.add(upcastElementToMarker(config));
  }

  public dataToMarker(config: { view: string; model?: (name: string, conversionApi: UpcastConversionApi) => string; converterPriority?: PriorityString }): this {
    return this.add(upcastDataToMarker(config));
  }
}

/** Default view text converter. */
export function convertText() {
  return (evt: EventInfo, data: UpcastConversionData, { schema, consumable, writer }: UpcastConversionApi): void => {
    let position = data.modelCursor;
    if (!consumable.test(data.viewItem as any)) return;
    if (!schema.checkChild(position, '$text')) {
      if (!isParagraphable(position, '$text', schema)) return;
      if ((data.viewItem as any).data.trim().length === 0) return;
      const nodeBefore = position.nodeBefore;
      position = wrapInParagraph(position, writer);
      if (nodeBefore && (nodeBefore as any).is('element', 'paragraph')) {
        // Keep as new paragraph.
      }
    }
    consumable.consume(data.viewItem as any);
    const text = writer.createText((data.viewItem as any).data);
    writer.insert(text, position);
    data.modelRange = writer.createRange(position, position.getShiftedBy(text.offsetSize));
    data.modelCursor = data.modelRange.end;
  };
}

/** Default fallback converter: converts the children of unknown elements and document fragments. */
export function convertToModelFragment() {
  return (evt: EventInfo, data: UpcastConversionData, conversionApi: UpcastConversionApi): void => {
    if (!data.modelRange && conversionApi.consumable.consume(data.viewItem as any, { name: true })) {
      const { modelRange, modelCursor } = conversionApi.convertChildren(data.viewItem as ViewElement, data.modelCursor);
      data.modelRange = modelRange;
      data.modelCursor = modelCursor;
    }
  };
}

/** Converts view selection changes into model selection changes. */
export function convertSelectionChange(model: Model, mapper: Mapper) {
  return (evt: EventInfo, data: { newSelection: any }): void => {
    const viewSelection = data.newSelection;
    const ranges: ModelRange[] = [];
    for (const viewRange of viewSelection.getRanges()) {
      try {
        ranges.push(mapper.toModelRange(viewRange));
      } catch {
        // Unmapped range (e.g. UI element); skip.
      }
    }
    if (!ranges.length) return;
    const modelSelection = model.createSelection(ranges, { backward: viewSelection.isBackward });
    if (!modelSelection.isEqual(model.document.selection as any)) {
      model.change(writer => {
        writer.setSelection(modelSelection);
      });
    }
  };
}

function upcastElementToElement(config: UpcastElementToElementConfig) {
  const converter = prepareToElementConverter(config);
  const elementName = getViewElementNameFromConfig(config.view);
  const eventName = elementName ? `element:${elementName}` : 'element';
  return (dispatcher: UpcastDispatcher) => {
    dispatcher.on(eventName, converter, { priority: config.converterPriority || 'normal' });
  };
}

function upcastElementToAttribute(config: UpcastElementToAttributeConfig) {
  const normalized = normalizeModelAttributeConfig(config.model, null);
  const converter = prepareToAttributeConverter(config.view, normalized, false);
  const elementName = getViewElementNameFromConfig(config.view);
  const eventName = elementName ? `element:${elementName}` : 'element';
  return (dispatcher: UpcastDispatcher) => {
    dispatcher.on(eventName, converter, { priority: config.converterPriority || 'low' });
  };
}

function upcastAttributeToAttribute(config: UpcastAttributeToAttributeConfig) {
  let viewKey: string | null = null;
  if (typeof config.view === 'string' || (config.view as any).key) {
    viewKey = normalizeViewAttributeKeyValueConfig(config);
  }
  const normalized = normalizeModelAttributeConfig(config.model, viewKey);
  const converter = prepareToAttributeConverter((config as any).view, normalized, true);
  const name = typeof config.view === 'object' ? config.view.name : undefined;
  return (dispatcher: UpcastDispatcher) => {
    dispatcher.on(name ? `element:${name}` : 'element', converter, { priority: config.converterPriority || 'low' });
  };
}

function upcastElementToMarker(config: { view: MatcherPattern; model: string | ((viewElement: ViewElement, conversionApi: UpcastConversionApi) => string); converterPriority?: PriorityString }) {
  const model = (viewElement: ViewElement, conversionApi: UpcastConversionApi) => {
    const markerName = typeof config.model === 'string' ? config.model : config.model(viewElement, conversionApi);
    return conversionApi.writer.createElement('$marker', { 'data-name': markerName });
  };
  return upcastElementToElement({ view: config.view, model, converterPriority: config.converterPriority });
}

function upcastDataToMarker(config: { view: string; model?: (name: string, conversionApi: UpcastConversionApi) => string; converterPriority?: PriorityString }) {
  const group = config.view;
  const model = config.model || ((name: string) => `${group}:${name}`);
  return (dispatcher: UpcastDispatcher) => {
    for (const edge of ['start', 'end']) {
      dispatcher.on(`element:${group}-${edge}`, (evt: EventInfo, data: UpcastConversionData, conversionApi: UpcastConversionApi) => {
        const viewItem = data.viewItem as ViewElement;
        if (!conversionApi.consumable.consume(viewItem as any, { name: true })) return;
        const markerName = model(viewItem.getAttribute('name')!, conversionApi);
        const marker = conversionApi.writer.createElement('$marker', { 'data-name': markerName });
        conversionApi.writer.insert(marker, data.modelCursor);
        data.modelCursor = conversionApi.writer.createPositionAfter(marker);
        data.modelRange = conversionApi.writer.createRange(conversionApi.writer.createPositionBefore(marker), data.modelCursor);
      }, { priority: config.converterPriority || 'normal' });
    }
  };
}

function getViewElementNameFromConfig(viewConfig: MatcherPattern): string | null {
  if (typeof viewConfig === 'string') return viewConfig;
  if (typeof viewConfig === 'object' && !(viewConfig instanceof RegExp) && typeof (viewConfig as any).name === 'string') {
    return (viewConfig as any).name;
  }
  return null;
}

function prepareToElementConverter(config: UpcastElementToElementConfig) {
  const matcher = new Matcher(config.view);
  return (evt: EventInfo, data: UpcastConversionData, conversionApi: UpcastConversionApi): void => {
    const matcherResult = matcher.match(data.viewItem as ViewElement);
    if (!matcherResult) return;
    const match = matcherResult.match;
    match.name = true;
    const modelElement = getModelElement(config.model, data.viewItem as ViewElement, conversionApi);
    if (!modelElement) return;
    if (!conversionApi.consumable.test(data.viewItem as any, match)) return;
    if (!conversionApi.safeInsert(modelElement, data.modelCursor)) return;
    conversionApi.consumable.consume(data.viewItem as any, match);
    conversionApi.convertChildren(data.viewItem as ViewElement, modelElement);
    conversionApi.updateConversionResult(modelElement, data);
  };
}

function getModelElement(model: string | ModelElementCreator, input: ViewElement, conversionApi: UpcastConversionApi): ModelElement | null {
  if (typeof model === 'function') {
    return model(input, conversionApi);
  }
  return conversionApi.writer.createElement(model);
}

function normalizeViewAttributeKeyValueConfig(config: UpcastAttributeToAttributeConfig): string {
  if (typeof config.view === 'string') {
    config.view = { key: config.view };
  }
  const key = (config.view as { key: string; value?: unknown; name?: string }).key;
  let normalized: any;
  if (key === 'class' || key === 'style') {
    const keyName = key === 'class' ? 'classes' : 'styles';
    normalized = { [keyName]: (config.view as any).value };
  } else {
    const value = typeof (config.view as any).value === 'undefined' ? /[\s\S]*/ : (config.view as any).value;
    normalized = { attributes: { [key]: value } };
  }
  if ((config.view as any).name) {
    normalized.name = (config.view as any).name;
  }
  config.view = normalized;
  return key;
}

function normalizeModelAttributeConfig(model: string | { key: string; value?: unknown | ModelAttributeValueCreator }, viewAttributeKeyToCopy: string | null): { key: string; value: unknown | ModelAttributeValueCreator } {
  const defaultModelValue = viewAttributeKeyToCopy === null ? true : (viewElement: ViewElement) => viewElement.getAttribute(viewAttributeKeyToCopy);
  const key = typeof model !== 'object' ? model : model.key;
  const value = typeof model !== 'object' || typeof model.value === 'undefined' ? defaultModelValue : model.value;
  return { key, value };
}

function prepareToAttributeConverter(viewConfig: MatcherPattern, modelConfig: { key: string; value: unknown | ModelAttributeValueCreator }, shallow: boolean) {
  const matcher = new Matcher(viewConfig);
  return (evt: EventInfo, data: UpcastConversionData, conversionApi: UpcastConversionApi): void => {
    if (!(data.viewItem as any).is('element')) return;
    const match = matcher.match(data.viewItem as ViewElement);
    if (!match) return;
    if (onlyViewNameIsDefined(viewConfig, data.viewItem as ViewElement)) {
      match.match.name = true;
    } else {
      delete match.match.name;
    }
    const modelKey = modelConfig.key;
    const modelValue = typeof modelConfig.value === 'function' ? (modelConfig.value as ModelAttributeValueCreator)(data.viewItem as ViewElement, conversionApi) : modelConfig.value;
    if (modelValue === null || modelValue === undefined) return;
    if (!conversionApi.consumable.test(data.viewItem as any, match.match)) return;
    if (!data.modelRange) {
      Object.assign(data, conversionApi.convertChildren(data.viewItem as ViewElement, data.modelCursor));
    }
    const attributeWasSet = setAttributeOn(data.modelRange!, { key: modelKey, value: modelValue }, shallow, conversionApi);
    if (attributeWasSet) {
      if (conversionApi.consumable.test(data.viewItem as any, match.match)) {
        conversionApi.consumable.consume(data.viewItem as any, match.match);
      }
    }
  };
}

function onlyViewNameIsDefined(viewConfig: MatcherPattern, viewItem: ViewElement): boolean {
  const configToTest = typeof viewConfig === 'function' ? viewConfig(viewItem) : viewConfig;
  if (typeof configToTest === 'object' && configToTest !== null && !(configToTest instanceof RegExp) && !getViewElementNameFromConfig(configToTest as any)) {
    return false;
  }
  if (typeof configToTest === 'object' && configToTest !== null && !(configToTest instanceof RegExp)) {
    const obj = configToTest as any;
    return !obj.classes && !obj.attributes && !obj.styles;
  }
  return true;
}

function setAttributeOn(modelRange: ModelRange, modelAttribute: { key: string; value: unknown }, shallow: boolean, conversionApi: UpcastConversionApi): boolean {
  let result = false;
  for (const node of Array.from(modelRange.getItems({ shallow }))) {
    if (conversionApi.schema.checkAttribute(node as any, modelAttribute.key)) {
      conversionApi.writer.setAttribute(modelAttribute.key, modelAttribute.value, node as any);
      result = true;
    }
  }
  return result;
}

export type { Match };
