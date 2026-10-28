import { describe, it, expect } from 'vitest';
import { parseLatex, toLatex } from './latex';
import { toMathML, parseMathML, domToMathMLLike } from './mathml';
import { toSpeech } from './speech';

function roundTrip(latex: string): string {
  return toLatex(parseLatex(latex));
}

function parseMathMLString(mathml: string) {
  const doc = new DOMParser().parseFromString(mathml, 'text/html');
  return domToMathMLLike(doc.body.firstElementChild!);
}

describe('math model: phase 2 constructs', () => {
  it('round-trips styles, enclosures, arrows and pre-scripts', () => {
    expect(roundTrip('\\textcolor{red}{x+1}')).toBe('\\textcolor{red}{x+1}');
    expect(roundTrip('\\colorbox{yellow}{$x$}')).toBe('\\colorbox{yellow}{$x$}');
    expect(roundTrip('{\\small ab}')).toBe('{\\small ab}');
    expect(roundTrip('{\\displaystyle \\frac{1}{2}}')).toBe('{\\displaystyle \\frac{1}{2}}');
    expect(roundTrip('\\boxed{E=mc^2}')).toBe('\\boxed{E=mc^{2}}');
    expect(roundTrip('\\cancel{x}+\\xcancel{y}')).toBe('\\cancel{x}+\\xcancel{y}');
    expect(roundTrip('A\\xrightarrow[below]{above}B')).toBe('A\\xrightarrow[below]{above}B');
    expect(roundTrip('{}_{a}^{b}X')).toBe('{}_{a}^{b}X');
    expect(roundTrip('\\overset{a}{b}')).toBe('\\overset{a}{b}');
    expect(roundTrip('\\underset{a}{b}')).toBe('\\underset{a}{b}');
    expect(roundTrip('\\overbrace{x+y}^{n}')).toBe('\\overbrace{x+y}^{n}');
    expect(roundTrip('\\binom{n}{k}\\dfrac{a}{b}')).toBe('\\binom{n}{k}\\dfrac{a}{b}');
    expect(roundTrip('\\raisebox{0.5em}{$x$}')).toBe('\\raisebox{0.5em}{$x$}');
    expect(roundTrip('\\textbf{bold}')).toBe('\\textbf{bold}');
  });

  it('round-trips array tables with lines and alignment', () => {
    const framed = '\\left(\\begin{array}{|l|r|}\\hline a & b \\\\ \\hline c & d \\\\ \\hline\\end{array}\\right)';
    const tree = parseLatex(framed);
    const table = tree.children[0] as any;
    expect(table.type).toBe('table');
    expect(table.fence).toBe('paren');
    expect(table.frame).toBe(true);
    expect(table.rowLines).toBe(true);
    expect(table.columnLines).toBe(true);
    expect(table.columnAlign).toEqual(['left', 'right']);
    expect(toLatex(tree)).toBe(framed);
  });

  it('round-trips phase 2 constructs through MathML', () => {
    for (const latex of ['\\textcolor{red}{x}', '\\boxed{x}', '\\xcancel{y}', 'A\\xrightarrow[u]{o}B', '{}_{a}^{b}X', '\\binom{n}{k}', '{\\small x}']) {
      const mathml = toMathML(parseLatex(latex));
      const tree = parseMathML(parseMathMLString(mathml));
      expect(toLatex(tree)).toBe(latex);
    }
    const mathml = toMathML(parseLatex('\\left(\\begin{array}{|c|c|}\\hline a & b \\\\ \\hline\\end{array}\\right)'));
    expect(mathml).toContain('<mtable frame="solid" columnlines="solid">');
    expect(mathml).toContain('<mo fence="true" stretchy="true">(</mo>');
  });

  it('speaks phase 2 constructs', () => {
    expect(toSpeech(parseLatex('\\binom{n}{k}'))).toBe('n choose k');
    expect(toSpeech(parseLatex('\\boxed{x}'))).toBe('x boxed');
    expect(toSpeech(parseLatex('A\\xrightarrow{f}B'))).toBe('A right arrow labelled f B');
    expect(toSpeech(parseLatex('\\textcolor{red}{x}'))).toBe('x in red');
  });
});
