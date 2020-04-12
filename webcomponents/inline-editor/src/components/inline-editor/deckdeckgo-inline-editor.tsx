import {Component, Element, EventEmitter, Listen, Prop, State, Watch, Event, Method, h, Host} from '@stencil/core';

import {isMobile, isIOS, unifyEvent, debounce} from '@deckdeckgo/utils';

import '@deckdeckgo/color';
import {DeckdeckgoPalette, DEFAULT_PALETTE} from '@deckdeckgo/color';

import {ToolbarActions, ContentAlign} from '../../types/enums';
import {AnchorLink, InlineAction} from '../../interfaces/interfaces';

import {DeckdeckgoInlineEditorUtils} from '../../utils/utils';

@Component({
  tag: 'deckgo-inline-editor',
  styleUrl: 'deckdeckgo-inline-editor.scss',
  shadow: true
})
export class DeckdeckgoInlineEditor {
  @Element() el: HTMLElement;

  @Prop() palette: DeckdeckgoPalette[] = DEFAULT_PALETTE;

  @State()
  private bold: boolean = false;

  @State()
  private italic: boolean = false;

  @State()
  private underline: boolean = false;

  @State()
  private contentAlign: ContentAlign = ContentAlign.LEFT;

  @State()
  private orderedList: boolean = false;

  @State()
  private unorderedList: boolean = false;

  @State()
  private color: string;

  @State()
  private disabledTitle: boolean = false;

  @Prop({mutable: true})
  mobile: boolean = false;

  @Prop()
  stickyDesktop: boolean = false;

  @Prop()
  stickyMobile: boolean = false;

  @State()
  private toolsActivated: boolean = false;

  @State()
  private displayToolsActivated: boolean = false;

  private debounceDisplayToolsActivated: Function;

  private selection: Selection = null;

  private anchorLink: AnchorLink = null;
  private anchorEvent: MouseEvent | TouchEvent;

  @State()
  private link: boolean = false;

  @State()
  private toolbarActions: ToolbarActions = ToolbarActions.SELECTION;

  @Event() stickyToolbarActivated: EventEmitter<boolean>;

  @Prop()
  attachTo: HTMLElement;

  @Prop()
  containers: string = 'h1,h2,h3,h4,h5,h6,div';

  @Event() private imgDidChange: EventEmitter<HTMLElement>;

  @Event() private linkCreated: EventEmitter<HTMLElement>;

  @Prop()
  imgAnchor: string = 'img';

  @Prop()
  imgPropertyWidth: string = 'width';

  @Prop()
  imgPropertyCssFloat: string = 'float';

  private iOSTimerScroll: number;

  @Prop()
  imgEditable: boolean = false;

  @Prop()
  list: boolean = true;

  @Prop()
  customActions: string; // Comma separated list of additional action components

  @Event()
  customAction: EventEmitter<InlineAction>;

  constructor() {
    this.resetDisplayToolsActivated();
  }

  private resetDisplayToolsActivated() {
    this.debounceDisplayToolsActivated = debounce(() => {
      this.displayToolsActivated = true;
    });
  }

  async componentWillLoad() {
    await this.attachListener();
  }

  async componentDidLoad() {
    if (!this.mobile) {
      this.mobile = isMobile();
    }
  }

  async componentDidUnload() {
    await this.detachListener(this.attachTo ? this.attachTo : document);
  }

  @Watch('attachTo')
  async onAttachTo() {
    if (!this.attachTo) {
      return;
    }

    await this.detachListener(document);
    await this.attachListener();
  }

  private attachListener(): Promise<void> {
    return new Promise<void>((resolve) => {
      const listenerElement: HTMLElement | Document = this.attachTo ? this.attachTo : document;
      if (listenerElement) {
        listenerElement.addEventListener('mousedown', this.startSelection, {passive: true});
        listenerElement.addEventListener('touchstart', this.startSelection, {passive: true});
      }

      resolve();
    });
  }

  private detachListener(listenerElement: HTMLElement | Document): Promise<void> {
    return new Promise<void>((resolve) => {
      if (listenerElement) {
        listenerElement.removeEventListener('mousedown', this.startSelection);
        listenerElement.removeEventListener('touchstart', this.startSelection);
      }

      resolve();
    });
  }

