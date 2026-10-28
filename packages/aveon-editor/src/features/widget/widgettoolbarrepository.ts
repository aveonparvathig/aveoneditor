import { Plugin } from '../../core/plugin';
import { ContextualBalloon } from '../../ui/panel/contextualballoon';
import { ToolbarView } from '../../ui/toolbar/toolbarview';
import { BalloonPanelView } from '../../ui/panel/balloonpanelview';
import type { Editor } from '../../core/editor';
import type { Element as ViewElement } from '../../engine/view/element';
import type { DocumentSelection as ViewDocumentSelection } from '../../engine/view/documentselection';

interface WidgetToolbarDefinition {
  view: ToolbarView;
  getRelatedElement: (selection: ViewDocumentSelection) => ViewElement | null;
  balloonClassName: string;
  itemsConfig: string[];
}

/** Shows contextual toolbars (image, table) in a balloon when the related widget is selected. */
export class WidgetToolbarRepository extends Plugin {
  private _toolbarDefinitions = new Map<string, WidgetToolbarDefinition>();
  private _balloon!: ContextualBalloon;

  public static override get requires() {
    return [ContextualBalloon];
  }

  public static override get pluginName(): string {
    return 'WidgetToolbarRepository';
  }

  public override init(): void {
    const editor = this.editor;
    this._balloon = editor.plugins.get(ContextualBalloon) as ContextualBalloon;
    this.on('change:isEnabled', () => this._updateToolbarsVisibility());
    this.listenTo(editor.ui, 'update', () => this._updateToolbarsVisibility());
    this.listenTo(editor.ui.focusTracker, 'change:isFocused', () => this._updateToolbarsVisibility(), { priority: 'low' });
  }

  public override destroy(): void {
    super.destroy();
    for (const toolbarConfig of this._toolbarDefinitions.values()) {
      toolbarConfig.view.destroy();
    }
  }

  public register(toolbarId: string, { ariaLabel, items, getRelatedElement, balloonClassName = 'ck-toolbar-container' }: { ariaLabel?: string; items: string[]; getRelatedElement: (selection: ViewDocumentSelection) => ViewElement | null; balloonClassName?: string }): void {
    const editor = this.editor;
    const t = editor.t;
    const toolbarView = new ToolbarView(editor.locale);
    toolbarView.ariaLabel = ariaLabel || t('Widget toolbar');
    if (this._toolbarDefinitions.has(toolbarId)) {
      throw new Error('widget-toolbar-duplicated: Toolbar with the given id was already added.');
    }
    toolbarView.fillFromConfig(items, editor.ui.componentFactory);
    this._toolbarDefinitions.set(toolbarId, { view: toolbarView, getRelatedElement, balloonClassName, itemsConfig: items });
  }

  private _updateToolbarsVisibility(): void {
    let maxRelatedElementDepth = 0;
    let deepestRelatedElement: ViewElement | null = null;
    let deepestToolbarDefinition: WidgetToolbarDefinition | null = null;
    for (const definition of this._toolbarDefinitions.values()) {
      const relatedElement = definition.getRelatedElement(this.editor.editing.view.document.selection);
      if (!this.isEnabled || !relatedElement) {
        if (this._isToolbarInBalloon(definition)) {
          this._hideToolbar(definition);
        }
      } else if (!this.editor.ui.focusTracker.isFocused) {
        if (this._isToolbarVisible(definition)) {
          this._hideToolbar(definition);
        }
      } else {
        const relatedElementDepth = relatedElement.getAncestors().length;
        if (relatedElementDepth > maxRelatedElementDepth) {
          maxRelatedElementDepth = relatedElementDepth;
          deepestRelatedElement = relatedElement;
          deepestToolbarDefinition = definition;
        }
      }
    }
    if (deepestToolbarDefinition) {
      this._showToolbar(deepestToolbarDefinition, deepestRelatedElement!);
    }
  }

  private _hideToolbar(toolbarDefinition: WidgetToolbarDefinition): void {
    this._balloon.remove(toolbarDefinition.view);
    this.stopListening(this._balloon, 'change:visibleView');
  }

  private _showToolbar(toolbarDefinition: WidgetToolbarDefinition, relatedElement: ViewElement): void {
    if (this._isToolbarVisible(toolbarDefinition)) {
      repositionContextualBalloon(this.editor, relatedElement);
    } else if (!this._isToolbarInBalloon(toolbarDefinition)) {
      this._balloon.add({
        view: toolbarDefinition.view,
        position: getBalloonPositionData(this.editor, relatedElement),
        balloonClassName: toolbarDefinition.balloonClassName
      });
      this.listenTo(this._balloon, 'change:visibleView', () => {
        for (const definition of this._toolbarDefinitions.values()) {
          if (this._isToolbarVisible(definition)) {
            const relatedElement = definition.getRelatedElement(this.editor.editing.view.document.selection);
            if (relatedElement) repositionContextualBalloon(this.editor, relatedElement);
          }
        }
      });
    }
  }

  private _isToolbarVisible(toolbar: WidgetToolbarDefinition): boolean {
    return this._balloon.visibleView === toolbar.view;
  }

  private _isToolbarInBalloon(toolbar: WidgetToolbarDefinition): boolean {
    return this._balloon.hasView(toolbar.view);
  }
}

function repositionContextualBalloon(editor: Editor, relatedElement: ViewElement): void {
  const balloon = editor.plugins.get(ContextualBalloon) as ContextualBalloon;
  const position = getBalloonPositionData(editor, relatedElement);
  balloon.updatePosition(position);
}

function getBalloonPositionData(editor: Editor, relatedElement: ViewElement) {
  const editingView = editor.editing.view;
  const defaultPositions = BalloonPanelView.defaultPositions;
  return {
    target: editingView.domConverter.mapViewToDom(relatedElement) as HTMLElement,
    positions: [
      defaultPositions.northArrowSouth,
      defaultPositions.northArrowSouthWest,
      defaultPositions.northArrowSouthEast,
      defaultPositions.southArrowNorth,
      defaultPositions.southArrowNorthWest,
      defaultPositions.southArrowNorthEast,
      defaultPositions.viewportStickyNorth
    ]
  };
}
