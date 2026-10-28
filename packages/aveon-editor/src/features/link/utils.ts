import type { Position } from '../../engine/model/position';
import type { Model } from '../../engine/model/model';
import { Range } from '../../engine/model/range';
import type { Element as ViewElement } from '../../engine/view/element';
import type { AttributeElement } from '../../engine/view/attributeelement';
import type { DowncastWriter } from '../../engine/view/downcastwriter';

const ATTRIBUTE_WHITESPACES = new RegExp('[' + String.fromCharCode(0) + '-' + String.fromCharCode(32) + String.fromCharCode(160, 5760, 6158) + String.fromCharCode(8192) + '-' + String.fromCharCode(8233) + String.fromCharCode(8287, 12288) + ']', 'g');
const SAFE_URL_TEMPLATE = '^(?:(?:<protocols>):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))';
const PROTOCOL_REG_EXP = /^((\w+:(\/{2,})?)|(\W))/i;
const DEFAULT_LINK_PROTOCOLS = ['https?', 'ftps?', 'mailto'];

export const LINK_KEYSTROKE = 'Ctrl+K';

export function isLinkElement(node: any): boolean {
  return !!node && node.is && node.is('attributeElement') && !!node.getCustomProperty('link');
}

export function createLinkElement(href: string, { writer }: { writer: DowncastWriter }): AttributeElement {
  const linkElement = writer.createAttributeElement('a', { href }, { priority: 5 });
  writer.setCustomProperty('link', true, linkElement);
  return linkElement;
}

export function ensureSafeUrl(url: unknown, allowedProtocols: string[] = DEFAULT_LINK_PROTOCOLS): string {
  const urlString = String(url);
  const protocolsList = allowedProtocols.join('|');
  const customSafeRegex = new RegExp(`${SAFE_URL_TEMPLATE.replace('<protocols>', protocolsList)}`, 'i');
  return isSafeUrl(urlString, customSafeRegex) ? urlString : '#';
}

function isSafeUrl(url: string, customRegexp: RegExp): boolean {
  const normalizedUrl = url.replace(ATTRIBUTE_WHITESPACES, '');
  return !!normalizedUrl.match(customRegexp);
}

export function isEmail(value: string): boolean {
  return /^[\S]+@((?![-_])(?:[-\w¡-￿]{0,63}[^-_]\.))+(?:[a-z¡-￿]{2,})$/i.test(value);
}

export function addLinkProtocolIfApplicable(link: string, defaultProtocol?: string): string {
  const protocol = isEmail(link) ? 'mailto:' : defaultProtocol;
  const isProtocolNeeded = !!protocol && !linkHasProtocol(link);
  return link && isProtocolNeeded ? protocol + link : link;
}

export function linkHasProtocol(link: string): boolean {
  return PROTOCOL_REG_EXP.test(link);
}

export function openLink(link: string): void {
  window.open(link, '_blank', 'noopener');
}

/** Returns the range of the attribute with the given value around the position. */
export function findAttributeRange(position: Position, attributeName: string, value: unknown, model: Model): Range {
  return model.createRange(findAttributeRangeBound(position, attributeName, value, true, model), findAttributeRangeBound(position, attributeName, value, false, model));
}

export function findAttributeRangeBound(position: Position, attributeName: string, value: unknown, lookBack: boolean, model: Model): Position {
  let node: any = position.textNode || (lookBack ? position.nodeBefore : position.nodeAfter);
  let lastNode: any = null;
  while (node && node.getAttribute(attributeName) === value) {
    lastNode = node;
    node = lookBack ? node.previousSibling : node.nextSibling;
  }
  return lastNode ? model.createPositionAt(lastNode, lookBack ? 'before' : 'after') : position;
}

export type { ViewElement };
