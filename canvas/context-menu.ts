/** 右键菜单(DOM 悬浮层)。 */
import type { CanvasStrings } from "../src/protocol.js";

export class PetContextMenu {
  private element: HTMLDivElement | undefined;
  private opened = false;
  private playItem: HTMLButtonElement | undefined;
  private closeItem: HTMLButtonElement | undefined;

  constructor(
    private readonly onPlayGame: () => void,
    private readonly onExitPet: () => void,
    private strings: CanvasStrings,
  ) {}

  get isOpen(): boolean {
    return this.opened;
  }

  setStrings(strings: CanvasStrings): void {
    this.strings = strings;
    if (this.playItem) this.playItem.textContent = strings.menuPlayGame;
    if (this.closeItem) this.closeItem.textContent = strings.menuClosePet;
  }

  show(x: number, y: number): void {
    const menu = this.ensureElement();
    menu.style.display = "block";
    const rect = menu.getBoundingClientRect();
    const edge = 8;
    const pointerGap = 4;

    // 优先向右下展开；空间不足时逐轴翻转，让指针始终贴近菜单四角之一。
    const opensRight = x + pointerGap + rect.width <= window.innerWidth - edge
      || x - pointerGap - rect.width < edge;
    const opensDown = y + pointerGap + rect.height <= window.innerHeight - edge
      || y - pointerGap - rect.height < edge;
    const anchoredLeft = opensRight ? x + pointerGap : x - pointerGap - rect.width;
    const anchoredTop = opensDown ? y + pointerGap : y - pointerGap - rect.height;
    const left = Math.max(edge, Math.min(anchoredLeft, window.innerWidth - rect.width - edge));
    const top = Math.max(edge, Math.min(anchoredTop, window.innerHeight - rect.height - edge));

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    this.opened = true;
  }

  hide(): void {
    if (!this.element) return;
    this.element.style.display = "none";
    this.opened = false;
  }

  private ensureElement(): HTMLDivElement {
    if (this.element) return this.element;
    const menu = document.createElement("div");
    menu.style.position = "fixed";
    menu.style.zIndex = "2147483647";
    menu.style.minWidth = "132px";
    menu.style.padding = "6px";
    menu.style.borderRadius = "12px";
    menu.style.background = "rgba(255,255,255,0.96)";
    menu.style.boxShadow = "0 12px 32px rgba(0,0,0,0.22)";
    menu.style.border = "1px solid rgba(0,0,0,0.08)";
    menu.style.backdropFilter = "blur(12px)";
    menu.style.font = '13px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif';
    menu.style.color = "#231f20";
    menu.style.display = "none";
    menu.style.pointerEvents = "auto";
    this.playItem = this.makeItem(this.strings.menuPlayGame, () => this.onPlayGame());
    this.closeItem = this.makeItem(this.strings.menuClosePet, () => this.onExitPet());
    menu.appendChild(this.playItem);
    menu.appendChild(this.makeSeparator());
    menu.appendChild(this.closeItem);
    document.body.appendChild(menu);
    this.element = menu;
    return menu;
  }

  private makeSeparator(): HTMLDivElement {
    const separator = document.createElement("div");
    separator.style.height = "1px";
    separator.style.margin = "5px 6px";
    separator.style.background = "rgba(0,0,0,0.08)";
    return separator;
  }

  private makeItem(label: string, onClick: () => void): HTMLButtonElement {
    const item = document.createElement("button");
    item.type = "button";
    item.textContent = label;
    item.style.display = "block";
    item.style.width = "100%";
    item.style.border = "0";
    item.style.borderRadius = "8px";
    item.style.background = "transparent";
    item.style.padding = "8px 10px";
    item.style.textAlign = "left";
    item.style.font = "inherit";
    item.style.color = "inherit";
    item.style.cursor = "default";
    item.addEventListener("mouseenter", () => {
      item.style.background = "rgba(0,0,0,0.07)";
    });
    item.addEventListener("mouseleave", () => {
      item.style.background = "transparent";
    });
    item.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.hide();
      onClick();
    });
    return item;
  }
}