  private startSelection = async ($event: MouseEvent | TouchEvent) => {
    if (this.displayToolsActivated) {
      return;
    }

    if (this.toolbarActions !== ToolbarActions.IMAGE) {
      this.anchorEvent = $event;
    }

    if (this.toolsActivated) {
      await this.resetImageToolbarActions($event);

      return;
    }

    if (this.toolbarActions === ToolbarActions.IMAGE) {
      this.anchorEvent = $event;
    }

    await this.displayImageActions($event);
  };

  private resetImageToolbarActions($event: MouseEvent | TouchEvent): Promise<void> {
    return new Promise<void>(async (resolve) => {
      if (this.toolbarActions !== ToolbarActions.IMAGE) {
        resolve();
        return;
      }

      if ($event && $event.target && $event.target instanceof HTMLElement) {
        const target: HTMLElement = $event.target as HTMLElement;

        if (target && target.nodeName && target.nodeName.toLowerCase() !== 'deckgo-inline-editor') {
          await this.reset(false);
        }
      }

      resolve();
    });
  }

  private displayImageActions($event: MouseEvent | TouchEvent): Promise<void> {
    return new Promise<void>(async (resolve) => {
      if (!this.imgEditable) {
        resolve();
        return;
      }

      const isAnchorImg: boolean = await this.isAnchorImage();
      if (!isAnchorImg) {
        resolve();
        return;
      }

      $event.stopImmediatePropagation();

      await this.reset(true);

      setTimeout(async () => {
        await this.activateToolbarImage();
        await this.setToolbarAnchorPosition();
      }, 100);

      resolve();
    });
  }

  private activateToolbarImage(): Promise<void> {
    return new Promise<void>(async (resolve) => {
      this.toolbarActions = ToolbarActions.IMAGE;
      this.color = undefined;
      await this.setToolsActivated(true);

      resolve();
    });
  }

  private isAnchorImage(): Promise<boolean> {
    return DeckdeckgoInlineEditorUtils.isAnchorImage(this.anchorEvent, this.imgAnchor);
  }

  @Listen('selectionchange', {target: 'document', passive: true})
  async selectionchange(_$event: UIEvent) {
    if (document && document.activeElement && !this.isContainer(document.activeElement)) {
      if (document.activeElement.nodeName.toLowerCase() !== 'deckgo-inline-editor') {
        await this.reset(false);
      }

      return;
    }

    if (this.toolbarActions === ToolbarActions.IMAGE && this.isAnchorImage()) {
      await this.reset(false);
      return;
    }

    await this.displayTools();
  }

  private displayTools(): Promise<void> {
    return new Promise<void>(async (resolve) => {
      const selection: Selection = await this.getSelection();

      if (!this.anchorEvent) {
        await this.reset(false);
        resolve();
        return;
      }

      if (this.attachTo && !this.attachTo.contains(this.anchorEvent.target as Node)) {
        await this.reset(false);
        resolve();
        return;
      }

      if (!selection || !selection.toString() || selection.toString().trim().length <= 0) {
        await this.reset(false);
        resolve();
        return;
      }

      const activated: boolean = await this.activateToolbar(selection);
      await this.setToolsActivated(activated);

      if (this.toolsActivated) {
        this.selection = selection;

        if (selection.rangeCount > 0) {
          const range: Range = selection.getRangeAt(0);
          this.anchorLink = {
            range: range,
            text: selection.toString(),
            element: document.activeElement
          };

          await this.setToolbarAnchorPosition();
        }
      }

      resolve();
    });
  }

  private setToolbarAnchorPosition(): Promise<void> {
    return new Promise<void>(async (resolve) => {
      if (this.isSticky()) {
        await this.handlePositionIOS();

        resolve();
        return;
      }

      const tools: HTMLElement = this.el.shadowRoot.querySelector('div.deckgo-tools');

      if (tools) {
        let top: number = unifyEvent(this.anchorEvent).clientY;
        let left: number = unifyEvent(this.anchorEvent).clientX;

        if (this.mobile) {
          top = top + 40;
        } else {
          top = top + 10;
        }

        const innerWidth: number = isIOS() ? screen.width : window.innerWidth;

        if (innerWidth > 0 && left > innerWidth - tools.offsetWidth) {
          left = innerWidth - tools.offsetWidth;
        }

        tools.style.top = '' + top + 'px';
        tools.style.left = '' + left + 'px';
      }

      resolve();
    });
  }

