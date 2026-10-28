import { describe, it, expect } from 'vitest';
import { parseLatex, toLatex } from './latex';
import { toMathML, parseMathML, domToMathMLLike, getTexAnnotation } from './mathml';
import { toSpeech } from './speech';
import { createFrac, createRow, createToken, toJSON, fromJSON, getRowPath, resolveRowPath, type FracNode } from './nodes';

function roundTrip(latex: string): string {
  return toLatex(parseLatex(latex));
}

function mathmlOf(latex: string): string {
  return toMathML(parseLatex(latex));
}

function parseMathMLString(mathml: string) {
  const doc = new DOMParser().parseFromString(mathml, 'text/html');
  return domToMathMLLike(doc.body.firstElementChild!);
}

describe('math model: LaTeX', () => {
  it('round-trips core constructs', () => {
    expect(roundTrip('\\frac{a}{b}')).toBe('\\frac{a}{b}');
    expect(roundTrip('\\sqrt{x}')).toBe('\\sqrt{x}');
    expect(roundTrip('\\sqrt[3]{x}')).toBe('\\sqrt[3]{x}');
    expect(roundTrip('x^2')).toBe('x^{2}');
    expect(roundTrip('x_{i}^{2}')).toBe('x_{i}^{2}');
    expect(roundTrip('\\sum_{i=1}^{n} i')).toBe('\\sum_{i=1}^{n}i');
    expect(roundTrip('\\int_0^1 x\\,dx')).toBe('\\int_{0}^{1}x\\,dx');
    expect(roundTrip('\\left( a+b \\right)')).toBe('\\left(a+b\\right)');
    expect(roundTrip('\\hat{x} + \\vec{v}')).toBe('\\hat{x}+\\vec{v}');
    expect(roundTrip('\\alpha \\leq \\beta')).toBe('\\alpha\\leq\\beta');
    expect(roundTrip('\\sin x')).toBe('\\sin x');
    expect(roundTrip('\\text{if } x')).toBe('\\text{if }x');
    expect(roundTrip('\\mathbf{v} = \\mathrm{d}')).toBe('\\mathbf{v}=\\mathrm{d}');
    expect(roundTrip('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}')).toBe('\\begin{pmatrix}a & b \\\\ c & d\\end{pmatrix}');
    expect(roundTrip('\\begin{cases} x & x>0 \\\\ 0 & \\text{otherwise} \\end{cases}')).toBe('\\begin{cases}x & x>0 \\\\ 0 & \\text{otherwise}\\end{cases}');
    expect(roundTrip('\\lim_{x \\to 0} f(x)')).toBe('\\lim_{x\\rightarrow0}f(x)');
  });

  it('keeps unknown commands verbatim', () => {
    expect(roundTrip('\\xcancel{a} + b')).toBe('\\xcancel{a}+b');
    expect(roundTrip('\\unknowncmd')).toBe('\\unknowncmd');
  });

  it('builds the expected tree', () => {
    const row = parseLatex('\\frac{1}{2}');
    expect(row.children).toHaveLength(1);
    const frac = row.children[0] as FracNode;
    expect(frac.type).toBe('frac');
    expect(frac.num.owner).toBe(frac);
    expect(frac.num.children[0].parent).toBe(frac.num);
    expect(toJSON(row)).toEqual(toJSON(fromJSON(toJSON(row))));
  });

  it('resolves row paths', () => {
    const frac = createFrac([createToken('mi', 'a')], [createToken('mi', 'b')]);
    const root = createRow([createToken('mi', 'x'), frac]);
    const path = getRowPath(frac.den);
    expect(path).toEqual([1, 'den']);
    expect(resolveRowPath(root, path)).toBe(frac.den);
  });
});

describe('math model: MathML', () => {
  it('serialises to presentation MathML', () => {
    expect(mathmlOf('\\frac{a}{b}')).toBe('<math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac><mi>a</mi><mi>b</mi></mfrac></math>');
    expect(mathmlOf('x^{2}')).toBe('<math xmlns="http://www.w3.org/1998/Math/MathML"><msup><mi>x</mi><mn>2</mn></msup></math>');
    expect(mathmlOf('12 + \\sin x')).toContain('<mn>12</mn><mo>+</mo><mi mathvariant="normal">sin</mi><mi>x</mi>');
    expect(mathmlOf('\\sum_{i=1}^{n} i')).toContain('<munderover><mo largeop="true">∑</mo>');
    expect(mathmlOf('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}')).toContain('<mrow><mo fence="true" stretchy="true">(</mo><mtable><mtr><mtd><mi>a</mi></mtd><mtd><mi>b</mi></mtd></mtr>');
    expect(toMathML(parseLatex('a'), { display: true, annotation: 'a', alttext: 'a' })).toBe('<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" alttext="a"><semantics><mrow><mi>a</mi></mrow><annotation encoding="application/x-tex">a</annotation></semantics></math>');
  });

  it('parses MathML back into the tree', () => {
    for (const latex of ['\\frac{a}{b}', 'x_{i}^{2}', '\\sqrt[3]{x}', '\\sum_{i=1}^{n}i', '\\left(a+b\\right)', '\\hat{x}', '\\begin{bmatrix}1 & 2 \\\\ 3 & 4\\end{bmatrix}', '\\int_{0}^{1}x\\,dx']) {
      const mathml = toMathML(parseLatex(latex));
      const tree = parseMathML(parseMathMLString(mathml));
      expect(toLatex(tree)).toBe(latex);
    }
  });

  it('reads the TeX annotation', () => {
    const mathml = toMathML(parseLatex('a+b'), { annotation: 'a+b' });
    expect(getTexAnnotation(parseMathMLString(mathml))).toBe('a+b');
  });
});

describe('math model: speech', () => {
  it('describes formulas in words', () => {
    expect(toSpeech(parseLatex('\\frac{1}{2}'))).toBe('1 half');
    expect(toSpeech(parseLatex('\\frac{a+b}{c}'))).toBe('a plus b over c');
    expect(toSpeech(parseLatex('\\sqrt{x}'))).toBe('the square root of x');
    expect(toSpeech(parseLatex('x^2 + y^2 = z^2'))).toBe('x squared plus y squared equals z squared');
    expect(toSpeech(parseLatex('\\sum_{i=1}^{n} i'))).toBe('sum from i equals 1 to n of i');
    expect(toSpeech(parseLatex('\\int_0^1 f(x) dx'))).toBe('integral from 0 to 1 of f open paren x close paren d x');
    expect(toSpeech(parseLatex('\\alpha \\leq \\beta'))).toBe('alpha is less than or equal to beta');
    expect(toSpeech(parseLatex('\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}'))).toBe('2 by 2 matrix: row 1: 1, 2; row 2: 3, 4');
  });
});

