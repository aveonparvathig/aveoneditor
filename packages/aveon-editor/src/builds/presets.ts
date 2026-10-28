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
import type { RibbonConfig } from '../ui/ribbon/ribbonview';

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
  WordBasics
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
export const classicRibbon: RibbonConfig = {
  quickAccess: ['undo', 'redo'],
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
          items: ['fontFamily', 'fontSize', 'fontSizeIncrease', 'fontSizeDecrease', 'changeCase', 'removeFormat', '-', 'bold', 'italic', 'underline', 'strikethrough', 'subscript', 'superscript', '|', 'fontColor', 'fontBackgroundColor', 'highlight'],
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
            { name: 'horizontalLine', size: 'medium', label: 'Line' }
          ]
        },
        { label: 'Links', items: [{ name: 'link', size: 'large', label: 'Link' }] },
        {
          label: 'Text',
          items: [
            { name: 'blockQuote', size: 'medium', label: 'Quote' },
            { name: 'codeBlock', size: 'medium', label: 'Code' },
            { name: 'code', size: 'medium', label: 'Inline code' }
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
      label: 'Review',
      groups: [
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
        { label: 'Source', items: [{ name: 'sourceEditing', size: 'large', label: 'HTML source' }] }
      ]
    }
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
