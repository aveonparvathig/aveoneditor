/**
 * Symbol tables shared by the parser, serialisers, speech generator and toolbar.
 * Each entry maps a Unicode character to its LaTeX command, MathML token kind and spoken name.
 */

import type { TokenKind, StyleSize, EncloseNotation } from './nodes';

export interface SymbolInfo {
  char: string;
  latex: string;
  kind: TokenKind;
  speech: string;
  /** Spacing class used by the canvas renderer. */
  spacing?: 'bin' | 'rel' | 'none';
}

const entries: SymbolInfo[] = [
  // Arithmetic
  { char: '+', latex: '+', kind: 'mo', speech: 'plus', spacing: 'bin' },
  { char: '−', latex: '-', kind: 'mo', speech: 'minus', spacing: 'bin' },
  { char: '±', latex: '\\pm', kind: 'mo', speech: 'plus or minus', spacing: 'bin' },
  { char: '∓', latex: '\\mp', kind: 'mo', speech: 'minus or plus', spacing: 'bin' },
  { char: '×', latex: '\\times', kind: 'mo', speech: 'times', spacing: 'bin' },
  { char: '÷', latex: '\\div', kind: 'mo', speech: 'divided by', spacing: 'bin' },
  { char: '⋅', latex: '\\cdot', kind: 'mo', speech: 'dot', spacing: 'bin' },
  { char: '∘', latex: '\\circ', kind: 'mo', speech: 'composed with', spacing: 'bin' },
  { char: '∗', latex: '\\ast', kind: 'mo', speech: 'asterisk', spacing: 'bin' },
  { char: '⋆', latex: '\\star', kind: 'mo', speech: 'star', spacing: 'bin' },
  { char: '∖', latex: '\\setminus', kind: 'mo', speech: 'set minus', spacing: 'bin' },
  { char: '/', latex: '/', kind: 'mo', speech: 'slash', spacing: 'none' },
  { char: '!', latex: '!', kind: 'mo', speech: 'factorial', spacing: 'none' },
  { char: '%', latex: '\\%', kind: 'mo', speech: 'percent', spacing: 'none' },
  { char: '#', latex: '\\#', kind: 'mo', speech: 'number sign', spacing: 'none' },
  { char: '&', latex: '\\&', kind: 'mo', speech: 'ampersand', spacing: 'none' },
  // Relations
  { char: '=', latex: '=', kind: 'mo', speech: 'equals', spacing: 'rel' },
  { char: '≠', latex: '\\neq', kind: 'mo', speech: 'is not equal to', spacing: 'rel' },
  { char: '≈', latex: '\\approx', kind: 'mo', speech: 'is approximately equal to', spacing: 'rel' },
  { char: '≡', latex: '\\equiv', kind: 'mo', speech: 'is equivalent to', spacing: 'rel' },
  { char: '≃', latex: '\\simeq', kind: 'mo', speech: 'is asymptotically equal to', spacing: 'rel' },
  { char: '≅', latex: '\\cong', kind: 'mo', speech: 'is congruent to', spacing: 'rel' },
  { char: '∼', latex: '\\sim', kind: 'mo', speech: 'is similar to', spacing: 'rel' },
  { char: '∝', latex: '\\propto', kind: 'mo', speech: 'is proportional to', spacing: 'rel' },
  { char: '<', latex: '<', kind: 'mo', speech: 'is less than', spacing: 'rel' },
  { char: '>', latex: '>', kind: 'mo', speech: 'is greater than', spacing: 'rel' },
  { char: '≤', latex: '\\leq', kind: 'mo', speech: 'is less than or equal to', spacing: 'rel' },
  { char: '≥', latex: '\\geq', kind: 'mo', speech: 'is greater than or equal to', spacing: 'rel' },
  { char: '≪', latex: '\\ll', kind: 'mo', speech: 'is much less than', spacing: 'rel' },
  { char: '≫', latex: '\\gg', kind: 'mo', speech: 'is much greater than', spacing: 'rel' },
  { char: '≺', latex: '\\prec', kind: 'mo', speech: 'precedes', spacing: 'rel' },
  { char: '≻', latex: '\\succ', kind: 'mo', speech: 'succeeds', spacing: 'rel' },
  { char: '∣', latex: '\\mid', kind: 'mo', speech: 'divides', spacing: 'rel' },
  { char: '∤', latex: '\\nmid', kind: 'mo', speech: 'does not divide', spacing: 'rel' },
  { char: '∥', latex: '\\parallel', kind: 'mo', speech: 'is parallel to', spacing: 'rel' },
  { char: '⊥', latex: '\\perp', kind: 'mo', speech: 'is perpendicular to', spacing: 'rel' },
  { char: ':', latex: ':', kind: 'mo', speech: 'colon', spacing: 'rel' },
  { char: '≐', latex: '\\doteq', kind: 'mo', speech: 'approaches the limit', spacing: 'rel' },
  { char: '≔', latex: '\\coloneqq', kind: 'mo', speech: 'is defined as', spacing: 'rel' },
  // Sets
  { char: '∈', latex: '\\in', kind: 'mo', speech: 'is an element of', spacing: 'rel' },
  { char: '∉', latex: '\\notin', kind: 'mo', speech: 'is not an element of', spacing: 'rel' },
  { char: '∋', latex: '\\ni', kind: 'mo', speech: 'contains as an element', spacing: 'rel' },
  { char: '⊂', latex: '\\subset', kind: 'mo', speech: 'is a subset of', spacing: 'rel' },
  { char: '⊃', latex: '\\supset', kind: 'mo', speech: 'is a superset of', spacing: 'rel' },
  { char: '⊆', latex: '\\subseteq', kind: 'mo', speech: 'is a subset of or equal to', spacing: 'rel' },
  { char: '⊇', latex: '\\supseteq', kind: 'mo', speech: 'is a superset of or equal to', spacing: 'rel' },
  { char: '∪', latex: '\\cup', kind: 'mo', speech: 'union', spacing: 'bin' },
  { char: '∩', latex: '\\cap', kind: 'mo', speech: 'intersection', spacing: 'bin' },
  { char: '∅', latex: '\\emptyset', kind: 'mi', speech: 'empty set' },
  { char: 'ℕ', latex: '\\mathbb{N}', kind: 'mi', speech: 'the natural numbers' },
  { char: 'ℤ', latex: '\\mathbb{Z}', kind: 'mi', speech: 'the integers' },
  { char: 'ℚ', latex: '\\mathbb{Q}', kind: 'mi', speech: 'the rational numbers' },
  { char: 'ℝ', latex: '\\mathbb{R}', kind: 'mi', speech: 'the real numbers' },
  { char: 'ℂ', latex: '\\mathbb{C}', kind: 'mi', speech: 'the complex numbers' },
  { char: '℘', latex: '\\wp', kind: 'mi', speech: 'Weierstrass p' },
  // Logic
  { char: '¬', latex: '\\neg', kind: 'mo', speech: 'not', spacing: 'none' },
  { char: '∧', latex: '\\wedge', kind: 'mo', speech: 'and', spacing: 'bin' },
  { char: '∨', latex: '\\vee', kind: 'mo', speech: 'or', spacing: 'bin' },
  { char: '⊕', latex: '\\oplus', kind: 'mo', speech: 'direct sum', spacing: 'bin' },
  { char: '⊗', latex: '\\otimes', kind: 'mo', speech: 'tensor product', spacing: 'bin' },
  { char: '⊙', latex: '\\odot', kind: 'mo', speech: 'circled dot', spacing: 'bin' },
  { char: '⊖', latex: '\\ominus', kind: 'mo', speech: 'circled minus', spacing: 'bin' },
  { char: '⊘', latex: '\\oslash', kind: 'mo', speech: 'circled slash', spacing: 'bin' },
  { char: '∀', latex: '\\forall', kind: 'mo', speech: 'for all', spacing: 'none' },
  { char: '∃', latex: '\\exists', kind: 'mo', speech: 'there exists', spacing: 'none' },
  { char: '∄', latex: '\\nexists', kind: 'mo', speech: 'there does not exist', spacing: 'none' },
  { char: '∴', latex: '\\therefore', kind: 'mo', speech: 'therefore', spacing: 'rel' },
  { char: '∵', latex: '\\because', kind: 'mo', speech: 'because', spacing: 'rel' },
  { char: '⊢', latex: '\\vdash', kind: 'mo', speech: 'proves', spacing: 'rel' },
  { char: '⊨', latex: '\\models', kind: 'mo', speech: 'models', spacing: 'rel' },
  { char: '⊤', latex: '\\top', kind: 'mi', speech: 'top' },
  // Arrows
  { char: '→', latex: '\\rightarrow', kind: 'mo', speech: 'right arrow', spacing: 'rel' },
  { char: '←', latex: '\\leftarrow', kind: 'mo', speech: 'left arrow', spacing: 'rel' },
  { char: '↔', latex: '\\leftrightarrow', kind: 'mo', speech: 'left right arrow', spacing: 'rel' },
  { char: '⇒', latex: '\\Rightarrow', kind: 'mo', speech: 'implies', spacing: 'rel' },
  { char: '⇐', latex: '\\Leftarrow', kind: 'mo', speech: 'is implied by', spacing: 'rel' },
  { char: '⇔', latex: '\\Leftrightarrow', kind: 'mo', speech: 'if and only if', spacing: 'rel' },
  { char: '⟶', latex: '\\longrightarrow', kind: 'mo', speech: 'long right arrow', spacing: 'rel' },
  { char: '⟵', latex: '\\longleftarrow', kind: 'mo', speech: 'long left arrow', spacing: 'rel' },
  { char: '⟷', latex: '\\longleftrightarrow', kind: 'mo', speech: 'long left right arrow', spacing: 'rel' },
  { char: '⟹', latex: '\\Longrightarrow', kind: 'mo', speech: 'long implies', spacing: 'rel' },
  { char: '⟸', latex: '\\Longleftarrow', kind: 'mo', speech: 'long is implied by', spacing: 'rel' },
  { char: '⟺', latex: '\\Longleftrightarrow', kind: 'mo', speech: 'long if and only if', spacing: 'rel' },
  { char: '↦', latex: '\\mapsto', kind: 'mo', speech: 'maps to', spacing: 'rel' },
  { char: '⟼', latex: '\\longmapsto', kind: 'mo', speech: 'long maps to', spacing: 'rel' },
  { char: '↑', latex: '\\uparrow', kind: 'mo', speech: 'up arrow', spacing: 'rel' },
  { char: '↓', latex: '\\downarrow', kind: 'mo', speech: 'down arrow', spacing: 'rel' },
  { char: '↕', latex: '\\updownarrow', kind: 'mo', speech: 'up down arrow', spacing: 'rel' },
  { char: '⇑', latex: '\\Uparrow', kind: 'mo', speech: 'double up arrow', spacing: 'rel' },
  { char: '⇓', latex: '\\Downarrow', kind: 'mo', speech: 'double down arrow', spacing: 'rel' },
  { char: '⇕', latex: '\\Updownarrow', kind: 'mo', speech: 'double up down arrow', spacing: 'rel' },
  { char: '↗', latex: '\\nearrow', kind: 'mo', speech: 'north east arrow', spacing: 'rel' },
  { char: '↘', latex: '\\searrow', kind: 'mo', speech: 'south east arrow', spacing: 'rel' },
  { char: '↖', latex: '\\nwarrow', kind: 'mo', speech: 'north west arrow', spacing: 'rel' },
  { char: '↙', latex: '\\swarrow', kind: 'mo', speech: 'south west arrow', spacing: 'rel' },
  { char: '⇀', latex: '\\rightharpoonup', kind: 'mo', speech: 'right harpoon up', spacing: 'rel' },
  { char: '⇁', latex: '\\rightharpoondown', kind: 'mo', speech: 'right harpoon down', spacing: 'rel' },
  { char: '↼', latex: '\\leftharpoonup', kind: 'mo', speech: 'left harpoon up', spacing: 'rel' },
  { char: '↽', latex: '\\leftharpoondown', kind: 'mo', speech: 'left harpoon down', spacing: 'rel' },
  { char: '⇌', latex: '\\rightleftharpoons', kind: 'mo', speech: 'is in equilibrium with', spacing: 'rel' },
  { char: '⇄', latex: '\\rightleftarrows', kind: 'mo', speech: 'right left arrows', spacing: 'rel' },
  { char: '⇆', latex: '\\leftrightarrows', kind: 'mo', speech: 'left right arrows', spacing: 'rel' },
  { char: '↪', latex: '\\hookrightarrow', kind: 'mo', speech: 'hook right arrow', spacing: 'rel' },
  { char: '↩', latex: '\\hookleftarrow', kind: 'mo', speech: 'hook left arrow', spacing: 'rel' },
  { char: '↠', latex: '\\twoheadrightarrow', kind: 'mo', speech: 'two headed right arrow', spacing: 'rel' },
  { char: '↞', latex: '\\twoheadleftarrow', kind: 'mo', speech: 'two headed left arrow', spacing: 'rel' },
  { char: '⇝', latex: '\\rightsquigarrow', kind: 'mo', speech: 'squiggle right arrow', spacing: 'rel' },
  { char: '⤳', latex: '\\leadsto', kind: 'mo', speech: 'leads to', spacing: 'rel' },
  { char: '↶', latex: '\\curvearrowleft', kind: 'mo', speech: 'curved left arrow', spacing: 'rel' },
  { char: '↷', latex: '\\curvearrowright', kind: 'mo', speech: 'curved right arrow', spacing: 'rel' },
  // Misc
  { char: '∞', latex: '\\infty', kind: 'mi', speech: 'infinity' },
  { char: '∂', latex: '\\partial', kind: 'mi', speech: 'partial' },
  { char: '∇', latex: '\\nabla', kind: 'mi', speech: 'nabla' },
  { char: '°', latex: '^\\circ', kind: 'mo', speech: 'degrees', spacing: 'none' },
  { char: '′', latex: '\\prime', kind: 'mo', speech: 'prime', spacing: 'none' },
  { char: '…', latex: '\\ldots', kind: 'mo', speech: 'dot dot dot', spacing: 'none' },
  { char: '⋯', latex: '\\cdots', kind: 'mo', speech: 'dot dot dot', spacing: 'none' },
  { char: '⋮', latex: '\\vdots', kind: 'mo', speech: 'vertical dots', spacing: 'none' },
  { char: '⋱', latex: '\\ddots', kind: 'mo', speech: 'diagonal dots', spacing: 'none' },
  { char: '∠', latex: '\\angle', kind: 'mo', speech: 'angle', spacing: 'none' },
  { char: '∡', latex: '\\measuredangle', kind: 'mo', speech: 'measured angle', spacing: 'none' },
  { char: '△', latex: '\\triangle', kind: 'mo', speech: 'triangle', spacing: 'none' },
  { char: '□', latex: '\\square', kind: 'mo', speech: 'square', spacing: 'none' },
  { char: '◇', latex: '\\diamond', kind: 'mo', speech: 'diamond', spacing: 'bin' },
  { char: '○', latex: '\\bigcirc', kind: 'mo', speech: 'circle', spacing: 'bin' },
  { char: 'ħ', latex: '\\hbar', kind: 'mi', speech: 'h bar' },
  { char: 'ℓ', latex: '\\ell', kind: 'mi', speech: 'script l' },
  { char: 'ℵ', latex: '\\aleph', kind: 'mi', speech: 'aleph' },
  { char: 'ℜ', latex: '\\Re', kind: 'mi', speech: 'real part' },
  { char: 'ℑ', latex: '\\Im', kind: 'mi', speech: 'imaginary part' },
  { char: '∁', latex: '\\complement', kind: 'mi', speech: 'complement' },
  { char: ',', latex: ',', kind: 'mo', speech: 'comma', spacing: 'none' },
  { char: ';', latex: ';', kind: 'mo', speech: 'semicolon', spacing: 'none' },
  { char: '.', latex: '.', kind: 'mn', speech: 'point' },
  { char: '(', latex: '(', kind: 'mo', speech: 'open paren', spacing: 'none' },
  { char: ')', latex: ')', kind: 'mo', speech: 'close paren', spacing: 'none' },
  { char: '[', latex: '[', kind: 'mo', speech: 'open bracket', spacing: 'none' },
  { char: ']', latex: ']', kind: 'mo', speech: 'close bracket', spacing: 'none' },
  { char: '{', latex: '\\{', kind: 'mo', speech: 'open brace', spacing: 'none' },
  { char: '}', latex: '\\}', kind: 'mo', speech: 'close brace', spacing: 'none' },
  { char: '|', latex: '|', kind: 'mo', speech: 'vertical bar', spacing: 'none' },
  { char: '‖', latex: '\\|', kind: 'mo', speech: 'double vertical bar', spacing: 'none' },
  { char: '⟨', latex: '\\langle', kind: 'mo', speech: 'open angle bracket', spacing: 'none' },
  { char: '⟩', latex: '\\rangle', kind: 'mo', speech: 'close angle bracket', spacing: 'none' },
  { char: '⌊', latex: '\\lfloor', kind: 'mo', speech: 'floor of', spacing: 'none' },
  { char: '⌋', latex: '\\rfloor', kind: 'mo', speech: 'end floor', spacing: 'none' },
  { char: '⌈', latex: '\\lceil', kind: 'mo', speech: 'ceiling of', spacing: 'none' },
  { char: '⌉', latex: '\\rceil', kind: 'mo', speech: 'end ceiling', spacing: 'none' },
  // Large operators
  { char: '∑', latex: '\\sum', kind: 'mo', speech: 'sum', spacing: 'none' },
  { char: '∏', latex: '\\prod', kind: 'mo', speech: 'product', spacing: 'none' },
  { char: '∐', latex: '\\coprod', kind: 'mo', speech: 'coproduct', spacing: 'none' },
  { char: '∫', latex: '\\int', kind: 'mo', speech: 'integral', spacing: 'none' },
  { char: '∬', latex: '\\iint', kind: 'mo', speech: 'double integral', spacing: 'none' },
  { char: '∭', latex: '\\iiint', kind: 'mo', speech: 'triple integral', spacing: 'none' },
  { char: '∮', latex: '\\oint', kind: 'mo', speech: 'contour integral', spacing: 'none' },
  { char: '⋃', latex: '\\bigcup', kind: 'mo', speech: 'union', spacing: 'none' },
  { char: '⋂', latex: '\\bigcap', kind: 'mo', speech: 'intersection', spacing: 'none' },
  { char: '⨁', latex: '\\bigoplus', kind: 'mo', speech: 'direct sum', spacing: 'none' },
  { char: '⨂', latex: '\\bigotimes', kind: 'mo', speech: 'tensor product', spacing: 'none' },
  { char: '⋁', latex: '\\bigvee', kind: 'mo', speech: 'logical or', spacing: 'none' },
  { char: '⋀', latex: '\\bigwedge', kind: 'mo', speech: 'logical and', spacing: 'none' }
];

