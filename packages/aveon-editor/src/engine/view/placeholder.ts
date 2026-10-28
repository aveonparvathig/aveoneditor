import type { View } from './view';
import type { Document } from './document';
import type { Element } from './element';
import type { DowncastWriter } from './downcastwriter';

interface PlaceholderConfig {
  text: string;
  isDirectHost: boolean;
  keepOnFocus: boolean;
  hostElement: Element | null;
}

const documentPlaceholders = new WeakMap<Document, Map<Element, PlaceholderConfig>>();

/** Shows a placeholder text in an empty editable (or its only empty child block). */
export function enablePlaceholder({ view, element, text, isDirectHost = true, keepOnFocus = false }: { view: View; element: Element; text: string; isDirectHost?: boolean; keepOnFocus?: boolean }): void {
  const doc = view.document;
  if (!documentPlaceholders.has(doc)) {
    documentPlaceholders.set(doc, new Map());
    doc.registerPostFixer(writer => updateDocumentPlaceholders(doc, writer));
  }
  documentPlaceholders.get(doc)!.set(element, { text, isDirectHost, keepOnFocus, hostElement: isDirectHost ? element : null });
  view.change(writer => updateDocumentPlaceholders(doc, writer));
}

export function disablePlaceholder(view: View, element: Element): void {
  const doc = element.document;
  view.change(writer => {
    if (!documentPlaceholders.has(doc)) return;
    const placeholders = documentPlaceholders.get(doc)!;
    const config = placeholders.get(element);
    if (config && config.hostElement) {
      writer.removeAttribute('data-placeholder', config.hostElement);
      hidePlaceholder(writer, config.hostElement);
    }
    placeholders.delete(element);
  });
}

export function showPlaceholder(writer: DowncastWriter, element: Element): boolean {
  if (!element.hasClass('ck-placeholder')) {
    writer.addClass('ck-placeholder', element);
    return true;
  }
  return false;
}

export function hidePlaceholder(writer: DowncastWriter, element: Element): boolean {
  if (element.hasClass('ck-placeholder')) {
    writer.removeClass('ck-placeholder', element);
    return true;
  }
  return false;
}

export function needsPlaceholder(element: Element, keepOnFocus: boolean): boolean {
  if (!element.isAttached()) return false;
  const hasContent = Array.from(element.getChildren()).some(el => !(el as any).is('uiElement'));
  if (hasContent) return false;
  if (keepOnFocus) return true;
  const doc = element.document;
  if (!doc.isFocused) return true;
  const viewSelection = doc.selection;
  const selectionAnchor = viewSelection.anchor;
  return !!selectionAnchor && selectionAnchor.parent !== element;
}

function updateDocumentPlaceholders(doc: Document, writer: DowncastWriter): boolean {
  const placeholders = documentPlaceholders.get(doc)!;
  const directHostElements: Element[] = [];
  let wasViewModified = false;
  for (const [element, config] of placeholders) {
    if (config.isDirectHost) {
      directHostElements.push(element);
      if (updatePlaceholder(writer, element, config)) wasViewModified = true;
    }
  }
  for (const [element, config] of placeholders) {
    if (config.isDirectHost) continue;
    if (directHostElements.includes(element)) continue;
    if (updatePlaceholder(writer, element, config)) wasViewModified = true;
  }
  return wasViewModified;
}

function updatePlaceholder(writer: DowncastWriter, element: Element, config: PlaceholderConfig): boolean {
  const { text, isDirectHost } = config;
  const hostElement = isDirectHost ? element : getChildPlaceholderHostSubstitute(element);
  let wasViewModified = false;
  if (config.hostElement && config.hostElement !== hostElement) {
    if (config.hostElement.hasAttribute('data-placeholder')) {
      writer.removeAttribute('data-placeholder', config.hostElement);
    }
    hidePlaceholder(writer, config.hostElement);
    wasViewModified = true;
  }
  config.hostElement = hostElement;
  if (!hostElement) return wasViewModified;
  if (hostElement.getAttribute('data-placeholder') !== text) {
    writer.setAttribute('data-placeholder', text, hostElement);
    wasViewModified = true;
  }
  if (needsPlaceholder(hostElement, config.keepOnFocus)) {
    if (showPlaceholder(writer, hostElement)) wasViewModified = true;
  } else if (hidePlaceholder(writer, hostElement)) {
    wasViewModified = true;
  }
  return wasViewModified;
}

function getChildPlaceholderHostSubstitute(parent: Element): Element | null {
  if (parent.childCount) {
    const firstChild = parent.getChild(0) as Element;
    if ((firstChild as any).is('element') && !(firstChild as any).is('uiElement') && !(firstChild as any).is('attributeElement') && parent.childCount === 1) {
      return firstChild;
    }
  }
  return null;
}
