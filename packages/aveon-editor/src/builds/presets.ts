import type { PluginConstructor } from '../core/plugin';
import type { EditorConfig } from '../core/editor';
import { Essentials } from '../features/essentials/essentials';
import { Paragraph } from '../features/paragraph/paragraph';
import { Heading } from '../features/heading/heading';
import { Bold, Italic, Underline, Strikethrough, Code, Subscript, Superscript } from '../features/basicstyles/basicstyles';
import { Link } from '../features/link/link';
import { List, TodoList } from '../features/list/list';
import { BlockQuote } from '../features/blockquote/blockquote';
import { Image, ImageCaption, ImageStyle, ImageToolbar, ImageUpload, ImageInsert, ImageResize, Base64UploadAdapter } from '../features/image/image';
import { Table, TableToolbar } from '../features/table/table';
import { Alignment } from '../features/alignment/alignment';
import { Indent, IndentBlock } from '../features/indent/indent';
import { Font } from '../features/font/font';
import { HorizontalLine } from '../features/horizontalline/horizontalline';
import { CodeBlock } from '../features/codeblock/codeblock';
import { RemoveFormat } from '../features/removeformat/removeformat';
import { Highlight } from '../features/highlight/highlight';
import { Autoformat } from '../features/autoformat/autoformat';
import { SourceEditing } from '../features/sourceediting/sourceediting';
import { MediaEmbed } from '../features/mediaembed/mediaembed';
import { SpecialCharacters } from '../features/specialcharacters/specialcharacters';
import { FindAndReplace } from '../features/findandreplace/findandreplace';
import { TextTransformation } from '../features/texttransformation/texttransformation';
import { WordCount } from '../features/wordcount/wordcount';
import { Math } from '../features/math/math';
import { WordBasics } from '../features/wordbasics/wordbasics';
import { MergeFields } from '../features/mergefields/mergefields';
import { Templates } from '../features/templates/templates';
import { ExportDocument } from '../features/export/export';
import { References } from '../features/references/references';
import { Sketch } from '../features/sketch/sketch';
import { Diagrams } from '../features/diagrams/diagrams';
import { Markdown } from '../features/markdown/markdown';
import { Comments } from '../features/comments/comments';
import { TrackChanges } from '../features/trackchanges/trackchanges';
import { RealTimeCollaboration } from '../features/collaboration/collaboration';
import type { RibbonConfig, RibbonTabConfig } from '../ui/ribbon/ribbonview';

/** Plugins matching the CKEditor 5 classic build, plus the commonly requested extras. */
export const classicPreset: PluginConstructor[] = [
  Essentials,
  Paragraph,
  Heading,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code,
  Subscript,
  Superscript,
  Link,
  List,
  TodoList,
  BlockQuote,
  Image,
  ImageCaption,
  ImageStyle,
  ImageToolbar,
  ImageUpload,
  ImageInsert,
  ImageResize,
  Base64UploadAdapter,
  Table,
  TableToolbar,
  Alignment,
  Indent,
  IndentBlock,
  Font,
  HorizontalLine,
  CodeBlock,
  RemoveFormat,
  Highlight,
  Autoformat,
  SourceEditing,
  MediaEmbed,
  SpecialCharacters,
  FindAndReplace,
  TextTransformation,
  WordCount,
  Math,
  WordBasics,
  MergeFields,
  Templates,
  ExportDocument,
  References,
  Sketch,
  Diagrams,
  Markdown,
  Comments,
  TrackChanges,
  RealTimeCollaboration
];

/** Toolbar matching the CKEditor 5 classic build defaults, extended with the extra features. */
export const classicToolbar: string[] = [
  'undo',
  'redo',
  '|',
  'heading',
  '|',
  'fontFamily',
  'fontSize',
  'fontColor',
  'fontBackgroundColor',
  '|',
  'bold',
  'italic',
  'underline',
  'strikethrough',
  'subscript',
  'superscript',
  'code',
  'removeFormat',
  '|',
  'link',
  'insertImage',
  'mediaEmbed',
  'insertTable',
  'blockQuote',
  'codeBlock',
  'horizontalLine',
  'specialCharacters',
  'insertDiagram',
  'math',
  'chemType',
  '|',
  'alignment',
  'bulletedList',
  'numberedList',
  'todoList',
  'outdent',
  'indent',
  '|',
  'highlight',
  'findAndReplace',
  'sourceEditing'
];

