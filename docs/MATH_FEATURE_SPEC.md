# Math re-engineering spec: 100 MathType features for Aveon Editor

Source analysis: wiris.com (MathType, ChemType, Office Tools, HTML editors), docs.wiris.com (MathType Web toolbar and icons, contextual tab, keyboard shortcuts, accessibility, chemistry, custom toolbar, toolbar XML reference, handwriting parameters) and the CKEditor 5 "Math equations and chemical formulas" page. MathType is a commercial product by Wiris; the list below is a clean-room functional specification, not a copy of their code.

**What MathType is**: a WYSIWYG formula editor that opens in a dialog from the host editor, builds formulas from toolbar templates and symbols (10 tabs, 500+ symbols), stores them as MathML, renders them as images (PNG/SVG) with generated alt text, and offers handwriting input, a chemistry mode (ChemType), LaTeX/MathML code windows and deep accessibility support.

**Where Aveon Editor is today** (after phase 3): the `Math` plugin stores LaTeX, derives MathML and a spoken description from a structured formula tree, renders with KaTeX, and edits through a balloon dialog with a visual WYSIWYG canvas (tabbed toolbar, slot navigation, selection, smart delete, undo) plus LaTeX and MathML code tabs with live preview. All nine toolbar tabs including the contextual tab, formatting (bold, italic, colour, size, display style), equation numbering, toolbar customisation, clipboard support and autoformat are done. Phase 3 added handwriting input with a built-in basic recogniser and a pluggable service, chemistry mode with a periodic table, image output, alt text in four languages, elementary arithmetic layouts, the publishers tab, right-to-left notation and high-contrast styles. The partial items are listed in the table; office-suite and LMS integrations are outside an editor plugin.

## Status summary

| Status | Count | Meaning |
| --- | --- | --- |
| Done | 86 | Works in Aveon today |
| Partial | 14 | Exists in a reduced form |
| Missing | 0 | Needs to be built |

Priority is marked P1 (core visual editor), P2 (parity for everyday use), P3 (publishing, chemistry, handwriting, platform).

## A. Core editor and data model

| # | Feature | MathType behaviour | Aveon status | Re-engineering work | Priority |
| --- | --- | --- | --- | --- | --- |
| 1 | MathML as canonical representation | Every formula is MathML internally; LaTeX and images are derived | Done (LaTeX stored; MathML derived from the formula tree for output and read back) | Add a `mathml` attribute next to `equation`; derive it from the formula tree; accept MathML on upcast | P1 |
| 2 | Structured formula tree | Fractions, scripts, roots, matrices are nodes with slots | Done (`features/math/model/nodes.ts`) | Build a `FormulaNode` model (mrow, mfrac, msup, msub, msubsup, msqrt, mroot, mtable, mfenced, mo, mi, mn, mtext, mspace) with parent/child slots | P1 |
| 3 | WYSIWYG editing area | Caret moves inside the rendered formula, slots are editable in place | Done (`FormulaEditorView` canvas with slot rendering and caret) | Render the tree to DOM with slot elements; own caret model (node + offset); keyboard input into slots; re-render on change | P1 |
| 4 | Slot navigation | Arrows move through fraction, root and script slots; ↑/↓ between numerator and denominator | Done | Tree-walk navigation rules per node type | P1 |
| 5 | Selection inside a formula | Shift+arrows, Home/End, Shift+Home/End select ranges within the current context | Done (within one row) | Range model over tree positions; visual highlight of selected nodes | P1 |
| 6 | Smart deleting | At a structure boundary, first Backspace highlights the structure, second confirms | Done | Two-step delete state with highlight on the boundary structure | P2 |
| 7 | Undo/redo in the formula editor | Ctrl+Z / Ctrl+Y inside the dialog | Done (snapshot stack, Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z) | Command stack for the formula tree | P1 |
| 8 | Cut/copy/paste of fragments | Formula fragments are copied as MathML and pasted into slots; external MathML/LaTeX paste accepted | Done (Ctrl+C/X/V inside the canvas: structure on an internal clipboard, LaTeX as plain text; pasted LaTeX is parsed) | Clipboard serialisation of selected subtree as MathML and LaTeX; paste parser | P2 |
| 9 | Insert and update semantics | OK inserts a new formula; opening an existing one and pressing OK updates it | Done | – | – |
| 10 | Open existing formula for editing | Double-click (CKEditor) or click the formula | Done (click, Ctrl+Alt+M) | Add double-click as well for parity | – |
| 11 | Classic / handwriting mode switch | Button in the dialog switches between toolbar editing and handwriting | Done (Handwriting mode tab; "Edit in the visual editor" switches back with the recognised formula) | Mode tabs in the dialog; depends on #22 | P3 |
| 12 | Default mode per device | Mobile opens handwriting, desktop opens classic, user can switch | Done (`math.defaultMode: 'auto'` opens handwriting on touch devices, visual elsewhere) | Device detection + `math.defaultMode` option | P3 |

