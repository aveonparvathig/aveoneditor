import { TextProxy } from '../model/textproxy';
import type { Item } from '../model/item';
import type { Selection } from '../model/selection';
import type { DocumentSelection } from '../model/documentselection';
import type { Range } from '../model/range';

type Consumable = Item | Selection | DocumentSelection | Range;

/** Tracks which model items (and their attributes/markers) were already converted. */
export class ModelConsumable {
  private _consumables = new Map<unknown, Map<string, boolean>>();
  private _textProxyRegistry = new Map<number | null, Map<number | null, Map<unknown, symbol>>>();

  public add(item: Consumable, type: string): void {
    type = normalizeConsumableType(type);
    const key = this._getKey(item);
    if (!this._consumables.has(key)) {
      this._consumables.set(key, new Map());
    }
    this._consumables.get(key)!.set(type, true);
  }

  public consume(item: Consumable, type: string): boolean {
    type = normalizeConsumableType(type);
    if (this.test(item, type)) {
      this._consumables.get(this._getKey(item))!.set(type, false);
      return true;
    }
    return false;
  }

  public test(item: Consumable, type: string): boolean | null {
    type = normalizeConsumableType(type);
    const itemConsumables = this._consumables.get(this._getKey(item));
    if (itemConsumables === undefined) return null;
    const value = itemConsumables.get(type);
    if (value === undefined) return null;
    return value;
  }

  public revert(item: Consumable, type: string): boolean | null {
    type = normalizeConsumableType(type);
    const test = this.test(item, type);
    if (test === false) {
      this._consumables.get(this._getKey(item))!.set(type, true);
      return true;
    } else if (test === true) {
      return false;
    }
    return null;
  }

  public verifyAllConsumed(_eventGroup: string): void {
    /* diagnostics only */
  }

  private _getKey(item: Consumable): unknown {
    if (item instanceof TextProxy) {
      return this._getSymbolForTextProxy(item);
    }
    return item;
  }

  private _getSymbolForTextProxy(textProxy: TextProxy): symbol {
    let symbol: symbol | undefined;
    const startMap = this._textProxyRegistry.get(textProxy.startOffset);
    if (startMap) {
      const endMap = startMap.get(textProxy.endOffset);
      if (endMap) {
        symbol = endMap.get(textProxy.parent);
      }
    }
    if (!symbol) {
      symbol = this._addSymbolForTextProxy(textProxy);
    }
    return symbol;
  }

  private _addSymbolForTextProxy(textProxy: TextProxy): symbol {
    const symbol = Symbol('textProxySymbol');
    const start = textProxy.startOffset;
    const end = textProxy.endOffset;
    const parent = textProxy.parent;
    let startMap = this._textProxyRegistry.get(start);
    if (!startMap) {
      startMap = new Map();
      this._textProxyRegistry.set(start, startMap);
    }
    let endMap = startMap.get(end);
    if (!endMap) {
      endMap = new Map();
      startMap.set(end, endMap);
    }
    endMap.set(parent, symbol);
    return symbol;
  }
}

function normalizeConsumableType(type: string): string {
  const parts = type.split(':');
  if (parts[0] === 'attribute' || parts[0] === 'addMarker' || parts[0] === 'removeMarker') {
    return parts.slice(0, 2).join(':');
  }
  return parts[0];
}