export const greekLetters: Array<{ char: string; latex: string; speech: string }> = [
  { char: 'α', latex: '\\alpha', speech: 'alpha' },
  { char: 'β', latex: '\\beta', speech: 'beta' },
  { char: 'γ', latex: '\\gamma', speech: 'gamma' },
  { char: 'δ', latex: '\\delta', speech: 'delta' },
  { char: 'ε', latex: '\\epsilon', speech: 'epsilon' },
  { char: 'ϵ', latex: '\\varepsilon', speech: 'epsilon' },
  { char: 'ζ', latex: '\\zeta', speech: 'zeta' },
  { char: 'η', latex: '\\eta', speech: 'eta' },
  { char: 'θ', latex: '\\theta', speech: 'theta' },
  { char: 'ϑ', latex: '\\vartheta', speech: 'theta' },
  { char: 'ι', latex: '\\iota', speech: 'iota' },
  { char: 'κ', latex: '\\kappa', speech: 'kappa' },
  { char: 'λ', latex: '\\lambda', speech: 'lambda' },
  { char: 'μ', latex: '\\mu', speech: 'mu' },
  { char: 'ν', latex: '\\nu', speech: 'nu' },
  { char: 'ξ', latex: '\\xi', speech: 'xi' },
  { char: 'π', latex: '\\pi', speech: 'pi' },
  { char: 'ϖ', latex: '\\varpi', speech: 'pi' },
  { char: 'ρ', latex: '\\rho', speech: 'rho' },
  { char: 'ϱ', latex: '\\varrho', speech: 'rho' },
  { char: 'σ', latex: '\\sigma', speech: 'sigma' },
  { char: 'ς', latex: '\\varsigma', speech: 'final sigma' },
  { char: 'τ', latex: '\\tau', speech: 'tau' },
  { char: 'υ', latex: '\\upsilon', speech: 'upsilon' },
  { char: 'φ', latex: '\\phi', speech: 'phi' },
  { char: 'ϕ', latex: '\\varphi', speech: 'phi' },
  { char: 'χ', latex: '\\chi', speech: 'chi' },
  { char: 'ψ', latex: '\\psi', speech: 'psi' },
  { char: 'ω', latex: '\\omega', speech: 'omega' },
  { char: 'Γ', latex: '\\Gamma', speech: 'capital gamma' },
  { char: 'Δ', latex: '\\Delta', speech: 'capital delta' },
  { char: 'Θ', latex: '\\Theta', speech: 'capital theta' },
  { char: 'Λ', latex: '\\Lambda', speech: 'capital lambda' },
  { char: 'Ξ', latex: '\\Xi', speech: 'capital xi' },
  { char: 'Π', latex: '\\Pi', speech: 'capital pi' },
  { char: 'Σ', latex: '\\Sigma', speech: 'capital sigma' },
  { char: 'Υ', latex: '\\Upsilon', speech: 'capital upsilon' },
  { char: 'Φ', latex: '\\Phi', speech: 'capital phi' },
  { char: 'Ψ', latex: '\\Psi', speech: 'capital psi' },
  { char: 'Ω', latex: '\\Omega', speech: 'capital omega' }
];

