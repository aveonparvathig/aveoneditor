import type { Element } from './element';

export type PropertyPattern = true | string | RegExp;
export type AttributePatterns = Record<string, PropertyPattern> | string[] | RegExp | true;
export type ClassPatterns = string | RegExp | Array<string | RegExp> | true;
export type StylePatterns = Record<string, PropertyPattern> | string[] | RegExp | true;

export interface MatcherObjectPattern {
  name?: string | RegExp;
  attributes?: AttributePatterns;
  classes?: ClassPatterns;
  styles?: StylePatterns;
  key?: string;
  value?: PropertyPattern;
}

export type MatcherFunctionPattern = (element: Element) => null | MatchResult | boolean;
export type MatcherPattern = string | RegExp | MatcherObjectPattern | MatcherFunctionPattern;

export interface MatchResult {
  name?: boolean;
  attributes?: string[];
  classes?: string[];
  styles?: string[];
}

export interface Match {
  element: Element;
  pattern: MatcherPattern;
  match: MatchResult;
}

/** Matches view elements against patterns (name, attributes, classes, styles). */
export class Matcher {
  private _patterns: Array<Exclude<MatcherPattern, string | RegExp>> = [];

  constructor(...patterns: MatcherPattern[]) {
    this.add(...patterns);
  }

  public add(...patterns: MatcherPattern[]): void {
    for (let item of patterns) {
      if (typeof item === 'string' || item instanceof RegExp) {
        item = { name: item };
      }
      this._patterns.push(item as any);
    }
  }

  public match(...singleOrManyElements: Element[]): Match | null {
    for (const element of singleOrManyElements) {
      for (const pattern of this._patterns) {
        const match = isElementMatching(element, pattern);
        if (match) {
          return { element, pattern, match };
        }
      }
    }
    return null;
  }

  public matchAll(...singleOrManyElements: Element[]): Match[] | null {
    const results: Match[] = [];
    for (const element of singleOrManyElements) {
      for (const pattern of this._patterns) {
        const match = isElementMatching(element, pattern);
        if (match) results.push({ element, pattern, match });
      }
    }
    return results.length > 0 ? results : null;
  }

  public getElementName(): string | null {
    if (this._patterns.length !== 1) return null;
    const pattern = this._patterns[0];
    const name = (pattern as MatcherObjectPattern).name;
    return typeof pattern !== 'function' && name && !(name instanceof RegExp) ? name : null;
  }
}

function isElementMatching(element: Element, pattern: Exclude<MatcherPattern, string | RegExp>): MatchResult | null {
  if (typeof pattern === 'function') {
    const result = pattern(element);
    if (result === true) return {};
    if (!result) return null;
    return result as MatchResult;
  }
  const match: MatchResult = {};
  if (pattern.name) {
    match.name = matchName(pattern.name, element.name);
    if (!match.name) return null;
  }
  if (pattern.attributes) {
    match.attributes = matchAttributes(pattern.attributes, element);
    if (!match.attributes) return null;
  }
  if (pattern.classes) {
    match.classes = matchClasses(pattern.classes, element);
    if (!match.classes) return null;
  }
  if (pattern.styles) {
    match.styles = matchStyles(pattern.styles, element);
    if (!match.styles) return null;
  }
  return match;
}

function matchName(pattern: string | RegExp, name: string): boolean {
  if (pattern instanceof RegExp) return !!name.match(pattern);
  return pattern === name;
}

function matchPatterns(patterns: Record<string, PropertyPattern> | string[] | RegExp | true, keys: Iterable<string>, valueGetter: (key: string) => string | undefined): string[] | undefined {
  const normalizedPatterns = normalizePatterns(patterns);
  const normalizedItems = Array.from(keys);
  const match: string[] = [];
  normalizedPatterns.forEach(([patternKey, patternValue]) => {
    normalizedItems.forEach(itemKey => {
      if (isKeyMatched(patternKey, itemKey) && isValueMatched(patternValue, valueGetter(itemKey))) {
        match.push(itemKey);
      }
    });
  });
  if (!normalizedPatterns.length || match.length < normalizedPatterns.length) {
    return undefined;
  }
  return match;
}

function normalizePatterns(patterns: Record<string, PropertyPattern> | string[] | RegExp | true): Array<[string | RegExp | true, PropertyPattern]> {
  if (Array.isArray(patterns)) {
    return patterns.map(pattern => {
      if (typeof pattern === 'object' && pattern !== null && 'key' in (pattern as any)) {
        return [(pattern as any).key, (pattern as any).value === undefined ? true : (pattern as any).value];
      }
      return [pattern as string, true];
    });
  }
  if (patterns instanceof RegExp) {
    return [[patterns, true]];
  }
  if (patterns === true) {
    return [[true, true]];
  }
  return Object.entries(patterns);
}

function isKeyMatched(patternKey: string | RegExp | true, itemKey: string): boolean {
  return patternKey === true || patternKey === itemKey || (patternKey instanceof RegExp && !!itemKey.match(patternKey));
}

function isValueMatched(patternValue: PropertyPattern, itemValue: string | undefined): boolean {
  if (patternValue === true) return true;
  const value = itemValue || '';
  return patternValue === value || (patternValue instanceof RegExp && !!value.match(patternValue));
}

function matchAttributes(patterns: AttributePatterns, element: Element): string[] | undefined {
  const attributeKeys = new Set(element.getAttributeKeys());
  if (typeof patterns === 'object' && !Array.isArray(patterns) && !(patterns instanceof RegExp)) {
    const p = patterns as Record<string, PropertyPattern>;
    if (p.style !== undefined) {
      attributeKeys.delete('style');
    }
    if (p.class !== undefined) {
      attributeKeys.delete('class');
    }
  } else {
    attributeKeys.delete('style');
    attributeKeys.delete('class');
  }
  return matchPatterns(patterns, attributeKeys, key => element.getAttribute(key));
}

function matchClasses(patterns: ClassPatterns, element: Element): string[] | undefined {
  const normalized = patterns === true ? true : Array.isArray(patterns) ? patterns.map(p => p) : [patterns];
  const result = matchPatterns(normalized === true ? true : (normalized as any), element.getClassNames(), () => undefined as any);
  return result;
}

function matchStyles(patterns: StylePatterns, element: Element): string[] | undefined {
  return matchPatterns(patterns, element.getStyleNames(), key => element.getStyle(key));
}