## B. Input methods and keyboard behaviour

| # | Feature | MathType behaviour | Aveon status | Re-engineering work | Priority |
| --- | --- | --- | --- | --- | --- |
| 13 | LaTeX window | Ctrl+Shift+L opens a LaTeX code window for the current formula | Done (LaTeX tab, Ctrl+Shift+L toggles) | Keep as a code tab inside the new dialog | – |
| 14 | MathML window | Ctrl+Shift+X opens a MathML code window | Done (MathML tab, Ctrl+Shift+X; edits are parsed back into the formula) | Code tab showing MathML; parse edits back into the tree | P2 |
| 15 | Autoformat `a/b` → fraction | Typing `/` turns the preceding operand into a numerator | Done | Autoformat rules engine on the tree; `autoformat` option | P2 |
| 16 | Autoformat `^` and `_` → scripts | `a^b`, `a_b` create superscript/subscript slots | Done | Same engine as #15 | P2 |
| 17 | Autoformat operators | `*` → multiplication dot, `>=` → ≥, `<=` → ≤ | Done (`*` → ⋅, `<=`, `>=`, `!=`, `->`, `=>`) | Same engine as #15 | P2 |
| 18 | Automatic delimiter pairing | `(` inserts `( )`, `[` `[ ]`, `{` `{ }` with the caret inside; closing delimiter replaceable for mixed pairs such as `(0,1]` | Done (fence auto-pairing; closing delimiter leaves the fence) | Fence node with independent open/close; pairing on keypress | P2 |
| 19 | Script shortcuts | Ctrl+↑ inserts a superscript slot, Ctrl+↓ a subscript slot | Done | Keystroke bindings in the formula editor | P1 |
| 20 | Enter and Space in layouts | Enter adds a line (multiline) or a row (elementary arithmetic); Space indents in arithmetic layouts | Done (Enter in a matrix cell adds a row) | Context-dependent Enter/Space handlers | P2 |
| 21 | Bold / italic shortcuts | Ctrl+B / Ctrl+I toggle `mathvariant` on the selection or subsequent input | Done (Ctrl+B / Ctrl+I on the selection; identifiers toggle between italic and upright) | Style attributes on tree nodes; render to `\mathbf` / `\mathit` and MathML `mathvariant` | P2 |
| 22 | Handwriting recognition | Draw with touch, pen or mouse; strokes convert to an editable formula | Partial (built-in basic recogniser: digits, Latin letters, common operators, fractions, roots, scripts; `math.handwriting.recognizer` plugs in MyScript, Mathpix or any service) | Stroke canvas + recognition service (pluggable: MyScript, Mathpix, or an on-device model) | P3 |
| 23 | Handwriting canvas tools | Undo, redo, clear, help, switch to classic input | Done (undo, redo, clear; mode switch) | Canvas toolbar | P3 |
| 24 | Handwriting parameters | Stroke width (default 3px), stroke colour, read-only, deletion gesture on/off | Done (`math.handwriting`: strokeWidth, strokeColor, deletionGesture, recognitionDelay, readOnly, enabled) | `math.handwriting` config | P3 |
| 25 | Handwriting live preview | Recognised formula shown before inserting | Done (recognised LaTeX shown live and rendered in the preview) | Reuse the preview pane | P3 |
| 26 | Keyboard access to the toolbar | Alt+F10 focuses the toolbar; Tab/Shift+Tab between areas; arrows between tabs and symbols; Space/Enter insert; Esc leaves | Done (Tab/Shift+Tab between areas, Alt+F10 to the toolbar, arrows in the grid, Esc back to the canvas) | Focus cycler over tabs, sections and symbol grid | P1 |
| 27 | Tab shortcuts | Alt+1…0 (Ctrl+1…0 on macOS) open the ten toolbar tabs and focus the first symbol | Done (Alt+1…5) | Keystroke map once the tabbed toolbar exists | P2 |
| 28 | Previous / next tab | Alt+← / Alt+→ (Ctrl on macOS) | Done | Same as #27 | P2 |

