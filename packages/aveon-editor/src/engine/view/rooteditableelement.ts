import { EditableElement } from './editableelement';
import type { Document } from './document';

/** Root editable element of the editing view. */
export class RootEditableElement extends EditableElement {
  public rootName: string;

  constructor(document: Document, name: string) {
    super(document, name);
    this.rootName = 'main';
  }

  public override is(type: string, name?: string): boolean {
    if (!name) {
      return type === 'rootElement' || type === 'view:rootElement' || super.is(type);
    }
    return name === this.name && (type === 'rootElement' || type === 'view:rootElement' || type === 'editableElement' || type === 'view:editableElement' || type === 'containerElement' || type === 'view:containerElement' || type === 'element' || type === 'view:element');
  }
}
