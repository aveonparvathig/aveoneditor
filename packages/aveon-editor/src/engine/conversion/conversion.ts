import { DowncastHelpers, type ElementDefinition, type ElementToElementConfig, type AttributeToElementConfig, type AttributeToAttributeConfig } from './downcasthelpers';
import { UpcastHelpers } from './upcasthelpers';
import type { DowncastDispatcher } from './downcastdispatcher';
import type { UpcastDispatcher } from './upcastdispatcher';
import type { MatcherPattern } from '../view/matcher';
import type { PriorityString } from '../../utils/priorities';

export interface ConversionElementToElementConfig extends ElementToElementConfig {
  upcastAlso?: MatcherPattern | MatcherPattern[];
}

export interface ConversionAttributeToElementConfig extends AttributeToElementConfig {
  upcastAlso?: MatcherPattern | MatcherPattern[] | Record<string, MatcherPattern | MatcherPattern[]>;
}

export interface ConversionAttributeToAttributeConfig extends AttributeToAttributeConfig {
  upcastAlso?: MatcherPattern | MatcherPattern[] | Record<string, MatcherPattern | MatcherPattern[]>;
}

/**
 * Entry point for registering two-way converters: `editor.conversion.for('downcast')`,
 * `editor.conversion.for('upcast')`, or the shortcut methods that register both directions.
 */
export class Conversion {
  private _helpers = new Map<string, DowncastHelpers | UpcastHelpers>();
  private readonly _downcast: DowncastDispatcher[];
  private readonly _upcast: UpcastDispatcher[];

  constructor(downcastDispatchers: DowncastDispatcher | DowncastDispatcher[], upcastDispatchers: UpcastDispatcher | UpcastDispatcher[]) {
    this._downcast = Array.isArray(downcastDispatchers) ? downcastDispatchers : [downcastDispatchers];
    this._createConversionHelpers({ name: 'downcast', dispatchers: this._downcast, isDowncast: true });
    this._upcast = Array.isArray(upcastDispatchers) ? upcastDispatchers : [upcastDispatchers];
    this._createConversionHelpers({ name: 'upcast', dispatchers: this._upcast, isDowncast: false });
  }

  public addAlias(alias: string, dispatcher: DowncastDispatcher | UpcastDispatcher): void {
    const isDowncast = this._downcast.includes(dispatcher as DowncastDispatcher);
    const isUpcast = this._upcast.includes(dispatcher as UpcastDispatcher);
    if (!isUpcast && !isDowncast) {
      throw new Error('conversion-add-alias-dispatcher-not-registered');
    }
    this._createConversionHelpers({ name: alias, dispatchers: [dispatcher as any], isDowncast });
  }

  public for(groupName: 'downcast' | 'editingDowncast' | 'dataDowncast'): DowncastHelpers;
  public for(groupName: 'upcast'): UpcastHelpers;
  public for(groupName: string): DowncastHelpers | UpcastHelpers;
  public for(groupName: string): DowncastHelpers | UpcastHelpers {
    if (!this._helpers.has(groupName)) {
      throw new Error(`conversion-for-unknown-group: Trying to add a converter to an unknown group "${groupName}".`);
    }
    return this._helpers.get(groupName)!;
  }

  public elementToElement(definition: ConversionElementToElementConfig): void {
    this.for('downcast').elementToElement(definition);
    for (const { model, view } of getAllUpcastDefinitions(definition)) {
      this.for('upcast').elementToElement({ model: model as string, view: view as MatcherPattern, converterPriority: definition.converterPriority });
    }
  }

  public attributeToElement(definition: ConversionAttributeToElementConfig): void {
    this.for('downcast').attributeToElement(definition);
    for (const { model, view } of getAllUpcastDefinitions(definition)) {
      this.for('upcast').elementToAttribute({ view: view as MatcherPattern, model: model as any, converterPriority: definition.converterPriority });
    }
  }

  public attributeToAttribute(definition: ConversionAttributeToAttributeConfig): void {
    this.for('downcast').attributeToAttribute(definition);
    for (const { model, view } of getAllUpcastDefinitions(definition)) {
      this.for('upcast').attributeToAttribute({ view: view as any, model: model as any, converterPriority: definition.converterPriority });
    }
  }

  private _createConversionHelpers({ name, dispatchers, isDowncast }: { name: string; dispatchers: any[]; isDowncast: boolean }): void {
    if (this._helpers.has(name)) {
      throw new Error('conversion-group-exists');
    }
    const helpers = isDowncast ? new DowncastHelpers(dispatchers) : new UpcastHelpers(dispatchers);
    this._helpers.set(name, helpers);
  }
}

function* getAllUpcastDefinitions(definition: any): IterableIterator<{ model: unknown; view: unknown }> {
  if (definition.model.values) {
    for (const value of definition.model.values) {
      const model = { key: definition.model.key, value };
      const view = definition.view[value];
      const upcastAlso = definition.upcastAlso ? definition.upcastAlso[value] : undefined;
      yield* getUpcastDefinition(model, view, upcastAlso);
    }
  } else {
    yield* getUpcastDefinition(definition.model, definition.view, definition.upcastAlso);
  }
}

function* getUpcastDefinition(model: unknown, view: unknown, upcastAlso: unknown): IterableIterator<{ model: unknown; view: unknown }> {
  yield { model, view };
  if (upcastAlso) {
    for (const upcastAlsoItem of Array.isArray(upcastAlso) ? upcastAlso : [upcastAlso]) {
      yield { model, view: upcastAlsoItem };
    }
  }
}

export type { ElementDefinition, PriorityString };