## C. Toolbar tabs, templates and symbol palettes

| # | Feature | MathType behaviour | Aveon status | Re-engineering work | Priority |
| --- | --- | --- | --- | --- | --- |
| 29 | Tabbed toolbar shell | 10 tabs with sections, expandable "more" sections, tooltips, hover previews | Done (`MathToolbarView`, 5 tabs, sections, contextual section) | `MathToolbarView` with tabs, sections, collapsible extras; items insert templates into the active slot | P1 |
| 30 | General: fractions and roots | Fraction, square root, nth root | Done | Templates mfrac, msqrt, mroot | P1 |
| 31 | General: scripts | Superscript, subscript, both | Done | Templates msup, msub, msubsup | P1 |
| 32 | General: paired fences | ( ), [ ], { }, \| Done |, ‖ ‖, ⟨ ⟩ | Missing | Fence templates (mfenced or mo pairs) | P1 |
| 33 | General: symbols, editing and formatting actions, special characters | Common symbols; undo/redo/cut/copy/paste buttons; text/bold/italic; special characters | Done (symbols, undo/redo, text mode, thin space) | Items wired to the editor commands | P1 |
| 34 | Arabic notation controls | Right-to-left mathematical notation | Partial (`math.direction: 'rtl'` mirrors the canvas and sets `dir` on the widget and MathML; no mirrored operators) | RTL layout mode for the formula tree and renderer | P3 |
| 35 | Symbols: operators and relations | Operator negation, arithmetic operators, other symbols, equality and approximation, comparison | Done | Symbol catalogue (Unicode + LaTeX + MathML mapping) | P1 |
| 36 | Symbols: sets, logic, geometry | Set notation, logic, geometry, geometric shapes, circled operators | Done | Same catalogue | P2 |
| 37 | Arrows: arrows, dots, dashes | Full arrow set, ellipsis variants, dash variants | Done (Arrows tab: 32 arrows, harpoons, dots) | Same catalogue | P2 |
| 38 | Arrows: labelled arrow templates | Text above and/or below an arrow (xrightarrow style) | Done (labelled arrows `\xrightarrow[below]{above}` and 10 more) | Template with over/under slots on a stretchy arrow | P2 |
| 39 | Arrows: arrow and bar accents | Vector arrow, bar, harpoon accents over expressions | Done | mover templates | P2 |
| 40 | Greek and letter styles | Greek letters, double-struck, Fraktur, script letters | Done | Catalogue with mathvariant | P1 |
| 41 | Specialised letters and numeral systems | ℏ, ℓ, ℵ, ∂, ∞ …; numeral systems | Partial (letter styles incl. sans-serif and monospace; numeral helpers; no full numeral systems) | Catalogue | P2 |
| 42 | Chemical element symbols | Frequent elements on the toolbar; expander shows a periodic table | Done (common elements on the Chemistry tab; expandable 118-element periodic table coloured by category) | Periodic table grid view inserting upright element symbols | P3 |
| 43 | Custom matrix picker | Choose rows × columns, Enter confirms and inserts | Done (rows × columns picker with bracket choice) | Size picker UI; mtable template | P1 |
| 44 | Predefined matrices and dots | Identity, determinants, bracket variants, matrix dots (⋯ ⋮ ⋱) | Done | Templates and symbols | P2 |
| 45 | Piecewise and multiline layouts | Cases with a left brace; multiline equations | Done (cases templates; multiline via tables) | mtable-based templates with fence | P1 |
| 46 | Arithmetic and polynomial layouts | Long division, stacked addition/subtraction/multiplication, polynomial division | Done (stacked addition, subtraction, multiplication, long division and carry templates; `array` with `\hline` per row) | Elementary layout node (rows, lines, carries) | P3 |
| 47 | Fraction variants and roots with index | Bevelled and small fractions, roots with index slot | Done (`\dfrac`, `\tfrac`, `\cfrac`, `\binom`, roots with index; no bevelled fraction) | mfrac variants (`bevelled`, display style), mroot | P2 |
| 48 | Right and left scripts | Sub/sup on the right; pre-scripts on the left (isotopes, tensors) | Done (pre-scripts `{}_{a}^{b}X`) | mmultiscripts template | P2 |
| 49 | Content above/below and brace annotations | Over/under content; overbrace and underbrace with label | Done (`\overset`, `\underset`, overbrace/underbrace with labels) | mover/munder/munderover templates | P2 |
| 50 | Generic big-operator layouts and spacing items | Operator with limits above/below or as scripts; thin/thick/explicit spaces | Done (operator layouts; spacing items from negative thin space to double quad) | munderover templates; mspace items | P2 |
| 51 | Decorations | Fences, bars and braces, accents (hat, tilde, dot, vector), enclosures (box, circle), crossing-out marks | Done (fences incl. one-sided and mixed, bars and braces, 14 accents, box, cancel, bcancel, xcancel, strike-through; no circle enclosure in KaTeX) | menclose and accent templates | P2 |
| 52 | Big operators and calculus | Sum and product templates, large operator symbols; integral templates, derivatives, limits, vector operators (∇, div, curl), named functions (sin, log …) | Done | Templates and a function-name catalogue rendered upright | P1 |

