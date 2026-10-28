import { Emitter } from './emitter';

/** Ordered collection of items with `add`/`remove`/`change` events. */
export class Collection<T extends object = any> extends Emitter implements Iterable<T> {
  private _items: T[] = [];
  private _itemMap = new Map<string, T>();
  private _idProperty: string;

  constructor(options: { idProperty?: string } = {}) {
    super();
    this._idProperty = options.idProperty ?? 'id';
  }

  public get length(): number {
    return this._items.length;
  }

  public get first(): T | null {
    return this._items[0] ?? null;
  }

  public get last(): T | null {
    return this._items[this._items.length - 1] ?? null;
  }

  public add(item: T, index?: number): this {
    return this.addMany([item], index);
  }

  public addMany(items: Iterable<T>, index?: number): this {
    const arr = [...items];
    const at = index === undefined ? this._items.length : index;
    if (at > this._items.length || at < 0) throw new Error('collection-add-item-invalid-index');
    let offset = 0;
    for (const item of arr) {
      const id = this._getItemId(item);
      if (this._itemMap.has(id)) throw new Error('collection-add-item-already-exists');
      this._items.splice(at + offset, 0, item);
      this._itemMap.set(id, item);
      this.fire('add', item, at + offset);
      offset++;
    }
    this.fire('change', { added: arr, removed: [], index: at });
    return this;
  }

  public get(idOrIndex: string | number): T | null {
    if (typeof idOrIndex === 'number') return this._items[idOrIndex] ?? null;
    return this._itemMap.get(idOrIndex) ?? null;
  }

  public has(itemOrId: T | string): boolean {
    if (typeof itemOrId === 'string') return this._itemMap.has(itemOrId);
    return this._items.includes(itemOrId);
  }

  public getIndex(itemOrId: T | string): number {
    const item = typeof itemOrId === 'string' ? this._itemMap.get(itemOrId) : itemOrId;
    return item ? this._items.indexOf(item) : -1;
  }

  public remove(subject: T | string | number): T {
    let item: T | undefined;
    if (typeof subject === 'number') item = this._items[subject];
    else if (typeof subject === 'string') item = this._itemMap.get(subject);
    else item = subject;
    if (!item) throw new Error('collection-remove-404');
    const index = this._items.indexOf(item);
    if (index === -1) throw new Error('collection-remove-404');
    this._items.splice(index, 1);
    this._itemMap.delete(this._getItemId(item));
    this.fire('remove', item, index);
    this.fire('change', { added: [], removed: [item], index });
    return item;
  }

  public map<U>(callback: (item: T, index: number) => U): U[] {
    return this._items.map(callback);
  }

  public forEach(callback: (item: T, index: number) => void): void {
    this._items.forEach(callback);
  }

  public find(callback: (item: T, index: number) => boolean): T | undefined {
    return this._items.find(callback);
  }

  public filter(callback: (item: T, index: number) => boolean): T[] {
    return this._items.filter(callback);
  }

  public clear(): void {
    while (this.length) this.remove(0);
  }

  public [Symbol.iterator](): Iterator<T> {
    return this._items[Symbol.iterator]();
  }

  private _getItemId(item: T): string {
    const obj = item as any;
    let id = obj[this._idProperty];
    if (id === undefined) {
      id = 'c' + Math.random().toString(36).slice(2, 10) + this._items.length;
      try {
        obj[this._idProperty] = id;
      } catch {
        /* ignore */
      }
    }
    return String(id);
  }
}
