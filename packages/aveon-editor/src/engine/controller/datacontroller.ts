import { Observable } from '../../utils/observable';
import { Mapper } from '../conversion/mapper';
import { DowncastDispatcher } from '../conversion/downcastdispatcher';
import { UpcastDispatcher } from '../conversion/upcastdispatcher';
import { insertText, insertAttributesAndChildren, insertUnknownElementChildren } from '../conversion/downcasthelpers';
import { convertText, convertToModelFragment } from '../conversion/upcasthelpers';
import { Document as ViewDocument } from '../view/document';
import { DowncastWriter } from '../view/downcastwriter';
import { DocumentFragment as ViewDocumentFragment } from '../view/documentfragment';
import { HtmlDataProcessor, type DataProcessor } from '../dataprocessor/htmldataprocessor';
import { Range as ModelRange } from '../model/range';
import { DocumentFragment as ModelDocumentFragment } from '../model/documentfragment';
import type { Model } from '../model/model';
import type { Element as ModelElement } from '../model/element';
import type { Element as ViewElement } from '../view/element';
import type { BatchType } from '../model/batch';
import type { SchemaContextDefinition } from '../model/schema';

/**
 * Handles loading (`init`/`set`) and retrieving (`get`) editor data through the
 * data pipeline: HTML ⇄ data view ⇄ model.
 */
export class DataController extends Observable {
  public readonly model: Model;
  public readonly mapper = new Mapper();
  public readonly downcastDispatcher: DowncastDispatcher;
  public readonly upcastDispatcher: UpcastDispatcher;
  public readonly viewDocument = new ViewDocument();
  public readonly htmlProcessor: HtmlDataProcessor;
  public processor: DataProcessor;
  private readonly _viewWriter: DowncastWriter;

  constructor(model: Model) {
    super();
    this.model = model;
    this.downcastDispatcher = new DowncastDispatcher({ mapper: this.mapper, schema: model.schema });
    this.downcastDispatcher.on('insert:$text', insertText(), { priority: 'lowest' });
    this.downcastDispatcher.on('insert', insertUnknownElementChildren(), { priority: 'lowest' });
    this.downcastDispatcher.on('insert', insertAttributesAndChildren(), { priority: 'lowest' });

    this.upcastDispatcher = new UpcastDispatcher({ schema: model.schema });
    this.upcastDispatcher.on('text', convertText(), { priority: 'lowest' });
    this.upcastDispatcher.on('element', convertToModelFragment(), { priority: 'lowest' });
    this.upcastDispatcher.on('documentFragment', convertToModelFragment(), { priority: 'lowest' });

    this.htmlProcessor = new HtmlDataProcessor(this.viewDocument);
    this.processor = this.htmlProcessor;
    this._viewWriter = new DowncastWriter(this.viewDocument);

    this.decorate('init');
    this.decorate('set');
    this.decorate('get');
    this.decorate('toView');
    this.decorate('toModel');

    this.on('init', () => {
      this.fire('ready');
    }, { priority: 'lowest' });

    this.on('ready', () => {
      (this.model as any).enqueueChange({ isUndoable: false }, (writer: any) => {
        writer.setSelection(null);
      });
    }, { priority: 'lowest' });
  }

  public get(options: { rootName?: string; trim?: 'empty' | 'none' } = {}): string {
    const { rootName = 'main', trim = 'empty' } = options;
    if (!this._checkIfRootsExists([rootName])) {
      throw new Error(`datacontroller-get-non-existent-root: Root "${rootName}" does not exist.`);
    }
    const root = this.model.document.getRoot(rootName)!;
    if (!root.isAttached() && !root.isEmpty) {
      return '';
    }
    if (trim === 'empty' && !this.model.hasContent(root, { ignoreWhitespaces: true })) {
      return '';
    }
    return this.stringify(root, options);
  }

  public stringify(modelElementOrFragment: ModelElement | ModelDocumentFragment, options: Record<string, unknown> = {}): string {
    const viewDocumentFragment = this.toView(modelElementOrFragment, options);
    return this.processor.toData(viewDocumentFragment);
  }

