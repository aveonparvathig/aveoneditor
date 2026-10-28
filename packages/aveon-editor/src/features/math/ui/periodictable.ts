/** Periodic table data for the chemistry toolbar. */

export type ElementCategory = 'alkali' | 'alkaline' | 'transition' | 'post-transition' | 'metalloid' | 'nonmetal' | 'halogen' | 'noble' | 'lanthanide' | 'actinide';

export interface ChemicalElement {
  number: number;
  symbol: string;
  name: string;
  category: ElementCategory;
  /** Period (row) and group (column) in the standard 18-column layout; lanthanides and actinides use rows 8 and 9. */
  period: number;
  group: number;
}

const raw: Array<[number, string, string, ElementCategory, number, number]> = [
  [1, 'H', 'Hydrogen', 'nonmetal', 1, 1],
  [2, 'He', 'Helium', 'noble', 1, 18],
  [3, 'Li', 'Lithium', 'alkali', 2, 1],
  [4, 'Be', 'Beryllium', 'alkaline', 2, 2],
  [5, 'B', 'Boron', 'metalloid', 2, 13],
  [6, 'C', 'Carbon', 'nonmetal', 2, 14],
  [7, 'N', 'Nitrogen', 'nonmetal', 2, 15],
  [8, 'O', 'Oxygen', 'nonmetal', 2, 16],
  [9, 'F', 'Fluorine', 'halogen', 2, 17],
  [10, 'Ne', 'Neon', 'noble', 2, 18],
  [11, 'Na', 'Sodium', 'alkali', 3, 1],
  [12, 'Mg', 'Magnesium', 'alkaline', 3, 2],
  [13, 'Al', 'Aluminium', 'post-transition', 3, 13],
  [14, 'Si', 'Silicon', 'metalloid', 3, 14],
  [15, 'P', 'Phosphorus', 'nonmetal', 3, 15],
  [16, 'S', 'Sulfur', 'nonmetal', 3, 16],
  [17, 'Cl', 'Chlorine', 'halogen', 3, 17],
  [18, 'Ar', 'Argon', 'noble', 3, 18],
  [19, 'K', 'Potassium', 'alkali', 4, 1],
  [20, 'Ca', 'Calcium', 'alkaline', 4, 2],
  [21, 'Sc', 'Scandium', 'transition', 4, 3],
  [22, 'Ti', 'Titanium', 'transition', 4, 4],
  [23, 'V', 'Vanadium', 'transition', 4, 5],
  [24, 'Cr', 'Chromium', 'transition', 4, 6],
  [25, 'Mn', 'Manganese', 'transition', 4, 7],
  [26, 'Fe', 'Iron', 'transition', 4, 8],
  [27, 'Co', 'Cobalt', 'transition', 4, 9],
  [28, 'Ni', 'Nickel', 'transition', 4, 10],
  [29, 'Cu', 'Copper', 'transition', 4, 11],
  [30, 'Zn', 'Zinc', 'transition', 4, 12],
  [31, 'Ga', 'Gallium', 'post-transition', 4, 13],
  [32, 'Ge', 'Germanium', 'metalloid', 4, 14],
  [33, 'As', 'Arsenic', 'metalloid', 4, 15],
  [34, 'Se', 'Selenium', 'nonmetal', 4, 16],
  [35, 'Br', 'Bromine', 'halogen', 4, 17],
  [36, 'Kr', 'Krypton', 'noble', 4, 18],
  [37, 'Rb', 'Rubidium', 'alkali', 5, 1],
  [38, 'Sr', 'Strontium', 'alkaline', 5, 2],
  [39, 'Y', 'Yttrium', 'transition', 5, 3],
  [40, 'Zr', 'Zirconium', 'transition', 5, 4],
  [41, 'Nb', 'Niobium', 'transition', 5, 5],
  [42, 'Mo', 'Molybdenum', 'transition', 5, 6],
  [43, 'Tc', 'Technetium', 'transition', 5, 7],
  [44, 'Ru', 'Ruthenium', 'transition', 5, 8],
  [45, 'Rh', 'Rhodium', 'transition', 5, 9],
  [46, 'Pd', 'Palladium', 'transition', 5, 10],
  [47, 'Ag', 'Silver', 'transition', 5, 11],
  [48, 'Cd', 'Cadmium', 'transition', 5, 12],
  [49, 'In', 'Indium', 'post-transition', 5, 13],
  [50, 'Sn', 'Tin', 'post-transition', 5, 14],
  [51, 'Sb', 'Antimony', 'metalloid', 5, 15],
  [52, 'Te', 'Tellurium', 'metalloid', 5, 16],
  [53, 'I', 'Iodine', 'halogen', 5, 17],
  [54, 'Xe', 'Xenon', 'noble', 5, 18],
  [55, 'Cs', 'Caesium', 'alkali', 6, 1],
  [56, 'Ba', 'Barium', 'alkaline', 6, 2],
  [57, 'La', 'Lanthanum', 'lanthanide', 8, 3],
  [58, 'Ce', 'Cerium', 'lanthanide', 8, 4],
  [59, 'Pr', 'Praseodymium', 'lanthanide', 8, 5],
  [60, 'Nd', 'Neodymium', 'lanthanide', 8, 6],
  [61, 'Pm', 'Promethium', 'lanthanide', 8, 7],
  [62, 'Sm', 'Samarium', 'lanthanide', 8, 8],
  [63, 'Eu', 'Europium', 'lanthanide', 8, 9],
  [64, 'Gd', 'Gadolinium', 'lanthanide', 8, 10],
  [65, 'Tb', 'Terbium', 'lanthanide', 8, 11],
  [66, 'Dy', 'Dysprosium', 'lanthanide', 8, 12],
  [67, 'Ho', 'Holmium', 'lanthanide', 8, 13],
  [68, 'Er', 'Erbium', 'lanthanide', 8, 14],
  [69, 'Tm', 'Thulium', 'lanthanide', 8, 15],
  [70, 'Yb', 'Ytterbium', 'lanthanide', 8, 16],
  [71, 'Lu', 'Lutetium', 'lanthanide', 8, 17],
  [72, 'Hf', 'Hafnium', 'transition', 6, 4],
  [73, 'Ta', 'Tantalum', 'transition', 6, 5],
  [74, 'W', 'Tungsten', 'transition', 6, 6],
  [75, 'Re', 'Rhenium', 'transition', 6, 7],
  [76, 'Os', 'Osmium', 'transition', 6, 8],
  [77, 'Ir', 'Iridium', 'transition', 6, 9],
  [78, 'Pt', 'Platinum', 'transition', 6, 10],
  [79, 'Au', 'Gold', 'transition', 6, 11],
  [80, 'Hg', 'Mercury', 'transition', 6, 12],
  [81, 'Tl', 'Thallium', 'post-transition', 6, 13],
  [82, 'Pb', 'Lead', 'post-transition', 6, 14],
  [83, 'Bi', 'Bismuth', 'post-transition', 6, 15],
  [84, 'Po', 'Polonium', 'post-transition', 6, 16],
  [85, 'At', 'Astatine', 'halogen', 6, 17],
  [86, 'Rn', 'Radon', 'noble', 6, 18],
  [87, 'Fr', 'Francium', 'alkali', 7, 1],
  [88, 'Ra', 'Radium', 'alkaline', 7, 2],
  [89, 'Ac', 'Actinium', 'actinide', 9, 3],
  [90, 'Th', 'Thorium', 'actinide', 9, 4],
  [91, 'Pa', 'Protactinium', 'actinide', 9, 5],
  [92, 'U', 'Uranium', 'actinide', 9, 6],
  [93, 'Np', 'Neptunium', 'actinide', 9, 7],
  [94, 'Pu', 'Plutonium', 'actinide', 9, 8],
  [95, 'Am', 'Americium', 'actinide', 9, 9],
  [96, 'Cm', 'Curium', 'actinide', 9, 10],
  [97, 'Bk', 'Berkelium', 'actinide', 9, 11],
  [98, 'Cf', 'Californium', 'actinide', 9, 12],
  [99, 'Es', 'Einsteinium', 'actinide', 9, 13],
  [100, 'Fm', 'Fermium', 'actinide', 9, 14],
  [101, 'Md', 'Mendelevium', 'actinide', 9, 15],
  [102, 'No', 'Nobelium', 'actinide', 9, 16],
  [103, 'Lr', 'Lawrencium', 'actinide', 9, 17],
  [104, 'Rf', 'Rutherfordium', 'transition', 7, 4],
  [105, 'Db', 'Dubnium', 'transition', 7, 5],
  [106, 'Sg', 'Seaborgium', 'transition', 7, 6],
  [107, 'Bh', 'Bohrium', 'transition', 7, 7],
  [108, 'Hs', 'Hassium', 'transition', 7, 8],
  [109, 'Mt', 'Meitnerium', 'transition', 7, 9],
  [110, 'Ds', 'Darmstadtium', 'transition', 7, 10],
  [111, 'Rg', 'Roentgenium', 'transition', 7, 11],
  [112, 'Cn', 'Copernicium', 'transition', 7, 12],
  [113, 'Nh', 'Nihonium', 'post-transition', 7, 13],
  [114, 'Fl', 'Flerovium', 'post-transition', 7, 14],
  [115, 'Mc', 'Moscovium', 'post-transition', 7, 15],
  [116, 'Lv', 'Livermorium', 'post-transition', 7, 16],
  [117, 'Ts', 'Tennessine', 'halogen', 7, 17],
  [118, 'Og', 'Oganesson', 'noble', 7, 18]
];

export const periodicTable: ChemicalElement[] = raw.map(([number, symbol, name, category, period, group]) => ({ number, symbol, name, category, period, group }));

export const elementBySymbol = new Map(periodicTable.map(element => [element.symbol, element]));

/** Elements shown directly on the chemistry toolbar. */
export const commonElements = ['H', 'C', 'N', 'O', 'F', 'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'K', 'Ca', 'Fe', 'Cu', 'Zn', 'Br', 'Ag', 'I', 'Au', 'Hg', 'Pb'];

/** Longest-match element symbols in a string of letters, e.g. "NaCl" → ["Na", "Cl"]; `null` when it is not a formula. */
export function splitElementSymbols(text: string): string[] | null {
  const result: string[] = [];
  let i = 0;
  while (i < text.length) {
    const two = text.slice(i, i + 2);
    const one = text.slice(i, i + 1);
    if (elementBySymbol.has(two)) {
      result.push(two);
      i += 2;
    } else if (elementBySymbol.has(one)) {
      result.push(one);
      i += 1;
    } else {
      return null;
    }
  }
  return result;
}
