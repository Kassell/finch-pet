/** 右键菜单(DOM 悬浮层)。 */

export class PetContextMenu {
  private element: HTMLDivElement | undefined;
  private opened = false;

  constructor(private readonly onExitPet: () => void) {}

  get isOpen(): boolean {
    return this.opened;
  }

  show(x: number, y: number): void {
    const menu = this.ensureElement();
    menu.style.display = "block";
    const rect = menu.getBoundingClientRect();
    const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
    const top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
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
    menu.appendChild(this.makeItem("关闭桌宠", () => this.onExitPet()));
    document.body.appendChild(menu);
    this.element = menu;
    return menu;
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