  public toView(modelElementOrFragment: ModelElement | ModelDocumentFragment, options: Record<string, unknown> = {}): ViewDocumentFragment {
    const viewDocument = this.viewDocument;
    const viewWriter = this._viewWriter;
    this.mapper.clearBindings();
    const modelRange = ModelRange._createIn(modelElementOrFragment);
    const viewDocumentFragment = new ViewDocumentFragment(viewDocument);
    this.mapper.bindElements(modelElementOrFragment, viewDocumentFragment);

    const markers = new Map<string, ModelRange>();
    if (modelElementOrFragment instanceof ModelDocumentFragment) {
      for (const [name, range] of modelElementOrFragment.markers) markers.set(name, range);
    } else {
      for (const marker of this.model.markers.getMarkersIntersectingRange(modelRange)) {
        if (!marker.affectsData) continue;
        const intersection = marker.getRange().getIntersection(modelRange);
        if (intersection) markers.set(marker.name, intersection);
      }
    }
    this.downcastDispatcher.convert(modelRange, markers, viewWriter, options);
    return viewDocumentFragment;
  }

  public init(data: string | Record<string, string>): Promise<void> {
    if (this.model.document.version) {
      throw new Error('datacontroller-init-document-not-empty: Trying to set initial data on a non-empty document.');
    }
    let initialData: Record<string, string> = {};
    if (typeof data === 'string') {
      initialData.main = data;
    } else {
      initialData = data;
    }
    if (!this._checkIfRootsExists(Object.keys(initialData))) {
      throw new Error('datacontroller-init-non-existent-root');
    }
    this.model.enqueueChange({ isUndoable: false }, writer => {
      for (const rootName of Object.keys(initialData)) {
        const modelRoot = this.model.document.getRoot(rootName)!;
        writer.insert(this.parse(initialData[rootName], modelRoot), modelRoot, 0);
      }
    });
    return Promise.resolve();
  }

  public override set(data: string | Record<string, string>, options: { batchType?: BatchType } = {}): void {
    let newData: Record<string, string> = {};
    if (typeof data === 'string') {
      newData.main = data;
    } else {
      newData = data;
    }
    if (!this._checkIfRootsExists(Object.keys(newData))) {
      throw new Error('datacontroller-set-non-existent-root');
    }
    this.model.enqueueChange(options.batchType || {}, writer => {
      writer.setSelection(null);
      writer.removeSelectionAttribute(this.model.document.selection.getAttributeKeys());
      for (const rootName of Object.keys(newData)) {
        const modelRoot = this.model.document.getRoot(rootName)!;
        writer.remove(writer.createRangeIn(modelRoot));
        writer.insert(this.parse(newData[rootName], modelRoot), modelRoot, 0);
      }
    });
  }

  public parse(data: string, context: SchemaContextDefinition = '$root'): ModelDocumentFragment {
    const viewDocumentFragment = this.processor.toView(data);
    return this.toModel(viewDocumentFragment, context);
  }

  public toModel(viewElementOrFragment: ViewElement | ViewDocumentFragment, context: SchemaContextDefinition = '$root'): ModelDocumentFragment {
    return this.model.change(writer => {
      return this.upcastDispatcher.convert(viewElementOrFragment, writer, context);
    });
  }

  public addStyleProcessorRules(_callback: unknown): void {
    /* styles normalisation is simplified in this engine */
  }

  public registerRawContentMatcher(pattern: (el: ViewElement) => boolean): void {
    if (this.processor && this.processor !== this.htmlProcessor) {
      this.processor.registerRawContentMatcher(pattern);
    }
    this.htmlProcessor.registerRawContentMatcher(pattern);
  }

  public destroy(): void {
    this.stopListening();
  }

  private _checkIfRootsExists(rootNames: string[]): boolean {
    for (const rootName of rootNames) {
      if (!this.model.document.getRootNames(true).includes(rootName)) {
        return false;
      }
    }
    return true;
  }
}
