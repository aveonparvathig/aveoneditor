import { Collection } from '../utils/collection';
import type { View } from './view';

/** Collection of views rendered into a parent DOM element. */
export class ViewCollection<T extends View = View> extends Collection<T> {
  private _parentElement: HTMLElement | null = null;

  constructor(initialItems: Iterable<T> = []) {
    super({ idProperty: 'viewUid' });
    this.on('add', (evt, view: T, index: number) => {
      this._renderViewIntoCollectionParent(view, index);
    });
    this.on('remove', (evt, view: T) => {
      if (view.element && this._parentElement) {
        view.element.remove();
      }
    });
    for (const item of initialItems) this.add(item);
  }

  public destroy(): void {
    this.map(view => view.destroy());
  }

  public setParent(elementOrDocFragment: HTMLElement | DocumentFragment): void {
    this._parentElement = elementOrDocFragment as HTMLElement;
    for (const view of this) {
      this._renderViewIntoCollectionParent(view);
    }
  }

  public override delegate(...events: string[]): { to(dest: any, nameOrFn?: any): void } {
    return {
      to: (dest, nameOrFn) => {
        for (const view of this) {
          for (const evtName of events) view.delegate(evtName).to(dest, nameOrFn);
        }
        this.on('add', (evt, view: T) => {
          for (const evtName of events) view.delegate(evtName).to(dest, nameOrFn);
        });
        this.on('remove', (evt, view: T) => {
          for (const evtName of events) view.stopDelegating(evtName, dest);
        });
      }
    };
  }

  private _renderViewIntoCollectionParent(view: T, index?: number): void {
    if (!view.isRendered) view.render();
    if (!this._parentElement || !view.element) return;
    if (index === undefined) index = this.getIndex(view);
    const ref = this._parentElement.children[index] || null;
    this._parentElement.insertBefore(view.element, ref);
  }
}