/** Word-style ribbon: everyday tools on Home, everything you can add on Insert. */
/** Contextual tab shown while the cursor is in a table (like Word's Table Layout tab). */
export const tableContextTab: RibbonTabConfig = {
  label: 'Table',
  contextual: 'table',
  groups: [
    {
      label: 'Rows & Columns',
      items: [
        { name: 'tableRow', size: 'large', label: 'Rows' },
        { name: 'tableColumn', size: 'large', label: 'Columns' }
      ]
    },
    { label: 'Caption', items: [{ name: 'tableCaption', size: 'large', label: 'Caption' }] }
  ]
};

/** Contextual tab shown while a picture is selected (like Word's Picture Format tab). */
export const pictureContextTab: RibbonTabConfig = {
  label: 'Picture',
  contextual: 'image',
  groups: [
    {
      label: 'Accessibility',
      items: [
        { name: 'imageTextAlternative', size: 'large', label: 'Alt Text' },
        { name: 'toggleImageCaption', size: 'medium', label: 'Caption' }
      ]
    },
    {
      label: 'Wrap Text',
      items: [
        { name: 'imageStyle:inline', size: 'medium', label: 'In line' },
        { name: 'imageStyle:block', size: 'medium', label: 'Centered' },
        { name: 'imageStyle:side', size: 'medium', label: 'Side' }
      ]
    },
    { label: 'Size', items: [{ name: 'resizeImage', size: 'large', label: 'Size' }] }
  ]
};