  private handlePositionIOS(): Promise<void> {
    return new Promise<void>(async (resolve) => {
      if (!isIOS() || !this.anchorEvent) {
        resolve();
        return;
      }

      await this.setStickyPositionIOS();

      if (window) {
        window.addEventListener(
          'scroll',
          async () => {
            await this.setStickyPositionIOS();
          },
          {passive: true}
        );
        window.addEventListener(
          'resize',
          async () => {
            await this.reset(true, true);
          },
          {passive: true}
        );
      }
    });
  }

  private setStickyPositionIOS(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!this.stickyMobile || !isIOS() || !window) {
        resolve();
        return;
      }

      if (this.iOSTimerScroll > 0) {
        clearTimeout(this.iOSTimerScroll);
      }

      this.iOSTimerScroll = setTimeout(() => {
        this.el.style.setProperty('--deckgo-inline-editor-sticky-scroll', `${window.scrollY}px`);
      }, 50);

      resolve();
    });
  }

  private activateToolbar(selection: Selection): Promise<boolean> {
    return new Promise<boolean>(async (resolve) => {
      const tools: boolean = selection && selection.toString() && selection.toString().length > 0;

      if (tools) {
        const promises = [];

        promises.push(this.initStyle(selection));
        promises.push(this.initLink(selection));

        await Promise.all(promises);
      }

      resolve(tools);
    });
  }

  private initStyle(selection: Selection): Promise<void> {
    return new Promise<void>(async (resolve) => {
      if (!selection || selection.rangeCount <= 0) {
        resolve();
        return;
      }

      const content: Node = selection.anchorNode;

      if (!content) {
        resolve();
        return;
      }

      if (this.isContainer(content)) {
        this.bold = false;
        this.italic = false;
        this.underline = false;
        this.orderedList = false;
        this.unorderedList = false;
        this.color = null;
        this.contentAlign = ContentAlign.LEFT;

        await this.findStyle(content);
      } else if (content.parentElement) {
        this.bold = false;
        this.italic = false;
        this.underline = false;
        this.orderedList = false;
        this.unorderedList = false;
        this.color = null;
        this.contentAlign = ContentAlign.LEFT;

        await this.findStyle(content.parentElement);
      }

      resolve();
    });
  }

  private isContainer(element: Node): boolean {
    return DeckdeckgoInlineEditorUtils.isContainer(this.containers, element);
  }

  // TODO: Find a clever way to detect to root container
  // We iterate until we find the root container to detect if bold, underline or italic are active
  private findStyle(node: Node): Promise<void> {
    return new Promise<void>(async (resolve) => {
      if (!node) {
        resolve();
        return;
      }

      // Just in case
      if (node.nodeName.toUpperCase() === 'HTML' || node.nodeName.toUpperCase() === 'BODY') {
        resolve();
        return;
      }

      if (this.isContainer(node)) {
        const nodeName: string = node.nodeName.toUpperCase();

        this.disabledTitle = nodeName === 'H1' || nodeName === 'H2' || nodeName === 'H3' || nodeName === 'H4' || nodeName === 'H5' || nodeName === 'H6';

        await this.findColor(node);

        resolve();
      } else {
        this.bold = await DeckdeckgoInlineEditorUtils.isBold(node as HTMLElement);
        this.italic = await DeckdeckgoInlineEditorUtils.isItalic(node as HTMLElement);
        this.underline = await DeckdeckgoInlineEditorUtils.isUnderline(node as HTMLElement);
        this.contentAlign = await DeckdeckgoInlineEditorUtils.getContentAlignment(node as HTMLElement);
        if (!this.orderedList) {
          this.orderedList = await DeckdeckgoInlineEditorUtils.isList(node as HTMLElement, 'ol');
        }

        if (!this.unorderedList) {
          this.unorderedList = await DeckdeckgoInlineEditorUtils.isList(node as HTMLElement, 'ul');
        }

        await this.findColor(node);

        await this.findStyle(node.parentNode);

        resolve();
      }
    });
  }

  private findColor(node: Node): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this.color && this.color !== '') {
        resolve();
        return;
      }

      if ((node as HTMLElement).style.color) {
        this.color = (node as HTMLElement).style.color;
      } else if (node instanceof HTMLFontElement && (node as HTMLFontElement).color) {
        this.color = (node as HTMLFontElement).color;
      }

      resolve();
    });
  }

  private initLink(selection: Selection): Promise<void> {
    return new Promise<void>(async (resolve) => {
      if (!selection) {
        resolve();
        return;
      }

      let content: Node = selection.anchorNode;

      if (!content) {
        resolve();
        return;
      }

      if (content.nodeType === 3) {
        content = content.parentElement;
      }

      this.link = content.nodeName && content.nodeName.toLowerCase() === 'a';

      resolve();
    });
  }

  private getSelection(): Promise<Selection> {
    return new Promise<Selection>((resolve) => {
      let selectedSelection: Selection = null;

      if (window && window.getSelection) {
        selectedSelection = window.getSelection();
      } else if (document && document.getSelection) {
        selectedSelection = document.getSelection();
      } else if (document && (document as any).selection) {
        selectedSelection = (document as any).selection.createRange().text;
      }

      resolve(selectedSelection);
    });
  }

  private clearTheSelection(): Promise<Selection> {
    return new Promise<Selection>((resolve) => {
      if (window && window.getSelection) {
        if (window.getSelection().empty) {
          window.getSelection().empty();
        } else if (window.getSelection().removeAllRanges) {
          window.getSelection().removeAllRanges();
        }
      } else if (document && (document as any).selection) {
        (document as any).selection.empty();
      }

      resolve();
    });
  }

  @Method()
  reset(clearSelection: boolean, blurActiveElement?: boolean): Promise<void> {
    return new Promise<void>(async (resolve) => {
      if (clearSelection) {
        await this.clearTheSelection();
      }

      await this.setToolsActivated(false);

      this.resetDisplayToolsActivated();

      this.selection = null;

      this.toolbarActions = ToolbarActions.SELECTION;
      this.anchorLink = null;
      this.link = false;

      if (window) {
        window.removeEventListener('scroll', async () => {
          await this.setStickyPositionIOS();
        });
        window.removeEventListener('resize', async () => {
          await this.reset(true, true);
        });
      }

      if (blurActiveElement && document && document.activeElement && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }

      resolve();
    });
  }

  private styleBold(e: UIEvent): Promise<void> {
    return new Promise<void>(async (resolve) => {
      e.stopPropagation();

      await this.execCommand('bold');

      await this.initStyle(this.selection);

      resolve();
    });
  }

  private styleItalic(e: UIEvent): Promise<void> {
    return new Promise<void>(async (resolve) => {
      e.stopPropagation();

      await this.execCommand('italic');

      await this.initStyle(this.selection);

      resolve();
    });
  }

  private styleUnderline(e: UIEvent): Promise<void> {
    return new Promise<void>(async (resolve) => {
      e.stopPropagation();

      await this.execCommand('underline');

      await this.initStyle(this.selection);

      resolve();
    });
  }

  private justifyContent(e: UIEvent, align: ContentAlign): Promise<void> {
    return new Promise<void>(async (resolve) => {
      e.stopPropagation();

      await this.execCommand(align.toString());

      //this.contentAlign = align;
      await this.initStyle(this.selection);
      resolve();
    });
  }

  private toggleList(e: UIEvent, cmd: string): Promise<void> {
    return new Promise<void>(async (resolve) => {
      e.stopPropagation();

      await this.execCommand(cmd);

      await this.reset(true);

      resolve();
    });
  }

  private execCommand(command: string): Promise<void> {
    return new Promise<void>(async (resolve) => {
      if (!this.selection || this.selection.rangeCount <= 0 || !document) {
        resolve();
        return;
      }

      const text: string = this.selection.toString();

      if (!text || text.length <= 0) {
        resolve();
        return;
      }

      document.execCommand(command);

      resolve();
    });
  }

  private toggleLink(): Promise<void> {
    return new Promise<void>(async (resolve) => {
      if (this.link) {
        await this.removeLink();
        await this.reset(true);
      } else {
        await this.openLink();
      }

      resolve();
    });
  }

  private removeLink(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!this.selection) {
        resolve();
        return;
      }

      let content: Node = this.selection.anchorNode;

      if (!content || !content.parentElement) {
        resolve();
        return;
      }

      if (content.nodeType === 3) {
        content = content.parentElement;
      }

      if (!content.nodeName && content.nodeName.toLowerCase() !== 'a') {
        resolve();
        return;
      }

      content.parentElement.insertBefore(document.createTextNode(content.textContent), content);
      content.parentElement.removeChild(content);

      resolve();
    });
  }

  private openLink(): Promise<void> {
    return new Promise<void>(async (resolve) => {
      this.toolbarActions = ToolbarActions.LINK;

      resolve();
    });
  }

  private isSticky(): boolean {
    const mobile: boolean = isMobile();

    return (this.stickyDesktop && !mobile) || (this.stickyMobile && mobile);
  }

  private setToolsActivated(activated: boolean): Promise<void> {
    return new Promise<void>(async (resolve) => {
      this.toolsActivated = activated;

      if (activated) {
        this.debounceDisplayToolsActivated();
      } else {
        this.displayToolsActivated = false;
      }

      if (this.isSticky()) {
        this.stickyToolbarActivated.emit(this.toolsActivated);
      }

      resolve();
    });
  }

  private async selectColor($event: CustomEvent) {
    if (!this.selection || !$event || !$event.detail) {
      return;
    }

    this.color = $event.detail.hex;

    if (!this.selection || this.selection.rangeCount <= 0 || !document) {
      return;
    }

    const text: string = this.selection.toString();

    if (!text || text.length <= 0) {
      return;
    }

    document.execCommand('foreColor', false, this.color);

    await this.reset(true);
  }

  private openColorPicker(): Promise<void> {
    return new Promise<void>(async (resolve) => {
      this.toolbarActions = ToolbarActions.COLOR;

      resolve();
    });
  }
  private openAlignmentActions(): Promise<void> {
    return new Promise<void>(async (resolve) => {
      this.toolbarActions = ToolbarActions.ALIGNMENT;

      resolve();
    });
  }

  renderAlignmentActions() {
    return [
      <deckgo-ie-action-button
        mobile={this.mobile}
        onAction={($event: CustomEvent<UIEvent>) => this.justifyContent($event.detail, ContentAlign.LEFT)}
        cssClass={this.contentAlign === ContentAlign.LEFT ? 'active' : undefined}>
        <deckgo-ie-action-image cssClass={'left-align'}></deckgo-ie-action-image>
      </deckgo-ie-action-button>,
      <deckgo-ie-action-button
        mobile={this.mobile}
        onAction={($event: CustomEvent<UIEvent>) => this.justifyContent($event.detail, ContentAlign.CENTER)}
        cssClass={this.contentAlign === ContentAlign.CENTER ? 'active' : undefined}>
        <deckgo-ie-action-image cssClass={'center-align'}></deckgo-ie-action-image>
      </deckgo-ie-action-button>,
      <deckgo-ie-action-button
        mobile={this.mobile}
        onAction={($event: CustomEvent<UIEvent>) => this.justifyContent($event.detail, ContentAlign.RIGHT)}
        cssClass={this.contentAlign === ContentAlign.RIGHT ? 'active' : undefined}>
        <deckgo-ie-action-image cssClass={'right-align'}></deckgo-ie-action-image>
      </deckgo-ie-action-button>
    ];
  }

  private async onCustomAction($event: UIEvent, action: string): Promise<void> {
    $event.stopPropagation();

    this.customAction.emit({
      action: action,
      selection: this.selection,
      anchorLink: this.anchorLink
    });
  }

  render() {
    let classNames: string = this.displayToolsActivated
      ? this.mobile
        ? 'deckgo-tools deckgo-tools-activated deckgo-tools-mobile'
        : 'deckgo-tools deckgo-tools-activated'
      : this.mobile
      ? 'deckgo-tools deckgo-tools-mobile'
      : 'deckgo-tools';

    if (this.isSticky()) {
      classNames += ' deckgo-tools-sticky';
    }

    const hostClass = isIOS() ? 'deckgo-tools-ios' : undefined;

    return (
      <Host class={hostClass}>
        <div class={classNames}>{this.renderActions()}</div>
      </Host>
    );
  }

  private renderActions() {
    if (this.toolbarActions === ToolbarActions.LINK) {
      return (
        <deckgo-ie-link-actions
          toolbarActions={this.toolbarActions}
          anchorLink={this.anchorLink}
          selection={this.selection}
          linkCreated={this.linkCreated}
          onLinkModified={($event: CustomEvent<boolean>) => this.reset($event.detail)}></deckgo-ie-link-actions>
      );
    } else if (this.toolbarActions === ToolbarActions.COLOR) {
      return (
        <div class="color">
          <deckgo-color onColorChange={($event: CustomEvent) => this.selectColor($event)} more={false} palette={this.palette}>
            <div slot="more"></div>
          </deckgo-color>
        </div>
      );
    } else if (this.toolbarActions === ToolbarActions.IMAGE) {
      return (
        <deckgo-ie-image-actions
          anchorEvent={this.anchorEvent}
          imgPropertyWidth={this.imgPropertyWidth}
          imgPropertyCssFloat={this.imgPropertyCssFloat}
          imgDidChange={this.imgDidChange}
          containers={this.containers}
          imgAnchor={this.imgAnchor}
          mobile={this.mobile}
          onImgModified={() => this.reset(true)}></deckgo-ie-image-actions>
      );
    } else if (this.toolbarActions === ToolbarActions.ALIGNMENT) {
      return this.renderAlignmentActions();
    } else {
      return this.renderSelectionActions();
    }
  }

  private renderSelectionActions() {
    const styleColor = this.color ? {'background-color': this.color} : {};

    return [
      <deckgo-ie-action-button
        mobile={this.mobile}
        onAction={($event: CustomEvent<UIEvent>) => this.styleBold($event.detail)}
        disableAction={this.disabledTitle}
        cssClass={this.bold ? 'bold active' : 'bold'}>
        B
      </deckgo-ie-action-button>,
      <deckgo-ie-action-button
        mobile={this.mobile}
        onAction={($event: CustomEvent<UIEvent>) => this.styleItalic($event.detail)}
        cssClass={this.italic ? 'italic active' : 'italic'}>
        I
      </deckgo-ie-action-button>,
      <deckgo-ie-action-button
        mobile={this.mobile}
        onAction={($event: CustomEvent<UIEvent>) => this.styleUnderline($event.detail)}
        cssClass={this.underline ? 'underline active' : 'underline'}>
        <span>U</span>
      </deckgo-ie-action-button>,

      this.renderSeparator(),
      <deckgo-ie-action-button
        mobile={this.mobile}
        onAction={() => this.openAlignmentActions()}
        cssClass={
          this.contentAlign === ContentAlign.LEFT || this.contentAlign === ContentAlign.CENTER || this.contentAlign === ContentAlign.RIGHT
            ? 'active'
            : undefined
        }>
        <deckgo-ie-action-image
          cssClass={
            this.contentAlign === ContentAlign.LEFT ? 'left-align' : this.contentAlign === ContentAlign.CENTER ? 'center-align' : 'right-align'
          }></deckgo-ie-action-image>
      </deckgo-ie-action-button>,

      <deckgo-ie-action-button mobile={this.mobile} onAction={() => this.openColorPicker()}>
        <deckgo-ie-action-image cssClass={'pick-color'} style={styleColor}></deckgo-ie-action-image>
      </deckgo-ie-action-button>,

      this.renderList(),
      this.renderSeparator(),

      <deckgo-ie-action-button mobile={this.mobile} onAction={() => this.toggleLink()} cssClass={this.link ? 'active' : undefined}>
        <deckgo-ie-action-image cssClass={'link'}></deckgo-ie-action-image>
      </deckgo-ie-action-button>,

      this.renderCustomActions()
    ];
  }

  private renderSeparator() {
    return <deckgo-ie-separator></deckgo-ie-separator>;
  }

  private renderCustomActions() {
    return this.customActions ? this.customActions.split(',').map((customAction: string) => this.renderCustomAction(customAction)) : undefined;
  }

  private renderCustomAction(customAction: string) {
    return [
      this.renderSeparator(),
      <deckgo-ie-action-button mobile={this.mobile} onClick={($event: UIEvent) => this.onCustomAction($event, customAction)}>
        <slot name={customAction}></slot>
      </deckgo-ie-action-button>
    ];
  }

  private renderList() {
    if (this.list) {
      return [
        <deckgo-ie-action-button
          mobile={this.mobile}
          disableAction={this.disabledTitle}
          onAction={($event: CustomEvent<UIEvent>) => this.toggleList($event.detail, 'insertOrderedList')}
          cssClass={this.orderedList ? 'active' : undefined}>
          <deckgo-ie-action-image cssClass={'ordered-list'}></deckgo-ie-action-image>
        </deckgo-ie-action-button>,

        <deckgo-ie-action-button
          mobile={this.mobile}
          disableAction={this.disabledTitle}
          onAction={($event: CustomEvent<UIEvent>) => this.toggleList($event.detail, 'insertUnorderedList')}
          cssClass={this.unorderedList ? 'active' : undefined}>
          <deckgo-ie-action-image cssClass={'unordered-list'}></deckgo-ie-action-image>
        </deckgo-ie-action-button>
      ];
    } else {
      return undefined;
    }
  }
}
