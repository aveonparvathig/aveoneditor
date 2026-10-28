import { describe, it, expect } from 'vitest';
import { Model } from './model/model';
import { DataController } from './controller/datacontroller';
import { EditingController } from './controller/editingcontroller';
import { Conversion } from './conversion/conversion';
import type { Element } from './model/element';
import type { RootElement } from './model/rootelement';

function createEngine() {
  const model = new Model();
  model.document.createRoot();
  model.schema.register('paragraph', { inheritAllFrom: '$block' });
  model.schema.register('heading1', { inheritAllFrom: '$block' });
  model.schema.register('softBreak', { allowWhere: '$text', isInline: true });
  model.schema.extend('$text', { allowAttributes: ['bold', 'italic'] });
  const data = new DataController(model);
  const editing = new EditingController(model);
  const conversion = new Conversion([editing.downcastDispatcher, data.downcastDispatcher], data.upcastDispatcher);
  conversion.addAlias('editingDowncast', editing.downcastDispatcher);
  conversion.addAlias('dataDowncast', data.downcastDispatcher);
  conversion.elementToElement({ model: 'paragraph', view: 'p' });
  conversion.elementToElement({ model: 'heading1', view: 'h1' });
  conversion.elementToElement({ model: 'softBreak', view: 'br' });
  conversion.attributeToElement({ model: 'bold', view: 'strong', upcastAlso: ['b'] });
  conversion.attributeToElement({ model: 'italic', view: 'em', upcastAlso: ['i'] });
  return { model, data, editing, conversion };
}

describe('engine', () => {
  it('round-trips HTML through the data pipeline', () => {
    const { data } = createEngine();
    data.init('<p>Hello <b>world</b></p><p>Second <i>one</i></p>');
    expect(data.get()).toBe('<p>Hello <strong>world</strong></p><p>Second <em>one</em></p>');
  });

  it('renders the editing view and updates it on model changes', () => {
    const { model, data, editing } = createEngine();
    data.init('<p>Hello <b>world</b></p><p>Second</p>');
    const domRoot = document.createElement('div');
    document.body.appendChild(domRoot);
    editing.view.attachDomRoot(domRoot);
    editing.view.forceRender();
    expect(domRoot.innerHTML).toBe('<p>Hello <strong>world</strong></p><p>Second</p>');

    const root = model.document.getRoot()!;
    model.change(writer => {
      writer.insertText('X', root.getChild(0) as Element, 0);
    });
    expect(domRoot.innerHTML).toBe('<p>XHello <strong>world</strong></p><p>Second</p>');

    model.change(writer => {
      writer.setAttribute('bold', true, writer.createRangeIn(root.getChild(1) as Element));
    });
    expect(domRoot.innerHTML).toBe('<p>XHello <strong>world</strong></p><p><strong>Second</strong></p>');

    model.change(writer => {
      writer.split(writer.createPositionAt(root.getChild(0) as Element, 3));
    });
    expect(domRoot.innerHTML).toBe('<p>XHe</p><p>llo <strong>world</strong></p><p><strong>Second</strong></p>');

    model.change(writer => {
      writer.merge(writer.createPositionAfter(root.getChild(0) as Element));
    });
    expect(domRoot.innerHTML).toBe('<p>XHello <strong>world</strong></p><p><strong>Second</strong></p>');

    model.change(writer => {
      writer.rename(root.getChild(0) as Element, 'heading1');
    });
    expect(domRoot.innerHTML).toBe('<h1>XHello <strong>world</strong></h1><p><strong>Second</strong></p>');

    model.change(writer => {
      writer.remove(root.getChild(1) as Element);
    });
    expect(domRoot.innerHTML).toBe('<h1>XHello <strong>world</strong></h1>');
    expect(data.get()).toBe('<h1>XHello <strong>world</strong></h1>');
  });

  it('supports deleteContent and insertContent', () => {
    const { model, data } = createEngine();
    data.init('<p>Hello world</p><p>Second</p>');
    const root = model.document.getRoot() as RootElement;
    model.change(writer => {
      const start = writer.createPositionAt(root.getChild(0) as Element, 5);
      const end = writer.createPositionAt(root.getChild(1) as Element, 3);
      writer.setSelection(writer.createRange(start, end));
    });
    model.deleteContent(model.document.selection);
    expect(data.get()).toBe('<p>Helloond</p>');

    model.change(writer => {
      const frag = data.parse('<p>A <b>B</b></p><p>C</p>');
      model.insertContent(frag);
    });
    expect(data.get()).toBe('<p>HelloA <strong>B</strong></p><p>Cond</p>');
  });

  it('reverses batches for undo', () => {
    const { model, data } = createEngine();
    data.init('<p>Hello</p>');
    const root = model.document.getRoot() as RootElement;
    let batch: any;
    model.change(writer => {
      batch = writer.batch;
      writer.insertText(' world', root.getChild(0) as Element, 5);
      writer.split(writer.createPositionAt(root.getChild(0) as Element, 5));
    });
    expect(data.get()).toBe('<p>Hello</p><p>&nbsp;world</p>');
    model.enqueueChange({ isUndo: true }, writer => {
      for (const op of [...batch.operations].reverse()) {
        const reversed = op.getReversed();
        reversed.baseVersion = model.document.version;
        writer.batch.addOperation(reversed);
        model.applyOperation(reversed);
      }
    });
    expect(data.get()).toBe('<p>Hello</p>');
  });

  it('autoparagraphs empty roots and keeps the selection valid', () => {
    const { model, data } = createEngine();
    data.init('');
    expect(data.get()).toBe('');
    const root = model.document.getRoot() as RootElement;
    expect(root.childCount).toBe(1);
    expect((root.getChild(0) as Element).name).toBe('paragraph');
    expect(model.document.selection.getFirstPosition()!.path).toEqual([0, 0]);
  });

  it('maps DOM selection changes to the model', () => {
    const { model, data, editing } = createEngine();
    data.init('<p>Hello</p>');
    const domRoot = document.createElement('div');
    document.body.appendChild(domRoot);
    editing.view.attachDomRoot(domRoot);
    editing.view.forceRender();
    const textNode = domRoot.firstChild!.firstChild as Text;
    const viewPos = editing.view.domConverter.domPositionToView(textNode, 3)!;
    const modelPos = editing.mapper.toModelPosition(viewPos);
    expect(modelPos.path).toEqual([0, 3]);
    const domPos = editing.view.domConverter.viewPositionToDom(editing.mapper.toViewPosition(model.createPositionFromPath(model.document.getRoot()!, [0, 2])))!;
    expect(domPos.parent).toBe(textNode);
    expect(domPos.offset).toBe(2);
  });
});