export const classicRibbon: RibbonConfig = {
  quickAccess: ['undo', 'redo', 'collaborators'],
  tabs: [
    {
      label: 'Home',
      groups: [
        {
          label: 'Clipboard',
          items: [
            { name: 'paste', size: 'large' },
            { name: 'cut', size: 'medium' },
            { name: 'copy', size: 'medium' },
            { name: 'formatPainter', size: 'medium', label: 'Format' }
          ]
        },
        {
          label: 'Font',
          items: [{ name: 'fontFamily', size: 'combo' }, { name: 'fontSize', size: 'combo' }, 'fontSizeIncrease', 'fontSizeDecrease', 'changeCase', 'removeFormat', '-', 'bold', 'italic', 'underline', 'strikethrough', 'subscript', 'superscript', '|', 'fontColor', 'fontBackgroundColor', 'highlight'],
          launcher: { command: 'fontDialog', label: 'Font options' }
        },
        { label: 'Paragraph', items: ['bulletedList', 'numberedList', 'todoList', 'outdent', 'indent', '-', 'alignment', 'blockQuote', 'codeBlock', 'horizontalLine'] },
        { label: 'Styles', items: ['styleGallery'] },
        {
          label: 'Editing',
          items: [
            { name: 'findAndReplace', size: 'medium', label: 'Find' },
            { name: 'selectAll', size: 'medium', label: 'Select all' }
          ]
        }
      ]
    },
    {
      label: 'Insert',
      groups: [
        { label: 'Tables', items: [{ name: 'insertTable', size: 'large', label: 'Table' }] },
        {
          label: 'Illustrations',
          items: [
            { name: 'insertImage', size: 'large', label: 'Pictures' },
            { name: 'mediaEmbed', size: 'medium', label: 'Video' },
            { name: 'horizontalLine', size: 'medium', label: 'Line' },
            { name: 'insertSketch', size: 'medium', label: 'Sketch' },
            { name: 'insertDiagram', size: 'medium', label: 'Diagram' }
          ]
        },
        { label: 'Links', items: [{ name: 'link', size: 'large', label: 'Link' }] },
        {
          label: 'Text',
          items: [
            { name: 'blockQuote', size: 'medium', label: 'Quote' },
            { name: 'codeBlock', size: 'medium', label: 'Code' },
            { name: 'code', size: 'medium', label: 'Inline code' },
            { name: 'importMarkdown', size: 'medium', label: 'Markdown' }
          ]
        },
        {
          label: 'Symbols',
          items: [
            { name: 'math', size: 'large', label: 'Equation' },
            { name: 'specialCharacters', size: 'large', label: 'Symbol' },
            { name: 'chemType', size: 'medium', label: 'Chemistry' }
          ]
        }
      ]
    },
    {
      label: 'Layout',
      groups: [
        { label: 'Alignment', items: [{ name: 'alignment', size: 'large', label: 'Align' }] },
        {
          label: 'Indent',
          items: [
            { name: 'outdent', size: 'medium', label: 'Decrease' },
            { name: 'indent', size: 'medium', label: 'Increase' }
          ]
        },
        {
          label: 'Lists',
          items: [
            { name: 'bulletedList', size: 'medium', label: 'Bullets' },
            { name: 'numberedList', size: 'medium', label: 'Numbering' },
            { name: 'todoList', size: 'medium', label: 'Checklist' }
          ]
        }
      ]
    },
    {
      label: 'References',
      groups: [
        { label: 'Table of Contents', items: [{ name: 'tableOfContents', size: 'large', label: 'Table of Contents' }] },
        { label: 'Footnotes', items: [{ name: 'insertFootnote', size: 'large', label: 'Insert Footnote' }] },
        { label: 'Captions', items: [{ name: 'tableCaption', size: 'large', label: 'Insert Caption' }] }
      ]
    },
    {
      label: 'Mailings',
      groups: [
        {
          label: 'Fields',
          items: [
            { name: 'mergeFields', size: 'large', label: 'Insert Merge Field' },
            { name: 'mergeFieldsPreview', size: 'large', label: 'Preview Results' }
          ]
        },
        { label: 'Templates', items: [{ name: 'insertTemplate', size: 'large', label: 'Templates' }] }
      ]
    },
    {
      label: 'Review',
      groups: [
        {
          label: 'Comments',
          items: [
            { name: 'addComment', size: 'large', label: 'New Comment' },
            { name: 'toggleComments', size: 'medium', label: 'Show Comments' }
          ]
        },
        {
          label: 'Tracking',
          items: [
            { name: 'trackChanges', size: 'large', label: 'Track Changes' },
            { name: 'acceptSuggestion', size: 'medium', label: 'Accept' },
            { name: 'rejectSuggestion', size: 'medium', label: 'Reject' },
            { name: 'acceptAllSuggestions', size: 'medium', label: 'Accept all' },
            { name: 'rejectAllSuggestions', size: 'medium', label: 'Reject all' }
          ]
        },
        { label: 'Find', items: [{ name: 'findAndReplace', size: 'large', label: 'Find' }] },
        {
          label: 'Formatting',
          items: [
            { name: 'removeFormat', size: 'medium', label: 'Clear formatting' },
            { name: 'formatPainter', size: 'medium', label: 'Format Painter' }
          ]
        }
      ]
    },
    {
      label: 'View',
      groups: [
        { label: 'Views', items: [{ name: 'fullscreen', size: 'large' }] },
        { label: 'Source', items: [{ name: 'sourceEditing', size: 'large', label: 'HTML source' }] },
        {
          label: 'Export',
          items: [
            { name: 'exportPdf', size: 'large', label: 'PDF' },
            { name: 'exportWord', size: 'large', label: 'Word' },
            { name: 'exportHtml', size: 'medium', label: 'HTML' },
            { name: 'exportMarkdown', size: 'medium', label: 'Markdown' }
          ]
        }
      ]
    },
    tableContextTab,
    pictureContextTab
  ]
};

export const classicDefaultConfig: EditorConfig = {
  toolbar: classicToolbar,
  ribbon: classicRibbon,
  image: {
    toolbar: ['imageTextAlternative', 'toggleImageCaption', '|', 'imageStyle:inline', 'imageStyle:block', 'imageStyle:side', '|', 'resizeImage']
  },
  table: {
    contentToolbar: ['tableColumn', 'tableRow']
  }
};
