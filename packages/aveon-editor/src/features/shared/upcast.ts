/**
 * Upcast helpers for "atomic" content: a view element that becomes one model element while its
 * children (generated output such as a contents list) are ignored.
 */

import type { EventInfo } from '../../utils/eventinfo';
import type { Element as ViewElement } from '../../engine/view/element';
import type { Element as ModelElement } from '../../engine/model/element';

export function collectViewText(element: ViewElement): string {
  let text = '';
  for (const child of element.getChildren()) {
    const node = child as any;
    if (node.is('$text')) text += node.data;
    else if (node.is('element')) text += collectViewText(node);
  }
  return text;
}

function consumeDescendants(element: ViewElement, conversionApi: any): void {
  for (const child of element.getChildren()) {
    const node = child as any;
    if (node.is('element')) {
      conversionApi.consumable.consume(node, { name: true });
      consumeDescendants(node, conversionApi);
    } else if (node.is('$text')) {
      conversionApi.consumable.consume(node);
    }
  }
}

/**
 * Returns an upcast listener that turns elements accepted by `match` into the model element built by
 * `create`, ignoring their children. Register it with high priority.
 */
export function upcastAtomic(match: (viewElement: ViewElement) => boolean, create: (viewElement: ViewElement, writer: any) => ModelElement | null) {
  return (evt: EventInfo, data: any, conversionApi: any): void => {
    const viewItem = data.viewItem as ViewElement;
    if (!match(viewItem) || !conversionApi.consumable.test(viewItem, { name: true })) return;
    const element = create(viewItem, conversionApi.writer);
    if (!element || !conversionApi.safeInsert(element, data.modelCursor)) return;
    conversionApi.consumable.consume(viewItem, { name: true });
    consumeDescendants(viewItem, conversionApi);
    conversionApi.updateConversionResult(element, data);
    evt.stop();
  };
}

/**
 * Like `upcastAtomic()`, but children accepted by `keepChild` (e.g. a `<figcaption>`) are converted
 * into the model element; every other child is ignored.
 */
export function upcastFigure(match: (viewElement: ViewElement) => boolean, create: (viewElement: ViewElement, writer: any) => ModelElement | null, keepChild: (child: ViewElement) => boolean) {
  return (evt: EventInfo, data: any, conversionApi: any): void => {
    const viewItem = data.viewItem as ViewElement;
    if (!match(viewItem) || !conversionApi.consumable.test(viewItem, { name: true })) return;
    const element = create(viewItem, conversionApi.writer);
    if (!element || !conversionApi.safeInsert(element, data.modelCursor)) return;
    conversionApi.consumable.consume(viewItem, { name: true });
    for (const child of viewItem.getChildren()) {
      const node = child as any;
      if (node.is('element') && keepChild(node)) {
        conversionApi.convertItem(node, conversionApi.writer.createPositionAt(element, 'end'));
      } else if (node.is('element')) {
        conversionApi.consumable.consume(node, { name: true });
        consumeDescendants(node, conversionApi);
      } else if (node.is('$text')) {
        conversionApi.consumable.consume(node);
      }
    }
    conversionApi.updateConversionResult(element, data);
    evt.stop();
  };
}

/** Escapes text for use in HTML. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

/** Downloads text as a file (no-op outside a browser). */
export function downloadFile(contents: string, fileName: string, mimeType: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return;
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
