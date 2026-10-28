import { ContainerElement } from '../../engine/view/containerelement';
import type { Element as ViewElement } from '../../engine/view/element';
import type { DocumentFragment as ViewDocumentFragment } from '../../engine/view/documentfragment';
import type { Node as ViewNode } from '../../engine/view/node';
import type { Mapper } from '../../engine/conversion/mapper';
import type { Element as ModelElement } from '../../engine/model/element';

interface ListNode {
  type: string;
  items: Array<{ li: ViewElement; children: ListNode[] }>;
}

interface Unit {
  node: ViewNode;
  isLi: boolean;
  order: number;
}

export function isListWrapper(node: any): boolean {
  return !!node && node.is && node.is('element') && (node.name === 'ul' || node.name === 'ol') && !node.getCustomProperty('listNotManaged');
}

export function isListItemView(node: any): boolean {
  return !!node && node.is && node.is('element', 'li');
}

/**
 * Rebuilds `<ul>`/`<ol>` wrappers around `<li>` elements inside the container so that
 * the view structure reflects the flat model list items (`listType`, `listIndent`).
 * Returns `true` when the view was modified.
 */
export function fixListStructureIn(container: ViewElement | ViewDocumentFragment, mapper: Mapper, deep = true): boolean {
  let changed = false;
  const children = Array.from(container.getChildren());
  const hasListContent = children.some(child => isListWrapper(child) || isListItemView(child));

  if (hasListContent) {
    const units = collectUnits(children, mapper);
    const planned = plan(units, mapper);
    if (signatureOfPlan(planned) !== signatureOfActual(children, mapper)) {
      apply(container, planned);
      changed = true;
    }
  }

  if (deep) {
    for (const child of Array.from(container.getChildren())) {
      if ((child as any).is('element') && !(child as any).is('attributeElement') && !(child as any).is('uiElement')) {
        if (!isListWrapper(child) && !isListItemView(child)) {
          if (fixListStructureIn(child as ViewElement, mapper, true)) changed = true;
        }
        if (isListWrapper(child)) {
          for (const li of (child as ViewElement).getChildren()) {
            if ((li as any).is('element')) {
              for (const liChild of Array.from((li as ViewElement).getChildren())) {
                if ((liChild as any).is('element') && !isListWrapper(liChild) && !(liChild as any).is('attributeElement')) {
                  if (fixListStructureIn(liChild as ViewElement, mapper, true)) changed = true;
                }
              }
            }
          }
        }
      }
    }
  }
  return changed;
}

function collectUnits(children: ViewNode[], mapper: Mapper): Unit[] {
  const units: Unit[] = [];
  const pushLi = (li: ViewElement) => {
    units.push({ node: li, isLi: true, order: 0 });
    for (const child of Array.from(li.getChildren())) {
      if (isListWrapper(child)) collectWrapper(child as ViewElement);
    }
  };
  const collectWrapper = (wrapper: ViewElement) => {
    for (const child of Array.from(wrapper.getChildren())) {
      if (isListItemView(child)) {
        pushLi(child as ViewElement);
      } else if (isListWrapper(child)) {
        collectWrapper(child as ViewElement);
      } else {
        units.push({ node: child, isLi: false, order: 0 });
      }
    }
  };
  for (const child of children) {
    if (isListWrapper(child)) {
      collectWrapper(child as ViewElement);
    } else if (isListItemView(child)) {
      pushLi(child as ViewElement);
    } else {
      units.push({ node: child, isLi: false, order: 0 });
    }
  }
  // Order by model position; unmapped nodes keep their relative position.
  let lastOrder = -1;
  for (const unit of units) {
    const modelElement = (unit.node as any).is('element') ? (mapper.toModelElement(unit.node as ViewElement) as ModelElement | undefined) : undefined;
    if (modelElement && modelElement.parent) {
      unit.order = modelElement.index!;
      lastOrder = unit.order;
    } else {
      unit.order = lastOrder + 0.5;
    }
  }
  return units.sort((a, b) => a.order - b.order);
}

function plan(units: Unit[], mapper: Mapper): Array<ViewNode | ListNode> {
  const result: Array<ViewNode | ListNode> = [];
  let i = 0;
  while (i < units.length) {
    if (!units[i].isLi) {
      result.push(units[i].node);
      i++;
      continue;
    }
    const run: ViewElement[] = [];
    while (i < units.length && units[i].isLi) {
      run.push(units[i].node as ViewElement);
      i++;
    }
    result.push(...buildLists(run, mapper));
  }
  return result;
}

