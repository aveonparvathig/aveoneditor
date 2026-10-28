import { Observable } from '../utils/observable';
import { Collection } from '../utils/collection';
import { Template, type TemplateDefinition, type BindChain } from './template';
import { ViewCollection } from './viewcollection';
import type { Locale } from '../utils/locale';
import { uid } from '../utils/uid';

/**
 * Base UI view: a template rendered into a DOM element with observable bindings.
 */
export class View extends Observable {
  public element: HTMLElement | null = null;
  public isRendered = false;
  public locale?: Locale;
  public t?: Locale['t'];
  public template?: Template;
  public readonly viewUid = uid();
  protected _viewCollections = new Collection<ViewCollection>();
  protected _unboundChildren = this.createCollection();

  constructor(locale?: Locale) {
    super();
    this.locale = locale;
    this.t = locale && locale.t;
    this._viewCollections.on('add', (evt, collection: ViewCollection) => {
      collection.locale = locale;
      collection.t = locale && locale.t;
    });
    this.decorate('render');
  }

  public get bindTemplate(): BindChain {
    return Template.bind(this, this);
  }

  public createCollection<T extends View = View>(views?: Iterable<T>): ViewCollection<T> {
    const collection = new ViewCollection<T>(views);
    this._viewCollections.add(collection as any);
    return collection;
  }

  public registerChild(children: View | Iterable<View>): void {
    const items = isIterableViews(children) ? children : [children];
    for (const child of items) this._unboundChildren.add(child);
  }

  public deregisterChild(children: View | Iterable<View>): void {
    const items = isIterableViews(children) ? children : [children];
    for (const child of items) this._unboundChildren.remove(child);
  }

  public setTemplate(definition: TemplateDefinition): void {
    this.template = new Template(definition);
  }

  public extendTemplate(definition: TemplateDefinition): void {
    Template.extend(this.template!, definition);
  }

  /** Renders the template; fires `render`. */
  public render(): void {
    if (this.isRendered) throw new Error('ui-view-render-already-rendered');
    if (this.template) {
      this.element = this.template.render() as HTMLElement;
      this.registerChild(this.template.getViews());
    }
    this.isRendered = true;
  }

  public destroy(): void {
    this.stopListening();
    this._viewCollections.map(c => c.destroy());
    if (this.template && (this.template as any)._revertData) {
      this.template.revert(this.element!);
    }
  }
}

function isIterableViews(value: unknown): value is Iterable<View> {
  return !!value && typeof (value as any)[Symbol.iterator] === 'function' && !(value instanceof View);
}

declare module './viewcollection' {
  interface ViewCollection {
    locale?: Locale;
    t?: Locale['t'];
  }
}
