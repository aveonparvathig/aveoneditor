import { Observable } from '../../utils/observable';
import { Mapper } from '../conversion/mapper';
import { DowncastDispatcher } from '../conversion/downcastdispatcher';
import { insertText, insertAttributesAndChildren, insertUnknownElementChildren, clearAttributes, convertCollapsedSelection, convertRangeSelection } from '../conversion/downcasthelpers';
import { convertSelectionChange } from '../conversion/upcasthelpers';
import { View } from '../view/view';
import { Range as ModelRange } from '../model/range';
import type { Model } from '../model/model';
import type { Element as ModelElement } from '../model/element';
import type { RootElement } from '../model/rootelement';
import type { Item as ModelItem } from '../model/item';
import type { Marker } from '../model/markercollection';
import type { Element as ViewElement } from '../view/element';
import type { DowncastWriter } from '../view/downcastwriter';

/**
 * Keeps the editing view in sync with the model: converts model changes to the view,
 * converts the selection and maps view selection changes back to the model.
 */
export class EditingController extends Observable {
  public readonly model: Model;
  public readonly view: View;
  public readonly mapper = new Mapper();
  public readonly downcastDispatcher: DowncastDispatcher;

  constructor(model: Model) {
    super();
    this.model = model;
    this.view = new View();
    this.downcastDispatcher = new DowncastDispatcher({ mapper: this.mapper, schema: model.schema });

    const doc = this.model.document;
    const selection = doc.selection;
    const markers = this.model.markers;

    this.listenTo(this.model, '_beforeChanges', () => {
      this.view._disableRendering(true);
    }, { priority: 'highest' });

    this.listenTo(this.model, '_afterChanges', () => {
      this.view._disableRendering(false);
    }, { priority: 'lowest' });

    this.listenTo(doc, 'change', () => {
      this.view.change(writer => {
        this._convertChanges(writer);
        this.downcastDispatcher.convertSelection(selection, markers, writer);
      });
    }, { priority: 'low' });

    this.listenTo(this.view.document, 'selectionChange', convertSelectionChange(this.model, this.mapper));

    this.downcastDispatcher.on('insert:$text', insertText(), { priority: 'lowest' });
    this.downcastDispatcher.on('insert', insertUnknownElementChildren(), { priority: 'lowest' });
    this.downcastDispatcher.on('insert', insertAttributesAndChildren(), { priority: 'lowest' });
    this.downcastDispatcher.on('selection', clearAttributes(), { priority: 'high' });
    this.downcastDispatcher.on('selection', convertRangeSelection(), { priority: 'low' });
    this.downcastDispatcher.on('selection', convertCollapsedSelection(), { priority: 'low' });

    // Create view roots for model roots.
    for (const root of doc.roots) {
      this._createViewRoot(root);
    }
    this.listenTo(doc.roots, 'add', (evt, root: RootElement) => {
      this._createViewRoot(root);
    });
  }

  /** Re-converts the given model item (and its block) in the editing view. */
  public reconvertItem(item: ModelItem): void {
    this.model.change(() => {
      this.model.document.differ._refreshItem(item);
    });
  }

  public reconvertMarker(markerOrName: Marker | string): void {
    const name = typeof markerOrName === 'string' ? markerOrName : markerOrName.name;
    const marker = this.model.markers.get(name);
    if (!marker) throw new Error('editingcontroller-reconvertmarker-marker-not-exist');
    this.model.change(writer => {
      writer.updateMarker(marker);
    });
  }

  public destroy(): void {
    this.view.destroy();
    this.stopListening();
  }

  private _createViewRoot(root: RootElement): void {
    if (root.rootName === '$graveyard') return;
    if (this.view.document.getRoot(root.rootName)) return;
    const viewRoot = this.view._createRoot(root.name, root.rootName);
    this.mapper.bindElements(root, viewRoot);
  }

  private _convertChanges(writer: DowncastWriter): void {
    const differ = this.model.document.differ;
    const markers = this.model.markers;
    const changes = differ.getChanges();

    // Markers whose ranges changed: remove their view artefacts for the old range (UI elements etc).
    for (const { name, range } of differ.getMarkersToRemove()) {
      const elements = this.mapper.markerNameToElements(name);
      if (elements) {
        this.downcastDispatcher.convertMarkerRemove(name, range, writer);
      }
    }

    for (const entry of changes) {
      if (entry.type === 'remove' || entry.type === 'refresh') {
        const viewElement = this.mapper.toViewElement(entry.node as ModelElement) as ViewElement | undefined;
        if (viewElement && (viewElement as any).is('element') && viewElement.parent) {
          writer.remove(writer.createRangeOn(viewElement));
          this.mapper.unbindViewTree(viewElement);
        } else if (viewElement && (viewElement as any).is('element')) {
          this.mapper.unbindViewTree(viewElement);
        }
      }
      if (entry.type === 'insert' || entry.type === 'refresh') {
        this.downcastDispatcher.convertInsert(ModelRange._createOn(entry.node), writer, markers);
      }
      if (entry.type === 'attribute') {
        const root = entry.range.root as RootElement;
        this.downcastDispatcher.convertRootAttribute(root, entry.attributeKey, entry.attributeOldValue, entry.attributeNewValue, writer);
      }
    }

    // Markers added or changed whose blocks were not refreshed are handled by the differ marking blocks dirty.
    this.mapper.flushUnboundMarkerNames();
    this.mapper.flushDeferredBindings();
  }
}
