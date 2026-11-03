/**
 * Cleans document HTML before it is stored: only the tags, attributes and styles the editor itself
 * produces survive, so a crafted request cannot store scripts or event handlers.
 */

import sanitizeHtml from 'sanitize-html';

const SAFE_STYLE = {
  color: [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^hsla?\([\d\s.,%deg]+\)$/i, /^[a-z]+$/i],
  'background-color': [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^hsla?\([\d\s.,%deg]+\)$/i, /^[a-z]+$/i],
  'font-family': [/^[\w\s,'"-]+$/],
  'font-size': [/^\d+(\.\d+)?(px|pt|em|rem|%)$/],
  'text-align': [/^(left|right|center|justify)$/],
  'margin-left': [/^\d+(\.\d+)?(px|em|rem)$/],
  width: [/^\d+(\.\d+)?(px|%|em|rem)$/],
  height: [/^\d+(\.\d+)?(px|%|em|rem)$/],
  'aspect-ratio': [/^[\d.\s/]+$/],
  float: [/^(left|right|none)$/],
  'border-color': [/^#[0-9a-f]{3,8}$/i, /^[a-z]+$/i],
  'vertical-align': [/^(top|middle|bottom|baseline)$/]
};

const OPTIONS = {
  allowedTags: [
    'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code', 'hr', 'br', 'div', 'span', 'section', 'nav',
    'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins', 'sub', 'sup', 'mark', 'small',
    'ul', 'ol', 'li', 'label', 'input',
    'a', 'img', 'figure', 'figcaption', 'picture', 'source', 'oembed',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
    // Sketches are stored as SVG made of stroked paths.
    'svg', 'path', 'g'
  ],
  allowedAttributes: {
    '*': ['class', 'id', 'style', 'dir', 'lang', 'title', 'data-*'],
    a: ['href', 'target', 'rel', 'name'],
    img: ['src', 'srcset', 'sizes', 'alt', 'width', 'height', 'loading'],
    source: ['srcset', 'sizes', 'type', 'media'],
    oembed: ['url'],
    input: ['type', 'checked', 'disabled'],
    ol: ['start', 'reversed', 'type'],
    li: ['value'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan', 'scope'],
    col: ['span'],
    svg: ['viewbox', 'viewBox', 'width', 'height', 'xmlns', 'fill', 'stroke'],
    path: ['d', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin'],
    g: ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin']
  },
  allowedStyles: { '*': SAFE_STYLE },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
  allowProtocolRelative: false,
  // Only checkboxes (to-do lists) of all inputs.
  exclusiveFilter: frame => frame.tag === 'input' && frame.attribs.type !== 'checkbox',
  transformTags: {
    a: (tagName, attribs) => (attribs.target === '_blank' ? { tagName, attribs: { ...attribs, rel: 'noopener noreferrer' } } : { tagName, attribs })
  },
  parser: { lowerCaseAttributeNames: false }
};

/** Document HTML with everything the editor does not produce removed. */
export function sanitizeDocument(html) {
  // Pasted images are data: URLs only while they upload; anything else is refused.
  return sanitizeHtml(String(html ?? ''), OPTIONS).replace(/src="data:(?!image\/(png|jpeg|gif|webp|avif);base64,)[^"]*"/gi, 'src=""');
}