for (const letter of greekLetters) {
  entries.push({ char: letter.char, latex: letter.latex, kind: 'mi', speech: letter.speech });
}

/** Named functions rendered upright. */
export const functionNames = ['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'coth', 'log', 'ln', 'lg', 'exp', 'lim', 'liminf', 'limsup', 'max', 'min', 'sup', 'inf', 'det', 'dim', 'ker', 'deg', 'gcd', 'hom', 'arg', 'Pr'];

/** Operators that take limits below/above in display mode. */
export const limitOperators = new Set(['\\sum', '\\prod', '\\coprod', '\\bigcup', '\\bigcap', '\\bigoplus', '\\bigotimes', '\\bigvee', '\\bigwedge', '\\lim', '\\liminf', '\\limsup', '\\max', '\\min', '\\sup', '\\inf']);

export const largeOperators = new Set(['\\sum', '\\prod', '\\coprod', '\\int', '\\iint', '\\iiint', '\\oint', '\\bigcup', '\\bigcap', '\\bigoplus', '\\bigotimes', '\\bigvee', '\\bigwedge']);

export const symbolsByChar = new Map<string, SymbolInfo>();
export const symbolsByLatex = new Map<string, SymbolInfo>();
for (const entry of entries) {
  if (!symbolsByChar.has(entry.char)) symbolsByChar.set(entry.char, entry);
  if (!symbolsByLatex.has(entry.latex)) symbolsByLatex.set(entry.latex, entry);
}
// Aliases accepted by the parser.
const aliases: Record<string, string> = {
  '\\le': '\\leq',
  '\\ge': '\\geq',
  '\\ne': '\\neq',
  '\\to': '\\rightarrow',
  '\\gets': '\\leftarrow',
  '\\implies': '\\Rightarrow',
  '\\impliedby': '\\Leftarrow',
  '\\iff': '\\Leftrightarrow',
  '\\land': '\\wedge',
  '\\lor': '\\vee',
  '\\lnot': '\\neg',
  '\\varnothing': '\\emptyset',
  '\\dots': '\\ldots',
  '\\dotsc': '\\ldots',
  '\\dotsb': '\\cdots',
  '\\lbrace': '\\{',
  '\\rbrace': '\\}',
  '\\lbrack': '[',
  '\\rbrack': ']',
  '\\vert': '|',
  '\\Vert': '\\|',
  '\\owns': '\\ni',
  '\\colon': ':',
  '\\bot': '\\perp'
};
for (const [alias, target] of Object.entries(aliases)) {
  const info = symbolsByLatex.get(target);
  if (info && !symbolsByLatex.has(alias)) symbolsByLatex.set(alias, info);
}

/** Spacing (em) of LaTeX space commands. */
export const spaceCommands: Record<string, number> = {
  '\\,': 0.17,
  '\\:': 0.22,
  '\\>': 0.22,
  '\\;': 0.28,
  '\\!': -0.17,
  '\\ ': 0.33,
  '~': 0.33,
  '\\enspace': 0.5,
  '\\quad': 1,
  '\\qquad': 2
};

/** Accents: LaTeX command → mark, position and whether it stretches over the base. */
export const accentCommands: Record<string, { mark: string; position: 'over' | 'under'; stretchy: boolean; speech: string }> = {
  '\\hat': { mark: '^', position: 'over', stretchy: false, speech: 'hat' },
  '\\widehat': { mark: '^', position: 'over', stretchy: true, speech: 'hat' },
  '\\bar': { mark: '¯', position: 'over', stretchy: false, speech: 'bar' },
  '\\overline': { mark: '‾', position: 'over', stretchy: true, speech: 'bar' },
  '\\underline': { mark: '_', position: 'under', stretchy: true, speech: 'underline' },
  '\\vec': { mark: '→', position: 'over', stretchy: false, speech: 'vector' },
  '\\overrightarrow': { mark: '→', position: 'over', stretchy: true, speech: 'vector' },
  '\\overleftarrow': { mark: '←', position: 'over', stretchy: true, speech: 'left arrow over' },
  '\\overleftrightarrow': { mark: '↔', position: 'over', stretchy: true, speech: 'left right arrow over' },
  '\\underrightarrow': { mark: '→', position: 'under', stretchy: true, speech: 'right arrow under' },
  '\\underleftarrow': { mark: '←', position: 'under', stretchy: true, speech: 'left arrow under' },
  '\\underleftrightarrow': { mark: '↔', position: 'under', stretchy: true, speech: 'left right arrow under' },
  '\\tilde': { mark: '~', position: 'over', stretchy: false, speech: 'tilde' },
  '\\widetilde': { mark: '~', position: 'over', stretchy: true, speech: 'tilde' },
  '\\dot': { mark: '˙', position: 'over', stretchy: false, speech: 'dot' },
  '\\ddot': { mark: '¨', position: 'over', stretchy: false, speech: 'double dot' },
  '\\dddot': { mark: '⃛', position: 'over', stretchy: false, speech: 'triple dot' },
  '\\breve': { mark: '˘', position: 'over', stretchy: false, speech: 'breve' },
  '\\check': { mark: 'ˇ', position: 'over', stretchy: false, speech: 'check' },
  '\\widecheck': { mark: 'ˇ', position: 'over', stretchy: true, speech: 'check' },
  '\\acute': { mark: '´', position: 'over', stretchy: false, speech: 'acute' },
  '\\grave': { mark: '`', position: 'over', stretchy: false, speech: 'grave' },
  '\\mathring': { mark: '˚', position: 'over', stretchy: false, speech: 'ring' },
  '\\overbrace': { mark: '⏞', position: 'over', stretchy: true, speech: 'overbrace' },
  '\\underbrace': { mark: '⏟', position: 'under', stretchy: true, speech: 'underbrace' },
  '\\overgroup': { mark: '⏠', position: 'over', stretchy: true, speech: 'overgroup' },
  '\\undergroup': { mark: '⏡', position: 'under', stretchy: true, speech: 'undergroup' },
  '\\overlinesegment': { mark: '⎴', position: 'over', stretchy: true, speech: 'line segment over' },
  '\\underlinesegment': { mark: '⎵', position: 'under', stretchy: true, speech: 'line segment under' }
};

/** Accents whose scripts are rendered as labels above/below (`\overbrace{x}^{label}`). */
export const braceAccents = new Set(['\\overbrace', '\\underbrace', '\\overgroup', '\\undergroup']);

/** Labelled (extensible) arrows: LaTeX command → arrow character. */
export const xarrowCommands: Record<string, { arrow: string; speech: string }> = {
  '\\xrightarrow': { arrow: '→', speech: 'right arrow' },
  '\\xleftarrow': { arrow: '←', speech: 'left arrow' },
  '\\xleftrightarrow': { arrow: '↔', speech: 'left right arrow' },
  '\\xRightarrow': { arrow: '⇒', speech: 'implies arrow' },
  '\\xLeftarrow': { arrow: '⇐', speech: 'is implied by arrow' },
  '\\xLeftrightarrow': { arrow: '⇔', speech: 'if and only if arrow' },
  '\\xmapsto': { arrow: '↦', speech: 'maps to arrow' },
  '\\xrightharpoonup': { arrow: '⇀', speech: 'right harpoon' },
  '\\xleftharpoonup': { arrow: '↼', speech: 'left harpoon' },
  '\\xrightleftharpoons': { arrow: '⇌', speech: 'equilibrium arrow' },
  '\\xhookrightarrow': { arrow: '↪', speech: 'hook right arrow' },
  '\\xhookleftarrow': { arrow: '↩', speech: 'hook left arrow' },
  '\\xtwoheadrightarrow': { arrow: '↠', speech: 'two headed right arrow' },
  '\\xtwoheadleftarrow': { arrow: '↞', speech: 'two headed left arrow' },
  '\\xlongequal': { arrow: '=', speech: 'long equals' }
};

/** Enclosures: LaTeX command ⇄ MathML notation. */
export const encloseCommands: Record<string, EncloseNotation> = {
  '\\boxed': 'box',
  '\\cancel': 'updiagonalstrike',
  '\\bcancel': 'downdiagonalstrike',
  '\\xcancel': 'crossout',
  '\\sout': 'horizontalstrike'
};

export const encloseSpeech: Record<EncloseNotation, string> = {
  box: 'boxed',
  updiagonalstrike: 'crossed out',
  downdiagonalstrike: 'crossed out',
  crossout: 'crossed out',
  horizontalstrike: 'struck through'
};

export const sizeCommands: Record<string, StyleSize> = {
  '\\tiny': 'tiny',
  '\\scriptsize': 'scriptsize',
  '\\small': 'small',
  '\\normalsize': 'normal',
  '\\large': 'large',
  '\\Large': 'Large',
  '\\huge': 'huge'
};

/** Relative font size (em) of each size keyword. */
export const sizeScale: Record<StyleSize, number> = {
  tiny: 0.5,
  scriptsize: 0.7,
  small: 0.9,
  normal: 1,
  large: 1.2,
  Large: 1.44,
  huge: 2.07
};

export const fenceDelimiters: Record<string, string> = {
  '(': '(',
  ')': ')',
  '[': '[',
  ']': ']',
  '\\{': '{',
  '\\}': '}',
  '\\lbrace': '{',
  '\\rbrace': '}',
  '|': '|',
  '\\vert': '|',
  '\\|': '‖',
  '\\Vert': '‖',
  '\\langle': '⟨',
  '\\rangle': '⟩',
  '\\lfloor': '⌊',
  '\\rfloor': '⌋',
  '\\lceil': '⌈',
  '\\rceil': '⌉',
  '/': '/',
  '\\backslash': '∖',
  '.': ''
};

/** Delimiter character → LaTeX form usable after `\left` / `\right`. */
export function delimiterToLatex(char: string): string {
  if (char === '') return '.';
  const entry = Object.entries(fenceDelimiters).find(([key, value]) => value === char && !['\\lbrace', '\\rbrace', '\\vert', '\\Vert'].includes(key));
  return entry ? entry[0] : char;
}