function buildLists(run: ViewElement[], mapper: Mapper): ListNode[] {
  const roots: ListNode[] = [];
  const stack: Array<{ list: ListNode; indent: number; type: string }> = [];
  for (const li of run) {
    const modelItem = mapper.toModelElement(li) as ModelElement | undefined;
    const indent = modelItem ? Number(modelItem.getAttribute('listIndent') || 0) : 0;
    const type = modelItem ? String(modelItem.getAttribute('listType') || 'bulleted') : 'bulleted';
    while (stack.length && stack[stack.length - 1].indent > indent) stack.pop();
    if (stack.length && stack[stack.length - 1].indent === indent && stack[stack.length - 1].type !== type) {
      stack.pop();
      // Lists of different type at the same level become siblings (only at the top level) or nested anew.
    }
    if (!stack.length || stack[stack.length - 1].indent < indent) {
      const list: ListNode = { type, items: [] };
      if (!stack.length) {
        roots.push(list);
      } else {
        const parentList = stack[stack.length - 1].list;
        const lastItem = parentList.items[parentList.items.length - 1];
        if (lastItem) {
          lastItem.children.push(list);
        } else {
          roots.push(list);
        }
      }
      stack.push({ list, indent, type });
    } else if (stack[stack.length - 1].type !== type) {
      const list: ListNode = { type, items: [] };
      roots.push(list);
      stack.length = 0;
      stack.push({ list, indent, type });
    }
    stack[stack.length - 1].list.items.push({ li, children: [] });
  }
  return roots;
}

function signatureOfPlan(planned: Array<ViewNode | ListNode>): string {
  return planned.map(entry => (isListNode(entry) ? listNodeSignature(entry) : `n${(entry as any).viewUid || id(entry as ViewNode)}`)).join('|');
}

function listNodeSignature(node: ListNode): string {
  return `${node.type}[${node.items.map(item => `${id(item.li)}(${item.children.map(listNodeSignature).join(',')})`).join(',')}]`;
}

function signatureOfActual(children: ViewNode[], mapper: Mapper): string {
  void mapper;
  return children.map(child => (isListWrapper(child) ? actualListSignature(child as ViewElement) : `n${id(child)}`)).join('|');
}

function actualListSignature(wrapper: ViewElement): string {
  const type = wrapper.name === 'ol' ? 'numbered' : wrapper.hasClass('todo-list') ? 'todo' : 'bulleted';
  const items: string[] = [];
  for (const child of wrapper.getChildren()) {
    if (!isListItemView(child)) return 'invalid';
    const nested: string[] = [];
    for (const liChild of (child as ViewElement).getChildren()) {
      if (isListWrapper(liChild)) nested.push(actualListSignature(liChild as ViewElement));
    }
    items.push(`${id(child)}(${nested.join(',')})`);
  }
  return `${type}[${items.join(',')}]`;
}

const ids = new WeakMap<object, number>();
let idCounter = 0;
function id(node: object): number {
  let value = ids.get(node);
  if (value === undefined) {
    value = ++idCounter;
    ids.set(node, value);
  }
  return value;
}

function isListNode(entry: unknown): entry is ListNode {
  return !!entry && typeof (entry as any).items !== 'undefined' && typeof (entry as any).type === 'string';
}

function apply(container: ViewElement | ViewDocumentFragment, planned: Array<ViewNode | ListNode>): void {
  const document = container.document;
  // Detach existing list structure (keep li content, drop nested wrappers).
  const detachNestedWrappers = (li: ViewElement) => {
    for (const child of Array.from(li.getChildren())) {
      if (isListWrapper(child)) {
        for (const nestedLi of Array.from((child as ViewElement).getChildren())) {
          if (isListItemView(nestedLi)) detachNestedWrappers(nestedLi as ViewElement);
        }
        (child as ViewElement)._remove();
      }
    }
  };
  for (const child of Array.from(container.getChildren())) {
    if (isListWrapper(child)) {
      for (const li of Array.from((child as ViewElement).getChildren())) {
        if (isListItemView(li)) detachNestedWrappers(li as ViewElement);
      }
    } else if (isListItemView(child)) {
      detachNestedWrappers(child as ViewElement);
    }
  }
  const build = (node: ListNode): ViewElement => {
    const wrapper = new ContainerElement(document, node.type === 'numbered' ? 'ol' : 'ul');
    if (node.type === 'todo') wrapper._addClass('todo-list');
    for (const item of node.items) {
      item.li._remove();
      wrapper._appendChild(item.li);
      for (const child of item.children) {
        item.li._appendChild(build(child));
      }
    }
    return wrapper;
  };
  const newChildren: ViewNode[] = planned.map(entry => (isListNode(entry) ? build(entry) : (entry as ViewNode)));
  for (const child of Array.from(container.getChildren())) {
    if (!newChildren.includes(child)) {
      child._remove();
    }
  }
  // Re-insert in the planned order.
  for (const child of newChildren) {
    if (child.parent) child._remove();
  }
  container._insertChild(0, newChildren);
}