## D. Contextual tab and structure controls

| # | Feature | MathType behaviour | Aveon status | Re-engineering work | Priority |
| --- | --- | --- | --- | --- | --- |
| 53 | Matrix rows and columns | Insert row above/below, column left/right; remove row/column | Done | Commands on mtable nodes; contextual toolbar appears when the caret is in a cell | P1 |
| 54 | Matrix frames and lines | Outer frame on/off; lines below rows and right of columns | Done (frame, row lines, column lines; LaTeX `array` with `|` and `\hline`) | mtable `frame`, `rowlines`, `columnlines` | P2 |
| 55 | Cell and row alignment | Cell contents left/center/right; rows top/center/bottom/baseline/axis | Done (column alignment per table or per column; row alignment in MathML and the canvas) | `columnalign`, `rowalign` | P2 |
| 56 | Decimal align and relation align | Align numbers on the decimal point; align equations on the relation sign | Partial (relation align splits lines at the first relation sign; no decimal align) | Alignment marks (malignmark semantics) in the renderer | P3 |
| 57 | Equal dimensions | Force equal row heights or equal column widths | Done (MathML `equalrows`/`equalcolumns`; canvas preview) | `equalrows`, `equalcolumns` | P3 |
| 58 | Structure spacing | Column spacing right, row spacing below, frame spacing; values like `0.5em`, `px`, `ex` | Done (column and row spacing with px/em/ex validation; MathML and canvas) | `columnspacing`, `rowspacing`, `framespacing` with unit validation | P3 |
| 59 | Baseline position | Baseline, middle or middle-baseline for matrices and fenced structures | Done (MathML `align`; canvas preview) | `align` attribute handling | P3 |
| 60 | Structure alignment | Align with axis, baseline, top, center or bottom | Partial (table `align` only) | Same as #59 | P3 |
| 61 | Fence editing | Change opening delimiter, closing delimiter and separator independently; toggle stretchy | Done (opening and closing delimiters independently; stretchy toggle) | Fence node attributes; contextual dropdowns | P2 |
| 62 | Operator spacing | Left and right spacing for an operator or fence | Partial (space-before item; no lspace/rspace on operators) | `lspace`/`rspace` on mo nodes | P3 |
| 63 | Multiline alignment | Align lines left, center, right or by relation | Partial (multiline via tables with column alignment; no relation align) | mtable column alignment for multiline templates | P2 |
| 64 | Nudge | Move the selected element up/down/left/right (Ctrl+Shift+arrows) | Done (Ctrl+Shift+arrows and contextual buttons; `\raisebox` / `\hspace` in LaTeX, `mpadded` in MathML) | mpadded offsets on the selected node | P3 |
| 65 | Elementary arithmetic controls | Insert line, up-diagonal strike, join digits into one column, prepend/append row, carries at eight positions, move row, digit spacing | Partial (rows and lines via the table controls, carries as left superscripts; no strikes or digit joining) | Elementary layout commands (depends on #46) | P3 |

## E. Formatting and styles

| # | Feature | MathType behaviour | Aveon status | Re-engineering work | Priority |
| --- | --- | --- | --- | --- | --- |
| 66 | Bold and italic | Toggle on selection; element symbols upright, variables italic | Done | `mathvariant` on nodes; LaTeX `\mathbf`, `\mathit`, `\mathrm` | P2 |
| 67 | Colour | Text colour and background colour for selected parts | Done (colour and background pickers; `\textcolor` / `\colorbox`, `mathcolor` / `mathbackground`) | `mathcolor`/`mathbackground`; LaTeX `\textcolor`, `\colorbox` | P2 |
| 68 | Size and display style | Font size for the formula; display vs text style per element | Done (seven sizes and display/text style toggle) | `mathsize`, `displaystyle`; LaTeX `\displaystyle`, `\textstyle` | P2 |
| 69 | Text mode | Upright text inside a formula | Done (text item converts the selection or toggles text mode) | Text item in the toolbar inserting an mtext slot | P2 |
| 70 | Fonts | Font family selection for the formula | Done (sans-serif, monospace, script, fraktur, double-struck letter styles) | `mathvariant` families (sans-serif, monospace) and a CSS font option | P3 |
| 71 | Equation numbering | Automatic numbers with configurable format (Arabic/Roman, case, enclosures, separators, chapter.section) | Done (numbered display equations; automatic numbering in document order; arabic, roman or alpha with a label template; `\tag` in the output) | Numbered display equations: model attribute, counter post-fixer, `\tag` rendering, right-aligned label | P2 |
| 72 | Publishers tab | Equation display mode, element display style, invisible operators (⁢ ⁡ ⁣), number separators, monospace variants, `mspace` width/height/depth | Done (opt-in Publishers tab: display style, invisible operators, number separators, monospace, mspace width) | Optional tab for MathML publishing attributes | P3 |

## F. Output, formats and rendering

| # | Feature | MathType behaviour | Aveon status | Re-engineering work | Priority |
| --- | --- | --- | --- | --- | --- |
| 73 | MathML in content | Saved content contains `<math>` (full MathML mode available) | Done (`math.outputType: 'mathml'`, `<math>` upcast with and without TeX annotation) | `math.outputType: 'mathml'` writing `<math>` with LaTeX annotation; upcast `<math>` | P1 |
| 74 | LaTeX conversion | Copy or convert formulas to LaTeX | Done | – | – |
| 75 | Image rendering | Formulas shown as PNG (or SVG) images with embedded MathML and fonts | Done (`math.outputType: 'image'` writes `<img>` with a self-contained SVG data URI (paths drawn by a lazily loaded MathJax, no fonts), size, baseline, `data-equation`, `alt`; `math.imageRenderer` for a server renderer; read back on load) | Optional `math.outputType: 'image'` producing SVG via a server or client renderer; keep MathML in a data attribute | P3 |
| 76 | Pluggable render engine | Wiris cloud or on-premise rendering service | Done (KaTeX default, custom function, e.g. MathJax) | – | – |
| 77 | Browser MathML fallback | Full MathML mode converts unsupported markup for display | Done (read-only pages: `aveon-math-viewer.js` / `renderEquations()` turns saved equations into native MathML, or SVG images or KaTeX) | – | – |
| 78 | Inline and display equations | Equation display mode in the Publishers tab | Done | – | – |
| 79 | Live preview while editing | Editing area shows the formula as it is built | Done | Keep the preview as the WYSIWYG canvas (#3) | – |
| 80 | Export as image | Copy equation as EPS/SVG/PNG into other software | Partial (PDF, Word and HTML exports draw equations as SVG or PNG images; `renderEquationSvg()`, `svgToPng()`, `replaceEquationsWithImages()`; no "Copy as image" button, no EPS) | "Copy as SVG/PNG" actions in the widget toolbar | P3 |
| 81 | Round-trip of input formats | MathML in, MathML out, LaTeX accepted | Done (span, script, `$…$`, `$$…$$`, MathML, MathType `data-mathml` images, Word equations pasted as Office Math) | Add MathML with #73 | – |
| 82 | Rendering performance | Service-side caching of rendered formulas | Done (KaTeX output cached per equation) | Cache rendered DOM per equation string; lazy render off-screen formulas | P2 |

## G. Accessibility and localisation

| # | Feature | MathType behaviour | Aveon status | Re-engineering work | Priority |
| --- | --- | --- | --- | --- | --- |
| 83 | Automatic alt text | Spoken description generated from the formula ("square root of x", "1 half") stored in `alt` | Done (English, `getSpeechText()`) | Speech-text generator from the formula tree (MathSpeak/ClearSpeak-style rules) | P1 |
| 84 | Alt text languages | ar, ca, zh, en, fr, de, it, ja, no, nn, pt, pt_br, es; follows the application language | Done (English, Spanish, French, German built in; `addSpeechDictionary()` registers more; follows the content language or `math.speechLanguage`) | Localised rule sets; `language.content` drives the output | P3 |
| 85 | ARIA role and label | Images carry `role="math"` and the description | Done (`role="math"` and `aria-label` on the widget and the span output; `alttext` on MathML output) | `role="math"`, `aria-label` from #83 on the widget and the output | P1 |
| 86 | Screen reader structure | Advanced readers read the MathML directly | Done (MathML output carries the structure; the editing view keeps KaTeX MathML) | Ship MathML in data output (#73) | P2 |
| 87 | WCAG 2.x keyboard operability | Entire editor usable from the keyboard | Partial (dialog, toolbar and canvas keyboard operable; no screen reader announcements of caret moves yet) | Covered by #26–#28 and focus management of the dialog | P1 |
| 88 | UI translations | Editor and toolbar localised in the host language | Partial (every dialog and toolbar string goes through `locale.t()`; ship dictionaries via the `translations` config) | Translation files through `locale.t()` | P2 |
| 89 | High contrast and zoom | Toolbar and formulas remain legible when zoomed or in high-contrast mode | Done (`forced-colors` styles for the canvas, toolbar and handwriting surface) | Audit colours and focus outlines; `forced-colors` support | P3 |
| 90 | Cultural notation conventions | Notation adapts to local conventions (e.g. decimal comma) | Partial (`math.decimalSeparator: ','` types `{,}` and speaks "comma"; no other conventions) | Locale-aware number formatting and symbol defaults | P3 |

## H. Chemistry (ChemType)

| # | Feature | MathType behaviour | Aveon status | Re-engineering work | Priority |
| --- | --- | --- | --- | --- | --- |
| 91 | Chemistry mode | Separate ChemType toolbar button; chemistry toolbar with the standard tabs still available | Done (`chemType` toolbar button; Chemistry tab; chemistry typing mode) | `chemistry` toolbar preset and a `chemType` toolbar item | P3 |
| 92 | Upright element symbols | Element symbols automatically upright, variables italic | Done (letters typed in chemistry mode become upright `\mathrm{}` tokens; two-letter symbols merge) | Element recognition → `\mathrm` / `mathvariant="normal"` | P3 |
| 93 | Chemistry toolbar items | Subscripts, states of matter (s, l, g, aq), reaction arrows, equilibrium arrows, precipitate/gas arrows | Done (subscripts, charges, states of matter, reaction and equilibrium arrows, precipitate and gas arrows, bonds, heat, electron) | Templates and symbols (mhchem-compatible LaTeX output) | P3 |
| 94 | Charges, isotopes, oxidation states | Superscript charges, pre-script mass/atomic numbers | Done (charge templates and isotope pre-scripts) | mmultiscripts templates | P3 |
| 95 | Periodic table picker | Expander with the full periodic table | Done | Same as #42 | P3 |
| 96 | Chemistry enable flag | `wirischemeditorenabled` turns ChemType on/off per integration | Done (`math.chemistry.enabled`) | `math.chemistry.enabled` option | P3 |

## I. Integration, configuration and platforms

| # | Feature | MathType behaviour | Aveon status | Re-engineering work | Priority |
| --- | --- | --- | --- | --- | --- |
| 97 | Toolbar customisation | XML definition: presets (general, quizzes, chemistry, evaluate, PARCC grade bands, prototype), add/remove tabs, sections and items, custom buttons with MathML content and cursor offset, `removeLinks` | Done (`math.toolbar`: tab order, removed tabs and items, custom LaTeX buttons with slot focus; `math.colors`) | JSON toolbar definition (`math.toolbar`) with presets, tab/section/item refs and `createButton` with template + offset | P2 |
| 98 | Editor parameters | `editorParameters`: language, toolbar, autoformat on/off, read-only; `mathTypeParameters` for services | Done (`engine`, `outputType`, `katexOptions`, `altText`, `defaultMode`, `autoformat`, `toolbar`, `colors`, `numbering`) | Extend `MathConfig` with `language`, `toolbar`, `autoformat`, `defaultMode`, `handwriting`, `chemistry` | P2 |
| 99 | Services deployment | Cloud or on-premise Java/PHP/.NET/Ruby services for rendering, alt text and handwriting | Partial (client-side only: KaTeX rendering, built-in speech and handwriting; service hooks via `math.engine`, `math.imageRenderer` and `math.handwriting.recognizer`) | Optional service adapters for image rendering (#75) and handwriting (#22) | P3 |
| 100 | Host integrations | CKEditor, TinyMCE, Froala, generic HTML, Word, PowerPoint, Google Docs/Slides, WPS, Moodle, Canvas, Blackboard, Brightspace, Schoology | Partial (Aveon classic/inline/balloon/decoupled editors and the Angular wrapper) | Out of scope for office suites; the generic plugin shape allows other hosts later | – |

## Proposed architecture for the re-engineering

1. **Formula model** (`features/math/model`): a tree of typed nodes mirroring MathML presentation elements, with slots, attributes (mathvariant, mathcolor, mathsize, table attributes) and a position/range model. Serialisers: to LaTeX (for KaTeX), to MathML (for storage and accessibility), to speech text (alt). Parsers: from LaTeX (subset), from MathML.
2. **Formula editing surface** (`features/math/ui/canvas`): renders the tree to DOM slots, owns the caret, selection, keyboard handling (#3–#8, #15–#21), smart delete and nudge. KaTeX stays the display renderer for the document; the canvas uses its own slot renderer so every node is addressable.
3. **Tabbed toolbar** (`features/math/ui/toolbar`): tabs → sections → items from a JSON catalogue; presets and customisation (#29–#52, #97); contextual tab driven by the node under the caret (#53–#65).
4. **Dialog** (`features/math/ui/dialog`): classic and handwriting modes, LaTeX and MathML code tabs, insert/update, keyboard navigation (#11–#14, #26–#28).
5. **Output pipeline**: `outputType` of `span`, `script`, `mathml` or `image`; alt text and `role="math"` on every output (#73–#75, #83–#86).
6. **Chemistry preset** on top of the same model (#91–#96).

Suggested order: Phase 1 = A + B (keyboard parts) + C (General, Symbols, Greek, Matrices, Big operators/Calculus) + MathML output + alt text. Phase 2 = remaining tabs, contextual tab, formatting, numbering, toolbar customisation, translations. Phase 3 = handwriting, chemistry, image export, publishers tab, RTL notation.

## Sources

- https://www.wiris.com/en/
- https://www.wiris.com/en/mathtype/
- https://www.wiris.com/en/mathtype/html-editors/
- https://www.wiris.com/en/mathtype/office-tools/
- https://docs.wiris.com/en_US/toolbar-and-icons
- https://docs.wiris.com/contextual-tab-category/contextual-tab
- https://docs.wiris.com/using-mathtype-web/toolbar-and-keyboard-shorcuts
- https://docs.wiris.com/mathtype/en/mathtype-integrations/mathtype-web-interface-features/accessibility.html
- https://docs.wiris.com/en_US/chemistry
- https://docs.wiris.com/en_US/custom-toolbar
- https://docs.wiris.com/html-editors-reference/toolbar-xml-reference
- https://docs.wiris.com/html-editors-reference/mathtype-hand-parameters
- https://ckeditor.com/docs/ckeditor5/latest/features/math-equations.html
