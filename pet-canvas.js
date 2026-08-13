/* 本文件由 canvas/ 目录源码构建生成,请勿直接编辑;运行 npm run build:canvas 重新生成。 */
"use strict";
(() => {
  // src/protocol.ts
  var PET_STATES = [
    "idle",
    "running-right",
    "running-left",
    "waving",
    "jumping",
    "failed",
    "waiting",
    "running",
    "review"
  ];
  var PET_STATE_SET = new Set(PET_STATES);
  var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
  var isOptionalString = (value) => value === void 0 || typeof value === "string";
  var isOptionalNumber = (value) => value === void 0 || typeof value === "number";
  var isOptionalBoolean = (value) => value === void 0 || typeof value === "boolean";
  var isPlayMode = (value) => value === "loop" || value === "once" || value === "freeze";
  function isPetState(value) {
    return typeof value === "string" && PET_STATE_SET.has(value);
  }
  function isBubbleAction(value) {
    return isRecord(value) && value.id === "open-session" && typeof value.label === "string" && typeof value.sessionId === "string";
  }
  function isHostToCanvasMessage(value) {
    if (!isRecord(value)) return false;
    switch (value.type) {
      case "setState":
        return isPetState(value.state) && isOptionalNumber(value.transientMs) && (value.playMode === void 0 || isPlayMode(value.playMode)) && isOptionalString(value.message) && isOptionalBoolean(value.persistent) && (value.action === void 0 || isBubbleAction(value.action)) && isOptionalString(value.sessionId) && isOptionalBoolean(value.clearBubble);
      case "say":
        return typeof value.message === "string" && isOptionalNumber(value.transientMs) && isOptionalBoolean(value.persistent) && (value.action === void 0 || isBubbleAction(value.action)) && isOptionalString(value.sessionId);
      case "clearBubble":
        return true;
      case "config":
        return isOptionalNumber(value.scale);
      case "gameMode":
        return typeof value.active === "boolean";
      case "prepareGame":
        return true;
      case "locale":
        return isRecord(value.strings) && Object.values(value.strings).every((text) => typeof text === "string");
      case "visualTransition":
        return typeof value.fromOpacity === "number" && typeof value.toOpacity === "number" && typeof value.fromScale === "number" && typeof value.toScale === "number" && typeof value.durationMs === "number";
      default:
        return false;
    }
  }

  // canvas/sprite.ts
  var BASE_FRAME_WIDTH = 192;
  var BASE_FRAME_HEIGHT = 208;
  var COLUMNS = 8;
  var ROWS = 9;
  var STATES = {
    idle: { row: 0 },
    "running-right": { row: 1 },
    "running-left": { row: 2 },
    waving: { row: 3 },
    jumping: { row: 4 },
    failed: { row: 5 },
    waiting: { row: 6 },
    running: { row: 7 },
    review: { row: 8 }
  };
  var STATE_NAMES = new Set(Object.keys(STATES));
  function normalizeState(value) {
    if (typeof value !== "string") return "idle";
    const state = value.trim().toLowerCase();
    return STATE_NAMES.has(state) ? state : "idle";
  }
  function spriteFrameSize(image) {
    const sourceWidth = image.naturalWidth || image.width || COLUMNS * BASE_FRAME_WIDTH;
    const sourceHeight = image.naturalHeight || image.height || ROWS * BASE_FRAME_HEIGHT;
    return {
      width: sourceWidth / COLUMNS,
      height: sourceHeight / ROWS
    };
  }
  function frameHasVisiblePixels(image, row, column) {
    const frame = spriteFrameSize(image);
    const canvas = document.createElement("canvas");
    canvas.width = BASE_FRAME_WIDTH;
    canvas.height = BASE_FRAME_HEIGHT;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return true;
    ctx.clearRect(0, 0, BASE_FRAME_WIDTH, BASE_FRAME_HEIGHT);
    ctx.drawImage(
      image,
      column * frame.width,
      row * frame.height,
      frame.width,
      frame.height,
      0,
      0,
      BASE_FRAME_WIDTH,
      BASE_FRAME_HEIGHT
    );
    const pixels = ctx.getImageData(0, 0, BASE_FRAME_WIDTH, BASE_FRAME_HEIGHT).data;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] > 8) return true;
    }
    return false;
  }
  function detectFrameCounts(image) {
    const counts = Array.from({ length: ROWS }, () => COLUMNS);
    try {
      for (let row = 0; row < ROWS; row += 1) {
        let lastVisible = -1;
        for (let column = 0; column < COLUMNS; column += 1) {
          if (frameHasVisiblePixels(image, row, column)) lastVisible = column;
        }
        counts[row] = Math.max(1, lastVisible + 1);
      }
    } catch {
      return Array.from({ length: ROWS }, () => COLUMNS);
    }
    return counts;
  }
  function detectVisibleContentBoundsByRow(image, frameCounts) {
    const fallback = () => ({ x: 0, y: 0, width: BASE_FRAME_WIDTH, height: BASE_FRAME_HEIGHT });
    const frame = spriteFrameSize(image);
    const canvas = document.createElement("canvas");
    canvas.width = BASE_FRAME_WIDTH;
    canvas.height = BASE_FRAME_HEIGHT;
    const c = canvas.getContext("2d", { willReadFrequently: true });
    if (!c) return Array.from({ length: ROWS }, fallback);
    const bounds = [];
    try {
      for (let row = 0; row < ROWS; row += 1) {
        let minX = BASE_FRAME_WIDTH;
        let minY = BASE_FRAME_HEIGHT;
        let maxX = -1;
        let maxY = -1;
        const count = Math.max(1, Math.min(COLUMNS, frameCounts[row] || COLUMNS));
        for (let column = 0; column < count; column += 1) {
          c.clearRect(0, 0, BASE_FRAME_WIDTH, BASE_FRAME_HEIGHT);
          c.drawImage(
            image,
            column * frame.width,
            row * frame.height,
            frame.width,
            frame.height,
            0,
            0,
            BASE_FRAME_WIDTH,
            BASE_FRAME_HEIGHT
          );
          const pixels = c.getImageData(0, 0, BASE_FRAME_WIDTH, BASE_FRAME_HEIGHT).data;
          for (let y = 0; y < BASE_FRAME_HEIGHT; y += 1) {
            for (let x = 0; x < BASE_FRAME_WIDTH; x += 1) {
              if (pixels[(y * BASE_FRAME_WIDTH + x) * 4 + 3] <= 8) continue;
              minX = Math.min(minX, x);
              minY = Math.min(minY, y);
              maxX = Math.max(maxX, x);
              maxY = Math.max(maxY, y);
            }
          }
        }
        bounds[row] = maxX < minX || maxY < minY ? fallback() : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
      }
    } catch {
      return Array.from({ length: ROWS }, fallback);
    }
    return bounds;
  }

  // canvas/bubble.ts
  var TOP_BUBBLE_MAX_RISE = 96;
  var PLACEMENT_HYSTERESIS = 16;
  var BUBBLE_FONT = '13px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif';
  var BUBBLE_ACTION_FONT = '12px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif';
  function chooseBubblePlacement(args) {
    const currentOnRight = args.current === "top-right" || args.current === "side-right";
    const currentOnSide = args.current === "side-left" || args.current === "side-right";
    const midX = args.displayLeft + args.displayWidth / 2;
    const placeOnRight = currentOnRight ? args.petCenterX < midX + PLACEMENT_HYSTERESIS : args.petCenterX < midX - PLACEMENT_HYSTERESIS;
    const clearance = args.petTopY - args.topBoundary;
    const nearTop = currentOnSide ? clearance < TOP_BUBBLE_MAX_RISE + PLACEMENT_HYSTERESIS : clearance < TOP_BUBBLE_MAX_RISE - PLACEMENT_HYSTERESIS;
    if (!nearTop) return placeOnRight ? "top-right" : "top-left";
    return placeOnRight ? "side-right" : "side-left";
  }
  function layoutBubble(params) {
    const { measure: c, text, placement, pet, canvasWidth: w, canvasHeight: h, action } = params;
    c.font = BUBBLE_FONT;
    const paddingX = 12;
    const lineHeight = 17;
    const actionLabel = action?.label || "";
    const hasAction = !!action && !!actionLabel;
    let actionW = 0;
    if (hasAction) {
      const previousFont = c.font;
      c.font = BUBBLE_ACTION_FONT;
      actionW = Math.max(52, c.measureText(actionLabel).width + 18);
      c.font = previousFont;
    }
    const tailSize = 8;
    const sideRight = placement === "side-right";
    const sideLeft = placement === "side-left";
    const topRight = placement === "top-right";
    const sidePlacement = sideRight || sideLeft;
    const bubbleGap = 6;
    const bubbleLeft = sideRight ? Math.max(102, Math.min(w - 108, pet.x + pet.drawW + bubbleGap)) : topRight ? Math.max(102, Math.min(w - 108, pet.x + pet.drawW * 0.52)) : 0;
    const bubbleRight = sideLeft ? Math.max(108, Math.min(w - 102, pet.x - bubbleGap)) : topRight ? 0 : Math.max(108, Math.min(w - 102, pet.x + pet.drawW * 0.48));
    const availableBoxW = sideRight || topRight ? w - bubbleLeft - 12 : bubbleRight - 12;
    const maxBoxW = Math.min(hasAction ? 240 : 220, availableBoxW);
    const minBoxW = Math.min(maxBoxW, hasAction ? 150 : 88);
    const boxW = Math.min(
      Math.max(c.measureText(text).width + paddingX * 2, minBoxW),
      maxBoxW
    );
    const textMaxW = boxW - paddingX * 2;
    const lines = [];
    let line = "";
    let truncated = false;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      const candidate = line + char;
      if (char !== "\n" && (line === "" || c.measureText(candidate).width <= textMaxW)) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = char === "\n" ? "" : char;
      if (lines.length === 3) {
        truncated = index < text.length;
        break;
      }
    }
    if (lines.length < 3 && line) lines.push(line);
    if (!lines.length) lines.push("");
    if (truncated) {
      let last = lines[lines.length - 1];
      while (last.length > 1 && c.measureText(`${last}…`).width > textMaxW) last = last.slice(0, -1);
      lines[lines.length - 1] = `${last}…`;
    }
    const textAreaH = lines.length * lineHeight + 16;
    const actionAreaH = hasAction ? 24 : 0;
    const boxH = textAreaH + actionAreaH;
    const verticalOffset = action ? 0 : pet.bounce;
    const x = sideRight || topRight ? bubbleLeft : bubbleRight - boxW;
    const boxRight = x + boxW;
    let y;
    let tailTipX;
    let tailTipY;
    if (sidePlacement) {
      const sideAnchorY = pet.y + pet.drawH * 0.28;
      y = Math.max(8, Math.min(h - boxH - 8, sideAnchorY - boxH / 2));
      tailTipX = sideRight ? x - tailSize : boxRight + tailSize;
      tailTipY = Math.max(y + 14, Math.min(y + boxH - 14, sideAnchorY));
    } else {
      const petBoxTop = h - pet.drawH - 14;
      tailTipY = petBoxTop + 6 - Math.max(0, verticalOffset);
      tailTipX = topRight ? x + 20 : boxRight - 20;
      y = Math.max(8, tailTipY - tailSize - boxH);
    }
    const actionLayout = hasAction ? {
      x: x + boxW - 10 - actionW,
      y: y + textAreaH - 2,
      width: actionW,
      height: 22,
      label: actionLabel
    } : null;
    return {
      placement,
      x,
      y,
      boxW,
      boxH,
      lines,
      lineHeight,
      paddingX,
      textAreaH,
      tailSize,
      tailTipX,
      tailTipY,
      action: actionLayout
    };
  }

  // canvas/draw.ts
  function drawRoundRect(c, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + radius, y);
    c.lineTo(x + w - radius, y);
    c.quadraticCurveTo(x + w, y, x + w, y + radius);
    c.lineTo(x + w, y + h - radius);
    c.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    c.lineTo(x + radius, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - radius);
    c.lineTo(x, y + radius);
    c.quadraticCurveTo(x, y, x + radius, y);
    c.closePath();
  }
  function drawPetFrame(c, args) {
    c.save();
    c.imageSmoothingEnabled = false;
    c.drawImage(
      args.image,
      args.sx,
      args.sy,
      args.sourceW,
      args.sourceH,
      args.x,
      args.y,
      args.drawW,
      args.drawH
    );
    c.restore();
  }
  function paintBubble(c, layout, buttonState) {
    const { x, y, boxW, boxH, tailTipX, tailTipY, placement } = layout;
    const boxRight = x + boxW;
    c.save();
    c.font = BUBBLE_FONT;
    c.textBaseline = "middle";
    c.shadowColor = "rgba(0,0,0,0.18)";
    c.shadowBlur = 12;
    c.fillStyle = "rgba(255,255,255,0.94)";
    drawRoundRect(c, x, y, boxW, boxH, 14);
    c.fill();
    c.shadowColor = "transparent";
    c.shadowBlur = 0;
    c.beginPath();
    if (placement === "side-right") {
      c.moveTo(x + 1, tailTipY - 7);
      c.lineTo(tailTipX, tailTipY);
      c.lineTo(x + 1, tailTipY + 5);
    } else if (placement === "side-left") {
      c.moveTo(boxRight - 1, tailTipY - 7);
      c.lineTo(tailTipX, tailTipY);
      c.lineTo(boxRight - 1, tailTipY + 5);
    } else if (placement === "top-right") {
      c.moveTo(tailTipX - 3, y + boxH - 1);
      c.lineTo(tailTipX, tailTipY);
      c.lineTo(tailTipX + 9, y + boxH - 1);
    } else {
      c.moveTo(tailTipX - 9, y + boxH - 1);
      c.lineTo(tailTipX, tailTipY);
      c.lineTo(tailTipX + 3, y + boxH - 1);
    }
    c.closePath();
    c.fill();
    c.textAlign = "left";
    c.fillStyle = "#3a2f0b";
    layout.lines.forEach((text, index) => {
      c.fillText(text, x + layout.paddingX, y + 8 + layout.lineHeight / 2 + index * layout.lineHeight);
    });
    if (layout.action) {
      const action = layout.action;
      c.fillStyle = buttonState.pressed ? "rgba(44,126,78,0.26)" : buttonState.hover ? "rgba(44,126,78,0.20)" : "rgba(44,126,78,0.14)";
      drawRoundRect(c, action.x, action.y, action.width, action.height, 8);
      c.fill();
      c.font = BUBBLE_ACTION_FONT;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillStyle = "#287a4b";
      c.fillText(action.label, action.x + action.width / 2, action.y + action.height / 2);
    }
    c.restore();
  }
  function drawLoading(c, width, height, message) {
    c.save();
    c.fillStyle = "rgba(255,255,255,0.92)";
    c.beginPath();
    c.ellipse(width / 2, height / 2, 62, 42, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#3a2f0b";
    c.font = BUBBLE_FONT;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(message, width / 2, height / 2);
    c.restore();
  }

  // canvas/context-menu.ts
  var PetContextMenu = class {
    constructor(onPlayGame, onExitPet, strings) {
      this.onPlayGame = onPlayGame;
      this.onExitPet = onExitPet;
      this.strings = strings;
    }
    onPlayGame;
    onExitPet;
    strings;
    element;
    opened = false;
    playItem;
    closeItem;
    get isOpen() {
      return this.opened;
    }
    setStrings(strings) {
      this.strings = strings;
      if (this.playItem) this.playItem.textContent = strings.menuPlayGame;
      if (this.closeItem) this.closeItem.textContent = strings.menuClosePet;
    }
    show(x, y) {
      const menu = this.ensureElement();
      menu.style.display = "block";
      const rect = menu.getBoundingClientRect();
      const edge = 8;
      const pointerGap = 4;
      const opensRight = x + pointerGap + rect.width <= window.innerWidth - edge || x - pointerGap - rect.width < edge;
      const opensDown = y + pointerGap + rect.height <= window.innerHeight - edge || y - pointerGap - rect.height < edge;
      const anchoredLeft = opensRight ? x + pointerGap : x - pointerGap - rect.width;
      const anchoredTop = opensDown ? y + pointerGap : y - pointerGap - rect.height;
      const left = Math.max(edge, Math.min(anchoredLeft, window.innerWidth - rect.width - edge));
      const top = Math.max(edge, Math.min(anchoredTop, window.innerHeight - rect.height - edge));
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
      this.opened = true;
    }
    hide() {
      if (!this.element) return;
      this.element.style.display = "none";
      this.opened = false;
    }
    ensureElement() {
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
    makeSeparator() {
      const separator = document.createElement("div");
      separator.style.height = "1px";
      separator.style.margin = "5px 6px";
      separator.style.background = "rgba(0,0,0,0.08)";
      return separator;
    }
    makeItem(label, onClick) {
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
  };

  // canvas/flappy-bird.ts
  var STATUS_BAR_HEIGHT = 56;
  var CLOSE_BUTTON_SIZE = 32;
  var CLOSE_BUTTON_RIGHT = 12;
  var FlappyBirdGame = class {
    constructor(onExit, strings) {
      this.onExit = onExit;
      this.strings = strings;
    }
    onExit;
    strings;
    width = 0;
    height = 0;
    birdY = 0;
    velocity = 0;
    elapsed = 0;
    spawnElapsed = 0;
    score = 0;
    best = 0;
    phase = "ready";
    pipes = [];
    closeHovered = false;
    closePressed = false;
    closePressStartedAt = 0;
    closePressX = 0;
    closePressY = 0;
    closePressMoved = false;
    playPressed = false;
    playPressPhase = "ready";
    playPressStartedAt = 0;
    playPressX = 0;
    playPressY = 0;
    playPressMoved = false;
    setStrings(strings) {
      this.strings = strings;
    }
    format(template, values) {
      return template.replace(/\{(\w+)\}/g, (match, key) => Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match);
    }
    resize(width, height) {
      this.width = width;
      this.height = height;
      if (this.phase === "ready") this.birdY = STATUS_BAR_HEIGHT + (height - STATUS_BAR_HEIGHT) * 0.43;
    }
    reset() {
      this.birdY = STATUS_BAR_HEIGHT + (this.height - STATUS_BAR_HEIGHT) * 0.43;
      this.velocity = 0;
      this.elapsed = 0;
      this.spawnElapsed = 0;
      this.score = 0;
      this.phase = "ready";
      this.pipes = [];
    }
    flap() {
      if (this.phase === "over") return;
      if (this.phase === "ready") this.phase = "playing";
      this.velocity = -410;
    }
    keyDown(key) {
      if (key === "Escape") {
        this.onExit();
        return true;
      }
      if (key === " " || key === "Spacebar" || key === "ArrowUp" || key.toLowerCase() === "w") {
        if (this.phase === "over") this.reset();
        this.flap();
        return true;
      }
      return false;
    }
    isDragHandle(x, y) {
      return y >= 0 && y <= STATUS_BAR_HEIGHT && !this.isCloseButtonPoint(x, y);
    }
    isCloseButtonPoint(x, y) {
      const buttonX = this.width - CLOSE_BUTTON_RIGHT - CLOSE_BUTTON_SIZE;
      const buttonY = (STATUS_BAR_HEIGHT - CLOSE_BUTTON_SIZE) / 2;
      return x >= buttonX && x <= buttonX + CLOSE_BUTTON_SIZE && y >= buttonY && y <= buttonY + CLOSE_BUTTON_SIZE;
    }
    cursorAt(x, y) {
      if (this.isCloseButtonPoint(x, y)) return "pointer";
      if (this.isDragHandle(x, y)) return "grab";
      return "default";
    }
    pointerDown(x, y) {
      if (this.isDragHandle(x, y)) return;
      if (this.isCloseButtonPoint(x, y)) {
        this.closePressed = true;
        this.closeHovered = true;
        this.closePressStartedAt = performance.now();
        this.closePressX = x;
        this.closePressY = y;
        this.closePressMoved = false;
        return;
      }
      if (this.playPressed) return;
      this.playPressed = true;
      this.playPressPhase = this.phase;
      this.playPressStartedAt = performance.now();
      this.playPressX = x;
      this.playPressY = y;
      this.playPressMoved = false;
      if (this.phase !== "over") this.flap();
    }
    pointerMove(x, y) {
      this.closeHovered = this.isCloseButtonPoint(x, y);
      if (this.closePressed && Math.hypot(x - this.closePressX, y - this.closePressY) > 6)
        this.closePressMoved = true;
      if (this.playPressed && Math.hypot(x - this.playPressX, y - this.playPressY) > 6)
        this.playPressMoved = true;
    }
    pointerUp(x, y) {
      if (this.closePressed) {
        const isShortClick = performance.now() - this.closePressStartedAt <= 500;
        const shouldClose = isShortClick && !this.closePressMoved && this.isCloseButtonPoint(x, y);
        this.closePressed = false;
        this.closeHovered = this.isCloseButtonPoint(x, y);
        if (shouldClose) this.onExit();
        return;
      }
      this.closeHovered = this.isCloseButtonPoint(x, y);
      if (!this.playPressed) return;
      const shouldRestart = this.playPressPhase === "over" && this.phase === "over" && !this.playPressMoved && performance.now() - this.playPressStartedAt <= 500;
      this.playPressed = false;
      this.playPressMoved = false;
      if (shouldRestart) {
        this.reset();
        this.flap();
      }
    }
    cancelPointer() {
      this.closePressed = false;
      this.closeHovered = false;
      this.closePressMoved = false;
      this.playPressed = false;
      this.playPressMoved = false;
    }
    frame(ctx, dtMs) {
      const dt = Math.min(0.034, Math.max(0, dtMs / 1e3));
      this.elapsed += dt;
      if (this.phase === "playing") this.update(dt);
      this.paint(ctx);
    }
    update(dt) {
      const birdX = this.width * 0.3;
      const pipeWidth = 68;
      const contentHeight = this.height - STATUS_BAR_HEIGHT;
      const gap = Math.max(138, Math.min(166, contentHeight * 0.25));
      const floorY = this.height - 72;
      this.velocity += 1120 * dt;
      this.birdY += this.velocity * dt;
      const ceilingY = STATUS_BAR_HEIGHT + 14;
      if (this.birdY < ceilingY) {
        this.birdY = ceilingY;
        if (this.velocity < 0) this.velocity = 0;
      }
      this.spawnElapsed += dt;
      if (this.spawnElapsed >= 1.45) {
        this.spawnElapsed -= 1.45;
        const margin = gap / 2 + 72;
        const range = Math.max(1, floorY - margin * 2);
        this.pipes.push({ x: this.width + 20, gapY: margin + Math.random() * range, scored: false });
      }
      for (const pipe of this.pipes) {
        pipe.x -= 176 * dt;
        if (!pipe.scored && pipe.x + pipeWidth < birdX) {
          pipe.scored = true;
          this.score += 1;
          this.best = Math.max(this.best, this.score);
        }
      }
      this.pipes = this.pipes.filter((pipe) => pipe.x + pipeWidth > -8);
      const bird = { left: birdX - 17, right: birdX + 17, top: this.birdY - 14, bottom: this.birdY + 14 };
      const hitPipe = this.pipes.some((pipe) => {
        const overlapsX = bird.right > pipe.x && bird.left < pipe.x + pipeWidth;
        return overlapsX && (bird.top < pipe.gapY - gap / 2 || bird.bottom > pipe.gapY + gap / 2);
      });
      if (hitPipe || bird.bottom >= floorY) {
        this.phase = "over";
        this.best = Math.max(this.best, this.score);
      }
    }
    paint(ctx) {
      const w = this.width;
      const h = this.height;
      const floorY = h - 72;
      const birdX = w * 0.3;
      const contentHeight = h - STATUS_BAR_HEIGHT;
      const gap = Math.max(138, Math.min(166, contentHeight * 0.25));
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, "#78d7f5");
      sky.addColorStop(0.72, "#d8f5ef");
      sky.addColorStop(1, "#f7e6a7");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);
      this.paintCloud(ctx, w - this.elapsed * 18 % (w + 120) + 30, 130, 0.9);
      this.paintCloud(ctx, w - (this.elapsed * 11 + 230) % (w + 160) + 50, 214, 0.65);
      for (const pipe of this.pipes) this.paintPipe(ctx, pipe.x, pipe.gapY, gap, floorY);
      ctx.fillStyle = "#8bd34f";
      ctx.fillRect(0, floorY, w, 18);
      ctx.fillStyle = "#62ad3e";
      ctx.fillRect(0, floorY + 12, w, 8);
      ctx.fillStyle = "#e9ca72";
      ctx.fillRect(0, floorY + 20, w, h - floorY - 20);
      ctx.fillStyle = "rgba(166, 119, 47, 0.18)";
      for (let x = -20; x < w + 20; x += 38) ctx.fillRect(x, floorY + 34, 20, 4);
      if (this.phase !== "ready") {
        const angle = Math.max(-0.48, Math.min(1.15, this.velocity / 620));
        this.paintBird(ctx, birdX, this.birdY, angle);
      }
      if (this.phase !== "ready") this.paintScore(ctx);
      else this.paintReadyScreen(ctx, floorY);
      if (this.best > 0) this.paintBestScore(ctx);
      this.paintStatusBar(ctx);
      if (this.phase === "over")
        this.paintCard(
          ctx,
          this.strings.gameOver,
          `${this.format(this.strings.gameResult, { score: this.score, best: this.best })}
${this.strings.gameRestartHint}`
        );
    }
    paintPipe(ctx, x, gapY, gap, floorY) {
      const width = 68;
      const topBottom = gapY - gap / 2;
      const bottomTop = gapY + gap / 2;
      const gradient = ctx.createLinearGradient(x, 0, x + width, 0);
      gradient.addColorStop(0, "#4bbd48");
      gradient.addColorStop(0.45, "#9be15d");
      gradient.addColorStop(1, "#2f9639");
      ctx.fillStyle = gradient;
      ctx.strokeStyle = "#267a31";
      ctx.lineWidth = 3;
      ctx.fillRect(x, STATUS_BAR_HEIGHT, width, topBottom - STATUS_BAR_HEIGHT - 18);
      ctx.strokeRect(x, STATUS_BAR_HEIGHT - 3, width, topBottom - STATUS_BAR_HEIGHT - 15);
      ctx.fillRect(x - 6, topBottom - 26, width + 12, 26);
      ctx.strokeRect(x - 6, topBottom - 26, width + 12, 26);
      ctx.fillRect(x, bottomTop + 18, width, floorY - bottomTop - 18);
      ctx.strokeRect(x, bottomTop + 18, width, floorY - bottomTop - 15);
      ctx.fillRect(x - 6, bottomTop, width + 12, 26);
      ctx.strokeRect(x - 6, bottomTop, width + 12, 26);
    }
    paintBird(ctx, x, y, angle) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      const bodyGradient = ctx.createLinearGradient(-17, -16, 16, 14);
      bodyGradient.addColorStop(0, "#9ae9d0");
      bodyGradient.addColorStop(0.52, "#58c9a7");
      bodyGradient.addColorStop(1, "#29987b");
      ctx.fillStyle = bodyGradient;
      ctx.strokeStyle = "#226f60";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(-25, 9);
      ctx.bezierCurveTo(-16, 4, -13, -8, -5, -14);
      ctx.bezierCurveTo(2, -20, 14, -18, 19, -9);
      ctx.bezierCurveTo(25, 1, 18, 14, 7, 17);
      ctx.bezierCurveTo(-5, 21, -16, 16, -25, 9);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#fffdf9";
      ctx.beginPath();
      ctx.moveTo(5, -14);
      ctx.bezierCurveTo(15, -14, 20, -7, 19, 2);
      ctx.bezierCurveTo(18, 12, 10, 17, 1, 16);
      ctx.bezierCurveTo(-6, 15, -9, 10, -7, 4);
      ctx.bezierCurveTo(-4, -4, -1, -11, 5, -14);
      ctx.closePath();
      ctx.fill();
      const wingGradient = ctx.createLinearGradient(-24, 0, 4, 14);
      wingGradient.addColorStop(0, "#155e53");
      wingGradient.addColorStop(1, "#2fa584");
      ctx.fillStyle = wingGradient;
      ctx.beginPath();
      ctx.moveTo(-24, 8);
      ctx.bezierCurveTo(-14, 8, -8, 2, -3, -4);
      ctx.bezierCurveTo(-2, 7, 2, 12, 8, 15);
      ctx.bezierCurveTo(-5, 19, -17, 15, -24, 8);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#f2a33a";
      ctx.strokeStyle = "#a96120";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(18, -7);
      ctx.lineTo(27, -3);
      ctx.lineTo(18, 1);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#202827";
      ctx.beginPath();
      ctx.arc(11, -8, 2.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath();
      ctx.arc(10.2, -8.8, 0.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    paintCloud(ctx, x, y, scale) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      ctx.fillStyle = "rgba(255,255,255,0.72)";
      ctx.beginPath();
      ctx.arc(0, 10, 23, 0, Math.PI * 2);
      ctx.arc(27, 0, 31, 0, Math.PI * 2);
      ctx.arc(60, 12, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    paintScore(ctx) {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 6;
      ctx.strokeStyle = "rgba(0,0,0,0.28)";
      ctx.fillStyle = "#fff";
      ctx.font = '800 42px -apple-system, BlinkMacSystemFont, "SF Pro Rounded", sans-serif';
      ctx.strokeText(String(this.score), this.width / 2, STATUS_BAR_HEIGHT + 38);
      ctx.fillText(String(this.score), this.width / 2, STATUS_BAR_HEIGHT + 38);
    }
    paintBestScore(ctx) {
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.font = '700 13px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif';
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,0.2)";
      ctx.fillStyle = "rgba(255,255,255,0.96)";
      const label = this.format(this.strings.gameBest, { best: this.best });
      ctx.strokeText(label, this.width - 16, STATUS_BAR_HEIGHT + 24);
      ctx.fillText(label, this.width - 16, STATUS_BAR_HEIGHT + 24);
    }
    paintReadyScreen(ctx, floorY) {
      const titleY = STATUS_BAR_HEIGHT + (floorY - STATUS_BAR_HEIGHT) * 0.28;
      const titleGradient = ctx.createLinearGradient(0, titleY - 34, 0, titleY + 28);
      titleGradient.addColorStop(0, "#fff7a8");
      titleGradient.addColorStop(0.48, "#ffd348");
      titleGradient.addColorStop(1, "#f59b28");
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = '900 43px -apple-system, BlinkMacSystemFont, "SF Pro Rounded", sans-serif';
      ctx.lineJoin = "round";
      ctx.shadowColor = "rgba(37,73,68,0.3)";
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 6;
      ctx.lineWidth = 8;
      ctx.strokeStyle = "#fffdf0";
      ctx.strokeText(this.strings.gameTitle, this.width / 2, titleY);
      ctx.shadowColor = "transparent";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#a76022";
      ctx.strokeText(this.strings.gameTitle, this.width / 2, titleY);
      ctx.fillStyle = titleGradient;
      ctx.fillText(this.strings.gameTitle, this.width / 2, titleY);
      ctx.restore();
      const pulse = 0.5 + 0.5 * Math.sin(this.elapsed * 4.2);
      ctx.save();
      ctx.globalAlpha = 0.42 + pulse * 0.58;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = '700 16px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif';
      ctx.fillStyle = "#385f5b";
      ctx.fillText(this.strings.gameStartHint, this.width / 2, floorY - 34);
      ctx.restore();
    }
    paintStatusBar(ctx) {
      const buttonX = this.width - CLOSE_BUTTON_RIGHT - CLOSE_BUTTON_SIZE;
      const buttonY = (STATUS_BAR_HEIGHT - CLOSE_BUTTON_SIZE) / 2;
      ctx.fillStyle = "rgba(255,255,255,0.84)";
      ctx.fillRect(0, 0, this.width, STATUS_BAR_HEIGHT);
      ctx.fillStyle = "rgba(37,66,65,0.1)";
      ctx.fillRect(0, STATUS_BAR_HEIGHT - 1, this.width, 1);
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      ctx.fillStyle = "#203f3d";
      ctx.font = '700 15px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif';
      ctx.fillText(this.strings.gameHeader, this.width / 2, STATUS_BAR_HEIGHT / 2);
      const pressedInside = this.closePressed && this.closeHovered;
      const buttonScale = pressedInside ? 0.9 : 1;
      const centerX = buttonX + CLOSE_BUTTON_SIZE / 2;
      const centerY = buttonY + CLOSE_BUTTON_SIZE / 2;
      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.scale(buttonScale, buttonScale);
      ctx.translate(-centerX, -centerY);
      ctx.fillStyle = pressedInside ? "rgba(32,63,61,0.2)" : this.closeHovered ? "rgba(32,63,61,0.13)" : "rgba(32,63,61,0.07)";
      ctx.beginPath();
      ctx.roundRect(buttonX, buttonY, CLOSE_BUTTON_SIZE, CLOSE_BUTTON_SIZE, CLOSE_BUTTON_SIZE / 2);
      ctx.fill();
      ctx.strokeStyle = pressedInside ? "#122c2a" : "#203f3d";
      ctx.lineWidth = 1.8;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(buttonX + 11, buttonY + 11);
      ctx.lineTo(buttonX + 21, buttonY + 21);
      ctx.moveTo(buttonX + 21, buttonY + 11);
      ctx.lineTo(buttonX + 11, buttonY + 21);
      ctx.stroke();
      ctx.restore();
    }
    paintCard(ctx, title, subtitle) {
      const cardWidth = Math.min(330, this.width - 48);
      const lines = subtitle.split("\n");
      const cardHeight = lines.length > 1 ? 132 : 112;
      const x = (this.width - cardWidth) / 2;
      const contentHeight = this.height - STATUS_BAR_HEIGHT;
      const y = STATUS_BAR_HEIGHT + contentHeight * 0.2;
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.strokeStyle = "rgba(45,82,75,0.18)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(x, y, cardWidth, cardHeight, 22);
      ctx.fill();
      ctx.stroke();
      ctx.textAlign = "center";
      ctx.fillStyle = "#294b48";
      ctx.font = '800 25px -apple-system, BlinkMacSystemFont, "SF Pro Rounded", sans-serif';
      ctx.fillText(title, this.width / 2, y + 34);
      ctx.fillStyle = "#56736f";
      ctx.font = '600 14px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif';
      lines.forEach((line, index) => ctx.fillText(line, this.width / 2, y + 70 + index * 24));
    }
  };

  // canvas/drag.ts
  var DRAG_THRESHOLD = 4;
  var DRAG_VELOCITY_SMOOTHING = 0.35;
  var INERTIA_MIN_SPEED = 0.06;
  var INERTIA_MAX_SPEED = 1.8;
  var INERTIA_DECAY_PER_MS = 85e-4;
  var INERTIA_MAX_DURATION_MS = 650;
  var clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  function smoothVelocity(current, delta, dt) {
    if (!Number.isFinite(dt) || dt <= 0 || dt > 80) return { x: 0, y: 0 };
    const rawX = delta.x / dt;
    const rawY = delta.y / dt;
    return {
      x: current.x * (1 - DRAG_VELOCITY_SMOOTHING) + rawX * DRAG_VELOCITY_SMOOTHING,
      y: current.y * (1 - DRAG_VELOCITY_SMOOTHING) + rawY * DRAG_VELOCITY_SMOOTHING
    };
  }
  function limitVelocity(velocity) {
    const speed = Math.hypot(velocity.x, velocity.y);
    if (speed <= INERTIA_MAX_SPEED || speed === 0) return velocity;
    const scale = INERTIA_MAX_SPEED / speed;
    return { x: velocity.x * scale, y: velocity.y * scale };
  }
  function decayVelocity(velocity, dt) {
    const decay = Math.exp(-INERTIA_DECAY_PER_MS * dt);
    return { x: velocity.x * decay, y: velocity.y * decay };
  }
  var right = (rect) => rect.x + rect.width;
  var bottom = (rect) => rect.y + rect.height;
  function verticalSeams(displays) {
    const seams = /* @__PURE__ */ new Set();
    for (const a of displays) {
      for (const b of displays) {
        if (a === b) continue;
        if (right(a.bounds) === b.bounds.x && a.bounds.y < bottom(b.bounds) && b.bounds.y < bottom(a.bounds)) seams.add(b.bounds.x);
      }
    }
    return [...seams];
  }
  var allowedRegion = (display) => ({
    x: display.workArea.x,
    y: display.workArea.y,
    width: display.workArea.width,
    height: Math.max(0, bottom(display.bounds) - display.workArea.y)
  });
  function isCoveredByRegions(rect, regions) {
    const xStops = [rect.x, right(rect)];
    for (const region of regions) {
      const leftEdge = Math.max(rect.x, region.x);
      const rightEdge = Math.min(right(rect), right(region));
      if (leftEdge < rightEdge) xStops.push(leftEdge, rightEdge);
    }
    const sortedX = [...new Set(xStops)].sort((a, b) => a - b);
    for (let index = 0; index < sortedX.length - 1; index += 1) {
      const startX = sortedX[index];
      const endX = sortedX[index + 1];
      if (endX <= startX) continue;
      const sampleX = (startX + endX) / 2;
      const intervals = regions.filter((region) => sampleX >= region.x && sampleX < right(region)).map((region) => ({ start: region.y, end: bottom(region) })).sort((a, b) => a.start - b.start);
      let coveredUntil = rect.y;
      for (const interval of intervals) {
        if (interval.end <= coveredUntil) continue;
        if (interval.start > coveredUntil) break;
        coveredUntil = interval.end;
        if (coveredUntil >= bottom(rect)) break;
      }
      if (coveredUntil < bottom(rect)) return false;
    }
    return sortedX.length > 1;
  }
  function constrainWindowPosition(position, contentBounds, displays, previous) {
    const raw = { x: Math.round(position.x), y: Math.round(position.y) };
    const regions = displays.map(allowedRegion).filter((region) => region.width > 0 && region.height > 0);
    if (!regions.length) return { ...raw, blockedX: false, blockedY: false };
    const contentAt = (windowX, windowY) => ({
      x: windowX + contentBounds.x,
      y: windowY + contentBounds.y,
      width: contentBounds.width,
      height: contentBounds.height
    });
    const coveredAt = (windowX, windowY) => isCoveredByRegions(contentAt(windowX, windowY), regions);
    if (coveredAt(raw.x, raw.y)) {
      return { ...raw, blockedX: false, blockedY: false };
    }
    if (previous) {
      const prev = { x: Math.round(previous.x), y: Math.round(previous.y) };
      if (coveredAt(prev.x, prev.y)) {
        if (coveredAt(raw.x, prev.y)) return { x: raw.x, y: prev.y, blockedX: false, blockedY: true };
        if (coveredAt(prev.x, raw.y)) return { x: prev.x, y: raw.y, blockedX: true, blockedY: false };
        return { ...prev, blockedX: true, blockedY: true };
      }
    }
    const candidateX = /* @__PURE__ */ new Set([raw.x]);
    const candidateY = /* @__PURE__ */ new Set([raw.y]);
    for (const region of regions) {
      candidateX.add(Math.round(region.x - contentBounds.x));
      candidateX.add(Math.round(right(region) - contentBounds.x - contentBounds.width));
      candidateY.add(Math.round(region.y - contentBounds.y));
      candidateY.add(Math.round(bottom(region) - contentBounds.y - contentBounds.height));
    }
    let best = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const x of candidateX) {
      for (const y of candidateY) {
        if (!isCoveredByRegions(contentAt(x, y), regions)) continue;
        const distance = (x - raw.x) ** 2 + (y - raw.y) ** 2;
        if (distance >= bestDistance) continue;
        best = { x, y };
        bestDistance = distance;
      }
    }
    if (!best) {
      const region = regions[0];
      best = {
        x: Math.round(clamp(raw.x, region.x - contentBounds.x, right(region) - contentBounds.x - contentBounds.width)),
        y: Math.round(clamp(raw.y, region.y - contentBounds.y, bottom(region) - contentBounds.y - contentBounds.height))
      };
    }
    return { ...best, blockedX: best.x !== raw.x, blockedY: best.y !== raw.y };
  }

  // canvas/main.ts
  var DEBUG_BACKGROUND = false;
  var DEBUG_DYNAMIC_PASSTHROUGH = true;
  var FPS = 8;
  var PET_RENDER_INTERVAL_MS = 1e3 / 24;
  var PET_SIZE_RATIO = 0.7;
  var GAME_WINDOW_WIDTH = 360;
  var GAME_WINDOW_HEIGHT = 696;
  var DEFAULT_CANVAS_STRINGS = {
    menuPlayGame: "Play a game",
    menuClosePet: "Close pet",
    gameHeader: "Flappy Finch",
    gameTitle: "FlappyFinch",
    gameStartHint: "Click / Space to fly",
    gameBest: "BEST {best}",
    gameOver: "Game Over",
    gameResult: "Score {score}  ·  Best {best}",
    gameRestartHint: "Click to play again",
    loadingPet: "Loading pet…",
    spriteLoadFailed: "Failed to load spritesheet"
  };
  var postToHost = (message) => finch.postMessage(message);
  var PetCanvasApp = class {
    canvas;
    c;
    w = 0;
    h = 0;
    t = 0;
    /** 合并高刷新率显示器上的连续 rAF，降低透明窗口的清屏与合成开销。 */
    pendingFrameMs = 0;
    image;
    loaded = false;
    error = "";
    frameCounts = Array.from({ length: ROWS }, () => COLUMNS);
    visibleContentBoundsByRow = Array.from(
      { length: ROWS },
      () => ({ x: 0, y: 0, width: BASE_FRAME_WIDTH, height: BASE_FRAME_HEIGHT })
    );
    state = "idle";
    stateOwner = "system";
    playMode = "loop";
    frameIndex = 0;
    frameAccum = 0;
    transientUntil = 0;
    mouseActionUntil = 0;
    agentActionUntil = 0;
    agentControlled = false;
    dragging = false;
    dragMoved = false;
    dragStartScreenX = 0;
    dragStartScreenY = 0;
    dragLastScreenX = 0;
    dragLastScreenY = 0;
    dragLastSampleAt = 0;
    dragWindowX = 0;
    dragWindowY = 0;
    dragVelocity = { x: 0, y: 0 };
    dragContentBounds = null;
    displays = [];
    /** 显示器布局变化前可复用，避免拖拽期间每帧重复进行 O(n²) 接缝扫描。 */
    displaySeams = [];
    dragDirection = "";
    dragAnimationBlocked = false;
    dragIdleTimer = 0;
    inertiaFrameId = null;
    inertiaStartedAt = 0;
    inertiaLastAt = 0;
    lastAppliedX = 0;
    lastAppliedY = 0;
    lastAppliedAt = 0;
    watchdogUntil = 0;
    watchdogMisses = 0;
    watchdogFrameId = null;
    dragCursorActive = false;
    dragCursorBefore = "";
    lastClickAt = 0;
    clickTimer = 0;
    bubbleText = "";
    bubbleUntil = 0;
    bubblePersistent = false;
    bubbleSessionId = null;
    bubbleAction = null;
    bubbleActionBounds = null;
    bubbleButtonPressed = null;
    bubbleButtonHover = null;
    bubblePlacement = "top-left";
    expandedHeight = 0;
    fixedPetCenterX = 240;
    /** 实际绘制锚点（窗口坐标）。窗口贴缝停靠时偏离 fixedPetCenterX 以保持宠物绝对位置不变。 */
    petAnchorX = 240;
    /** 贴缝滞回状态:宠物当前被按在哪条缝的哪一侧,完整越过缝才换边。 */
    seamHold = null;
    scale = 0.72;
    petName = "Pet";
    clickThrough = false;
    gameActive = false;
    gameDragging = false;
    gameDragStartScreenX = 0;
    gameDragStartScreenY = 0;
    gameDragWindowX = 0;
    gameDragWindowY = 0;
    transitionFromOpacity = 1;
    transitionToOpacity = 1;
    transitionFromScale = 1;
    transitionToScale = 1;
    transitionStartedAt = 0;
    transitionDurationMs = 0;
    strings = DEFAULT_CANVAS_STRINGS;
    game = new FlappyBirdGame(() => postToHost({
      type: "exitGame",
      x: window.screenX,
      y: window.screenY
    }), this.strings);
    hitCanvas;
    hitCtx = null;
    /** 当前动画帧的 alpha 蒙版；指针移动时直接查数组，避免同步 GPU 像素读取。 */
    hitAlpha = null;
    hitFrameRow = -1;
    hitFrameIndex = -1;
    contextMenu = new PetContextMenu(
      () => this.requestGameOpen(),
      () => postToHost({ type: "exitPet" }),
      this.strings
    );
    domPointerInstalled = false;
    /** DOM contextmenu 与 Canvas shell 右键事件去重，避免后者用不同坐标覆盖菜单位置。 */
    lastDomContextMenuAt = 0;
    applyStrings(strings) {
      this.strings = strings;
      this.game.setStrings(strings);
      this.contextMenu.setStrings(strings);
      if (this.error) this.error = strings.spriteLoadFailed;
    }
    init({ canvas, ctx2d, width, height, initialData }) {
      this.canvas = canvas;
      this.c = ctx2d;
      this.w = width;
      this.h = height;
      const data = initialData || {};
      this.applyStrings(data.strings || DEFAULT_CANVAS_STRINGS);
      const layout = data.layout || {};
      this.expandedHeight = typeof layout.expandedHeight === "number" ? layout.expandedHeight : height;
      this.fixedPetCenterX = typeof layout.petCenterX === "number" ? layout.petCenterX : 240;
      this.petAnchorX = this.fixedPetCenterX;
      this.refreshDisplays();
      this.clickThrough = data.initialClickThrough === true;
      this.gameActive = data.initialGameMode === true;
      const pet = data.pet || {};
      this.petName = pet.displayName || pet.name || data.petName || "Pet";
      this.scale = pet.finch && typeof pet.finch.scale === "number" ? pet.finch.scale : 0.72;
      this.setState(data.defaultState || "idle");
      if (data.message) this.say(data.message, 1800);
      this.image = new Image();
      this.image.onload = () => {
        if (!this.image) return;
        this.frameCounts = detectFrameCounts(this.image);
        this.visibleContentBoundsByRow = detectVisibleContentBoundsByRow(this.image, this.frameCounts);
        this.loaded = true;
        this.error = "";
        this.validateRestingPosition();
      };
      this.image.onerror = () => {
        this.error = this.strings.spriteLoadFailed;
      };
      this.image.src = data.spriteDataUrl || "";
      this.installDomPointerFallback();
      if (this.gameActive) {
        this.game.resize(this.w, this.h);
        this.game.reset();
        this.setPointerPassthrough(false);
      }
    }
    resize(width, height) {
      this.w = width;
      this.h = height;
      this.game.resize(width, height);
      this.frame(0);
    }
    cancelMouseAction() {
      if (this.clickTimer) {
        clearTimeout(this.clickTimer);
        this.clickTimer = 0;
      }
      this.lastClickAt = 0;
      this.mouseActionUntil = 0;
      this.clearDragIdleTimer();
      this.cancelInertia(false);
      this.restoreDragCursor();
      this.dragging = false;
      this.dragMoved = false;
      this.dragDirection = "";
      this.dragAnimationBlocked = false;
      this.dragContentBounds = null;
    }
    clearDragIdleTimer() {
      if (!this.dragIdleTimer) return;
      clearTimeout(this.dragIdleTimer);
      this.dragIdleTimer = 0;
    }
    /**
     * 把"虚拟居中窗口"x（宠物锚点在 fixedPetCenterX 的连续模型）映射为实际窗口摆放。
     * macOS 上窗口矩形只要横跨两块屏幕的接缝,Electron setPosition 就会随机错位,
     * 所以宠物靠近接缝时让窗口整体停靠在缝的一侧,由绘制锚点偏移保持宠物绝对位置
     * 不变;只有宠物本体真正横跨接缝的短暂行程内才允许窗口横跨。
     */
    resolveWindowPlacement(virtualX) {
      const width = this.w;
      if (!width) return { actualX: virtualX, anchorX: this.fixedPetCenterX };
      const spec = STATES[this.state] || STATES.idle;
      const info = this.currentPetDrawInfo(spec.row, this.frameCountForRow(spec.row), this.fixedPetCenterX);
      const petHalf = info.drawW / 2 + 16;
      const clampAnchor = (anchor) => Math.min(Math.max(anchor, petHalf), width - petHalf);
      const centerAbs = virtualX + this.fixedPetCenterX;
      for (const seam of this.displaySeams) {
        if (virtualX >= seam || virtualX + width <= seam) continue;
        let side = this.seamHold?.seam === seam ? this.seamHold.side : centerAbs >= seam ? "right" : "left";
        if (side === "left" && centerAbs - petHalf >= seam) side = "right";
        else if (side === "right" && centerAbs + petHalf <= seam) side = "left";
        this.seamHold = { seam, side };
        const actualX = side === "right" ? seam : seam - width;
        return { actualX, anchorX: clampAnchor(centerAbs - actualX) };
      }
      this.seamHold = null;
      return { actualX: virtualX, anchorX: this.fixedPetCenterX };
    }
    /**
     * 移窗并开启位置看门狗。x 为虚拟居中模型坐标,实际摆放经 resolveWindowPlacement
     * 贴缝停靠;锚点变化时同步重绘,保证宠物像素位置连续。看门狗在移窗后短时间内
     * 逐帧比对实际位置与模型(拖动中阈值宽、静止后收紧),偏差连续出现时重发纠正,
     * 兜底仍可能发生的 Electron 跨缝错位。
     */
    applyWindowPosition(x, y) {
      const { actualX, anchorX } = this.resolveWindowPlacement(x);
      const anchorChanged = anchorX !== this.petAnchorX;
      this.petAnchorX = anchorX;
      if (actualX !== this.lastAppliedX || y !== this.lastAppliedY) finch.window?.setPosition(actualX, y);
      this.lastAppliedX = actualX;
      this.lastAppliedY = y;
      this.lastAppliedAt = performance.now();
      this.watchdogUntil = this.lastAppliedAt + 800;
      this.ensurePositionWatchdog();
      if (anchorChanged) this.frame(0);
    }
    ensurePositionWatchdog() {
      if (this.watchdogFrameId !== null) return;
      const tick = () => {
        this.watchdogFrameId = null;
        const now = performance.now();
        if (now > this.watchdogUntil) {
          this.watchdogMisses = 0;
          return;
        }
        const quiet = now - this.lastAppliedAt > 250;
        const limitX = quiet ? 8 : 160;
        const limitY = quiet ? 8 : 80;
        const offX = Math.abs(window.screenX - this.lastAppliedX);
        const offY = Math.abs(window.screenY - this.lastAppliedY);
        if (offX > limitX || offY > limitY) {
          this.watchdogMisses += 1;
          if (this.watchdogMisses >= 2) {
            this.watchdogMisses = 0;
            finch.window?.setPosition(this.lastAppliedX, this.lastAppliedY);
          }
        } else {
          this.watchdogMisses = 0;
        }
        this.watchdogFrameId = requestAnimationFrame(tick);
      };
      this.watchdogFrameId = requestAnimationFrame(tick);
    }
    showDragCursor() {
      if (this.dragCursorActive) return;
      this.dragCursorBefore = this.canvas.style.cursor;
      this.canvas.style.cursor = "grabbing";
      this.dragCursorActive = true;
    }
    restoreDragCursor() {
      if (!this.dragCursorActive) return;
      this.canvas.style.cursor = this.dragCursorBefore;
      this.dragCursorBefore = "";
      this.dragCursorActive = false;
    }
    scheduleDragIdle() {
      this.clearDragIdleTimer();
      this.dragIdleTimer = setTimeout(() => {
        this.dragIdleTimer = 0;
        if (!this.dragging && this.inertiaFrameId === null || this.dragAnimationBlocked || this.isAgentAnimationActive()) return;
        this.dragDirection = "";
        if (this.stateOwner === "mouse") this.setState("idle", { source: "mouse" });
      }, 180);
    }
    setDragDirectionFromVelocity(velocityX) {
      if (this.dragAnimationBlocked || this.isAgentAnimationActive()) return;
      if (Math.abs(velocityX) < 0.04) {
        if (this.dragDirection) this.scheduleDragIdle();
        return;
      }
      this.clearDragIdleTimer();
      const direction = velocityX > 0 ? "right" : "left";
      if (direction === this.dragDirection) return;
      this.dragDirection = direction;
      this.setState(direction === "right" ? "running-right" : "running-left", { source: "mouse" });
    }
    updateDragPosition(e, now) {
      if (!this.dragging || typeof e.screenX !== "number" || typeof e.screenY !== "number") return;
      const pointer = { x: e.screenX, y: e.screenY };
      const pointerDelta = {
        x: pointer.x - this.dragLastScreenX,
        y: pointer.y - this.dragLastScreenY
      };
      const elapsed = now - this.dragLastSampleAt;
      const previousWindow = { x: this.dragWindowX, y: this.dragWindowY };
      const constrained = constrainWindowPosition(
        {
          x: previousWindow.x + pointerDelta.x,
          y: previousWindow.y + pointerDelta.y
        },
        this.dragContentBounds || this.currentDragContentBounds(),
        this.displays,
        previousWindow
      );
      this.dragWindowX = constrained.x;
      this.dragWindowY = constrained.y;
      this.dragLastScreenX = pointer.x;
      this.dragLastScreenY = pointer.y;
      this.dragLastSampleAt = now;
      const appliedDelta = {
        x: constrained.x - previousWindow.x,
        y: constrained.y - previousWindow.y
      };
      let velocity = smoothVelocity(this.dragVelocity, appliedDelta, elapsed);
      if (constrained.blockedX) velocity = { ...velocity, x: 0 };
      if (constrained.blockedY) velocity = { ...velocity, y: 0 };
      this.dragVelocity = velocity;
      if (appliedDelta.x || appliedDelta.y) {
        this.applyWindowPosition(constrained.x, constrained.y);
        if (this.bubbleText) this.updateBubblePlacement({ x: this.lastAppliedX, y: this.lastAppliedY });
      }
      const totalDx = pointer.x - this.dragStartScreenX;
      const totalDy = pointer.y - this.dragStartScreenY;
      if (!this.dragMoved && Math.hypot(totalDx, totalDy) > DRAG_THRESHOLD) {
        this.dragMoved = true;
        this.showDragCursor();
      }
      if (this.dragMoved) this.setDragDirectionFromVelocity(velocity.x);
    }
    startInertia(now) {
      if (!finch.window || typeof finch.window.setPosition !== "function") return false;
      this.dragVelocity = limitVelocity(this.dragVelocity);
      if (Math.hypot(this.dragVelocity.x, this.dragVelocity.y) < INERTIA_MIN_SPEED) return false;
      this.inertiaStartedAt = now;
      this.inertiaLastAt = now;
      const tick = (frameNow) => {
        if (this.inertiaFrameId === null) return;
        const elapsed = Math.min(32, Math.max(0, frameNow - this.inertiaLastAt));
        this.inertiaLastAt = frameNow;
        const previousWindow = { x: this.dragWindowX, y: this.dragWindowY };
        const constrained = constrainWindowPosition(
          {
            x: previousWindow.x + this.dragVelocity.x * elapsed,
            y: previousWindow.y + this.dragVelocity.y * elapsed
          },
          this.dragContentBounds || this.currentDragContentBounds(),
          this.displays,
          previousWindow
        );
        this.dragWindowX = constrained.x;
        this.dragWindowY = constrained.y;
        if (constrained.x !== previousWindow.x || constrained.y !== previousWindow.y) {
          this.applyWindowPosition(constrained.x, constrained.y);
          if (this.bubbleText) this.updateBubblePlacement({ x: this.lastAppliedX, y: this.lastAppliedY });
        }
        let velocity = decayVelocity(this.dragVelocity, elapsed);
        if (constrained.blockedX) velocity = { ...velocity, x: 0 };
        if (constrained.blockedY) velocity = { ...velocity, y: 0 };
        this.dragVelocity = velocity;
        this.setDragDirectionFromVelocity(velocity.x);
        const expired = frameNow - this.inertiaStartedAt >= INERTIA_MAX_DURATION_MS;
        const stopped = Math.hypot(velocity.x, velocity.y) < INERTIA_MIN_SPEED;
        if (expired || stopped) {
          this.cancelInertia(true);
          return;
        }
        this.inertiaFrameId = requestAnimationFrame(tick);
      };
      this.inertiaFrameId = requestAnimationFrame(tick);
      return true;
    }
    settleDragAnimation() {
      this.clearDragIdleTimer();
      const shouldReturnToIdle = !this.dragAnimationBlocked && !this.isAgentAnimationActive() && this.stateOwner === "mouse";
      this.dragMoved = false;
      this.dragDirection = "";
      this.dragAnimationBlocked = false;
      this.dragContentBounds = null;
      this.mouseActionUntil = 0;
      if (shouldReturnToIdle) this.setState("idle", { source: "mouse" });
    }
    cancelInertia(settle) {
      if (this.inertiaFrameId !== null) cancelAnimationFrame(this.inertiaFrameId);
      this.inertiaFrameId = null;
      this.inertiaStartedAt = 0;
      this.inertiaLastAt = 0;
      this.dragVelocity = { x: 0, y: 0 };
      if (settle) this.settleDragAnimation();
    }
    setState(next, opts) {
      const state = normalizeState(next);
      const source = opts && typeof opts.source === "string" ? opts.source : "system";
      const now = performance.now();
      if (source === "mouse" && this.isAgentAnimationActive(now)) return;
      if (source === "agent") this.cancelMouseAction();
      this.state = state;
      this.stateOwner = source;
      this.frameIndex = 0;
      this.frameAccum = 0;
      const transientMs = opts && typeof opts.transientMs === "number" ? opts.transientMs : 0;
      const reqMode = opts && (opts.playMode === "once" || opts.playMode === "freeze") ? opts.playMode : null;
      this.playMode = reqMode && state !== "idle" ? reqMode : "loop";
      const onceMs = this.playMode === "once" ? this.frameCountForRow((STATES[state] || STATES.idle).row) * (1e3 / FPS) : 0;
      this.transientUntil = transientMs > 0 ? now + transientMs : 0;
      if (source === "agent") {
        this.agentControlled = state !== "idle";
        this.agentActionUntil = state !== "idle" && transientMs > 0 ? now + transientMs : 0;
        this.mouseActionUntil = 0;
      } else if (source === "mouse") {
        this.mouseActionUntil = state !== "idle" ? now + (onceMs || transientMs || 0) : 0;
      } else if (state === "idle") {
        this.mouseActionUntil = 0;
        this.agentActionUntil = 0;
        this.agentControlled = false;
        this.playMode = "loop";
      }
    }
    isAgentAnimationActive(now) {
      if (!this.agentControlled || this.state === "idle") return false;
      if (!this.agentActionUntil) return true;
      return (typeof now === "number" ? now : performance.now()) < this.agentActionUntil;
    }
    isMouseActionActive(now) {
      if (this.dragging || this.inertiaFrameId !== null) return true;
      return this.mouseActionUntil > (typeof now === "number" ? now : performance.now());
    }
    canStartMouseAction(now) {
      const t = typeof now === "number" ? now : performance.now();
      return !this.isAgentAnimationActive(t) && !this.isMouseActionActive(t);
    }
    petConstraintBounds(state) {
      const spec = STATES[state] || STATES.idle;
      const info = this.currentPetDrawInfo(spec.row, this.frameCountForRow(spec.row), this.fixedPetCenterX);
      const visible = this.visibleContentBoundsByRow[spec.row] || { x: 0, y: 0, width: BASE_FRAME_WIDTH, height: BASE_FRAME_HEIGHT };
      return {
        x: info.x + visible.x / BASE_FRAME_WIDTH * info.drawW,
        y: info.y + visible.y / BASE_FRAME_HEIGHT * info.drawH,
        width: visible.width / BASE_FRAME_WIDTH * info.drawW,
        height: visible.height / BASE_FRAME_HEIGHT * info.drawH
      };
    }
    currentDragContentBounds() {
      const states = this.dragAnimationBlocked ? [this.state] : [this.state, "running-left", "running-right"];
      const bounds = states.map((state) => this.petConstraintBounds(state));
      const left = Math.min(...bounds.map((item) => item.x));
      const top = Math.min(...bounds.map((item) => item.y));
      const right2 = Math.max(...bounds.map((item) => item.x + item.width));
      const bottom2 = Math.max(...bounds.map((item) => item.y + item.height));
      return { x: left, y: top, width: right2 - left, height: bottom2 - top };
    }
    /**
     * 校验静止位置:约束只在拖拽/惯性期间生效,若窗口带着失效的持久化位置启动
     * (如旧版本把宠物留在了菜单栏上),这里做一次性吸附救援,把宠物主体拉回
     * 所有屏幕的联合可见区域内。
     */
    validateRestingPosition() {
      if (this.dragging || this.inertiaFrameId !== null) return;
      const virtualX = window.screenX + this.petAnchorX - this.fixedPetCenterX;
      const virtualY = window.screenY;
      this.refreshDisplays();
      const constrained = constrainWindowPosition(
        { x: virtualX, y: virtualY },
        this.currentDragContentBounds(),
        this.displays
      );
      if (constrained.x !== virtualX || constrained.y !== virtualY) {
        this.applyWindowPosition(constrained.x, constrained.y);
      }
    }
    refreshDisplays() {
      this.displays = this.readDisplays();
      this.displaySeams = verticalSeams(this.displays);
    }
    readDisplays() {
      const fromBridge = finch.window && typeof finch.window.getDisplays === "function" ? finch.window.getDisplays() : [];
      const valid = fromBridge.filter((display) => {
        const values = [
          display.bounds.x,
          display.bounds.y,
          display.bounds.width,
          display.bounds.height,
          display.workArea.x,
          display.workArea.y,
          display.workArea.width,
          display.workArea.height
        ];
        return values.every((value) => Number.isFinite(value)) && display.bounds.width > 0 && display.bounds.height > 0 && display.workArea.width > 0 && display.workArea.height > 0;
      });
      if (valid.length) return valid;
      const current = window.screen;
      const workX = typeof current.availLeft === "number" ? current.availLeft : 0;
      const workY = typeof current.availTop === "number" ? current.availTop : 0;
      const displayX = typeof current.left === "number" ? current.left : workX;
      const displayY = typeof current.top === "number" ? current.top : Math.min(0, workY);
      return [{
        id: "current",
        bounds: {
          x: displayX,
          y: displayY,
          width: current.width || window.innerWidth,
          height: current.height || window.innerHeight
        },
        workArea: {
          x: workX,
          y: workY,
          width: current.availWidth || current.width || window.innerWidth,
          height: current.availHeight || current.height || window.innerHeight
        }
      }];
    }
    updateBubblePlacement(windowPosition) {
      if (!this.bubbleText) return;
      const screenExtra = window.screen;
      const displayLeft = typeof screenExtra.left === "number" ? screenExtra.left : typeof screenExtra.availLeft === "number" ? screenExtra.availLeft : 0;
      const displayTop = typeof screenExtra.top === "number" ? screenExtra.top : typeof screenExtra.availTop === "number" ? screenExtra.availTop : 0;
      const displayWidth = Number.isFinite(screenExtra.width) ? screenExtra.width : window.innerWidth;
      const topBoundary = typeof screenExtra.availTop === "number" ? screenExtra.availTop : displayTop;
      const windowX = windowPosition?.x ?? window.screenX;
      const windowY = windowPosition?.y ?? window.screenY;
      const spec = STATES[this.state] || STATES.idle;
      const petInfo = this.currentPetDrawInfo(spec.row, this.frameCountForRow(spec.row));
      this.bubblePlacement = chooseBubblePlacement({
        current: this.bubblePlacement,
        petCenterX: windowX + petInfo.x + petInfo.drawW / 2,
        petTopY: windowY + petInfo.y,
        topBoundary,
        displayLeft,
        displayWidth
      });
    }
    say(text, transientMs, persistent, action, sessionId) {
      if (typeof text !== "string" || !text.trim()) return;
      this.bubbleText = text.trim().slice(0, 36);
      this.bubblePersistent = persistent === true;
      const candidate = action;
      this.bubbleAction = candidate && candidate.id === "open-session" && typeof candidate.sessionId === "string" ? candidate : null;
      this.updateBubblePlacement();
      this.bubbleSessionId = typeof sessionId === "string" ? sessionId : this.bubbleAction?.sessionId || null;
      const durationMs = typeof transientMs === "number" ? Math.max(5e3, transientMs) : 5e3;
      this.bubbleUntil = this.bubblePersistent ? 0 : performance.now() + durationMs;
    }
    clearBubble(preserveLayout) {
      this.bubbleText = "";
      this.bubbleUntil = 0;
      this.bubblePersistent = false;
      this.bubbleSessionId = null;
      this.bubbleAction = null;
      this.bubbleActionBounds = null;
      this.bubbleButtonPressed = null;
      this.bubbleButtonHover = null;
      if (preserveLayout !== true) this.bubblePlacement = "top-left";
    }
    frame(dt) {
      const now = performance.now();
      const transitionActive = this.transitionDurationMs > 0 && now - this.transitionStartedAt < this.transitionDurationMs;
      this.pendingFrameMs += dt;
      if (dt > 0 && !this.gameActive && !transitionActive && this.pendingFrameMs < PET_RENDER_INTERVAL_MS) return;
      const renderDt = this.pendingFrameMs;
      this.pendingFrameMs = 0;
      this.t += renderDt / 1e3;
      const c = this.c;
      c.clearRect(0, 0, this.w, this.h);
      const transitionProgress = this.transitionDurationMs > 0 ? Math.min(1, (now - this.transitionStartedAt) / this.transitionDurationMs) : 1;
      const eased = 1 - Math.pow(1 - transitionProgress, 3);
      const opacity = this.transitionFromOpacity + (this.transitionToOpacity - this.transitionFromOpacity) * eased;
      const visualScale = this.transitionFromScale + (this.transitionToScale - this.transitionFromScale) * eased;
      c.save();
      c.globalAlpha = Math.max(0, Math.min(1, opacity));
      c.translate(this.w / 2, this.h / 2);
      c.scale(visualScale, visualScale);
      c.translate(-this.w / 2, -this.h / 2);
      if (this.gameActive) {
        this.game.frame(c, renderDt);
        c.restore();
        return;
      }
      if (DEBUG_BACKGROUND) {
        c.save();
        c.fillStyle = "rgba(255, 0, 0, 0.28)";
        c.fillRect(0, 0, this.w, this.h);
        c.restore();
      }
      if (this.transientUntil && now > this.transientUntil)
        this.setState("idle", { source: this.stateOwner || "system" });
      if (!this.bubblePersistent && this.bubbleUntil && now > this.bubbleUntil) this.clearBubble();
      if (!this.loaded) {
        drawLoading(c, this.w, this.h, this.error || this.strings.loadingPet);
        c.restore();
        return;
      }
      const spec = STATES[this.state] || STATES.idle;
      const frameMs = 1e3 / FPS;
      const frameCount = this.frameCountForRow(spec.row);
      this.frameAccum += renderDt;
      while (this.frameAccum >= frameMs) {
        this.frameAccum -= frameMs;
        if (this.frameIndex >= frameCount - 1) {
          if (this.playMode === "once") {
            this.setState("idle", { source: this.stateOwner || "system" });
            break;
          }
          if (this.playMode === "freeze") break;
        }
        this.frameIndex = this.playMode === "loop" ? (this.frameIndex + 1) % frameCount : Math.min(this.frameIndex + 1, frameCount - 1);
      }
      const drawSpec = STATES[this.state] || STATES.idle;
      const drawInfo = this.currentPetDrawInfo(drawSpec.row, this.frameCountForRow(drawSpec.row));
      if (this.image) drawPetFrame(c, { image: this.image, ...drawInfo });
      this.drawBubble(drawInfo);
      c.restore();
    }
    frameCountForRow(row) {
      const index = Math.max(0, Math.min(ROWS - 1, row));
      const count = this.frameCounts && this.frameCounts[index];
      return Number.isFinite(count) && count > 0 ? Math.min(COLUMNS, Math.max(1, count)) : COLUMNS;
    }
    currentPetDrawInfo(row, frameCount, anchorX) {
      const safeFrameCount = frameCount || this.frameCountForRow(row);
      const safeFrameIndex = Math.min(this.frameIndex, safeFrameCount - 1);
      const frame = spriteFrameSize(this.image || {});
      const sx = safeFrameIndex * frame.width;
      const sy = Math.max(0, Math.min(ROWS - 1, row)) * frame.height;
      const maxPetW = this.w * 0.86;
      const maxPetH = this.expandedHeight * 0.78;
      const baseScale = Math.min(maxPetW / BASE_FRAME_WIDTH, maxPetH / BASE_FRAME_HEIGHT) * this.scale * PET_SIZE_RATIO;
      const jumpDenominator = Math.max(1, safeFrameCount - 1);
      const bounce = this.state === "jumping" ? Math.sin(safeFrameIndex / jumpDenominator * Math.PI) * 18 : 0;
      const breathe = this.state === "idle" ? Math.sin(this.t * 3) * 2 : 0;
      const drawW = BASE_FRAME_WIDTH * baseScale;
      const drawH = BASE_FRAME_HEIGHT * baseScale;
      const x = (anchorX ?? this.petAnchorX) - drawW / 2;
      const y = this.h - drawH - 14 - bounce + breathe;
      return { sx, sy, sourceW: frame.width, sourceH: frame.height, x, y, drawW, drawH, bounce };
    }
    drawBubble(petInfo) {
      if (!this.bubbleText || !petInfo) return;
      const c = this.c;
      c.save();
      const layout = layoutBubble({
        measure: c,
        text: this.bubbleText,
        placement: this.bubblePlacement,
        pet: petInfo,
        canvasWidth: this.w,
        canvasHeight: this.h,
        action: this.bubbleAction && this.bubbleAction.label ? { label: this.bubbleAction.label } : this.bubbleAction ? { label: "" } : null
      });
      c.restore();
      this.bubbleActionBounds = layout.action;
      paintBubble(c, layout, {
        hover: this.bubbleButtonHover === "action",
        pressed: this.bubbleButtonPressed === "action"
      });
    }
    bubbleButtonAtPoint(x, y) {
      if (!this.bubbleAction) return null;
      const bounds = this.bubbleActionBounds;
      const contains = !!bounds && x >= bounds.x && x <= bounds.x + bounds.width && y >= bounds.y && y <= bounds.y + bounds.height;
      return contains ? "action" : null;
    }
    isPointOnBubbleAction(x, y) {
      return !!this.bubbleButtonAtPoint(x, y);
    }
    isPointOnPet(x, y) {
      if (!this.loaded || !this.image) return false;
      const spec = STATES[this.state] || STATES.idle;
      const info = this.currentPetDrawInfo(spec.row, this.frameCountForRow(spec.row));
      if (x < info.x || x > info.x + info.drawW || y < info.y || y > info.y + info.drawH) return false;
      const localX = Math.floor((x - info.x) / info.drawW * BASE_FRAME_WIDTH);
      const localY = Math.floor((y - info.y) / info.drawH * BASE_FRAME_HEIGHT);
      if (localX < 0 || localX >= BASE_FRAME_WIDTH || localY < 0 || localY >= BASE_FRAME_HEIGHT) return false;
      try {
        if (!this.hitCanvas) {
          this.hitCanvas = document.createElement("canvas");
          this.hitCanvas.width = BASE_FRAME_WIDTH;
          this.hitCanvas.height = BASE_FRAME_HEIGHT;
          this.hitCtx = this.hitCanvas.getContext("2d", { willReadFrequently: true });
        }
        if (!this.hitCtx) return true;
        const row = Math.max(0, Math.min(ROWS - 1, spec.row));
        const frameIndex = Math.min(this.frameIndex, this.frameCountForRow(row) - 1);
        if (!this.hitAlpha || row !== this.hitFrameRow || frameIndex !== this.hitFrameIndex) {
          this.hitCtx.clearRect(0, 0, BASE_FRAME_WIDTH, BASE_FRAME_HEIGHT);
          this.hitCtx.drawImage(
            this.image,
            info.sx,
            info.sy,
            info.sourceW,
            info.sourceH,
            0,
            0,
            BASE_FRAME_WIDTH,
            BASE_FRAME_HEIGHT
          );
          this.hitAlpha = this.hitCtx.getImageData(0, 0, BASE_FRAME_WIDTH, BASE_FRAME_HEIGHT).data;
          this.hitFrameRow = row;
          this.hitFrameIndex = frameIndex;
        }
        return this.hitAlpha[(localY * BASE_FRAME_WIDTH + localX) * 4 + 3] > 8;
      } catch {
        return true;
      }
    }
    setPointerPassthrough(enabled) {
      if (this.clickThrough === enabled) return;
      this.clickThrough = enabled;
      if (finch.window && typeof finch.window.setClickThrough === "function")
        finch.window.setClickThrough(enabled);
      postToHost({ type: "hitTest", clickThrough: enabled });
    }
    updatePointerPassthrough(e) {
      if (!DEBUG_DYNAMIC_PASSTHROUGH) return;
      if (this.contextMenu.isOpen) {
        this.setPointerPassthrough(false);
        return;
      }
      if (this.dragging || this.inertiaFrameId !== null) {
        this.setPointerPassthrough(false);
        return;
      }
      this.setPointerPassthrough(
        !this.isPointOnPet(e.x, e.y) && !this.isPointOnBubbleAction(e.x, e.y)
      );
    }
    showContextMenu(x, y) {
      this.setPointerPassthrough(false);
      this.contextMenu.show(x, y);
    }
    requestGameOpen() {
      const originalX = window.screenX;
      const originalY = window.screenY;
      const centerX = originalX + this.w / 2;
      const centerY = originalY + this.h / 2;
      const displays = this.readDisplays();
      const display = displays.find(
        (item) => centerX >= item.bounds.x && centerX < item.bounds.x + item.bounds.width && centerY >= item.bounds.y && centerY < item.bounds.y + item.bounds.height
      ) || displays[0];
      const area = display?.workArea || {
        x: 0,
        y: 0,
        width: window.screen.availWidth,
        height: window.screen.availHeight
      };
      postToHost({
        type: "enterGame",
        originalX,
        originalY,
        centeredX: Math.round(area.x + (area.width - GAME_WINDOW_WIDTH) / 2),
        centeredY: Math.round(area.y + (area.height - GAME_WINDOW_HEIGHT) / 2)
      });
    }
    installDomPointerFallback() {
      if (this.domPointerInstalled) return;
      this.domPointerInstalled = true;
      const target = this.canvas || document.getElementById("finch-canvas") || window;
      const toPointer = (type, e) => ({
        type,
        x: typeof e.clientX === "number" ? e.clientX : 0,
        y: typeof e.clientY === "number" ? e.clientY : 0,
        screenX: typeof e.screenX === "number" ? e.screenX : void 0,
        screenY: typeof e.screenY === "number" ? e.screenY : void 0,
        button: typeof e.button === "number" ? e.button : 0
      });
      const send = (type, e) => {
        this.onPointer(toPointer(type, e));
      };
      target.addEventListener(
        "contextmenu",
        (e) => {
          const event = e;
          event.preventDefault();
          event.stopPropagation();
          if (this.isPointOnPet(event.clientX, event.clientY)) {
            this.lastDomContextMenuAt = performance.now();
            this.showContextMenu(event.clientX, event.clientY);
          }
        },
        true
      );
      target.addEventListener("pointerdown", (e) => {
        const pointer = e;
        if (this.gameActive && (this.game.isDragHandle(pointer.clientX, pointer.clientY) || this.game.isCloseButtonPoint(pointer.clientX, pointer.clientY))) {
          try {
            this.canvas.setPointerCapture(pointer.pointerId);
          } catch {
          }
        }
        send("down", pointer);
      }, true);
      target.addEventListener("pointermove", (e) => send("move", e), true);
      window.addEventListener("pointerup", (e) => {
        const pointer = e;
        try {
          if (this.canvas.hasPointerCapture(pointer.pointerId)) this.canvas.releasePointerCapture(pointer.pointerId);
        } catch {
        }
        send("up", pointer);
      }, true);
      window.addEventListener("blur", () => {
        this.gameDragging = false;
        if (this.gameActive) {
          this.canvas.style.cursor = "default";
          this.game.cancelPointer();
        }
        if (this.contextMenu.isOpen) {
          this.contextMenu.hide();
          this.setPointerPassthrough(true);
        }
      });
      window.addEventListener(
        "keydown",
        (e) => {
          if (this.gameActive && this.game.keyDown(e.key)) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          if (e.key === "Escape") this.contextMenu.hide();
        },
        true
      );
      if (!window.PointerEvent) {
        target.addEventListener("mousedown", (e) => send("down", e), true);
        window.addEventListener("mouseup", (e) => send("up", e), true);
      }
    }
    playSingleClick() {
      if (!this.canStartMouseAction()) return;
      this.setState("waving", { playMode: "once", source: "mouse" });
      postToHost({ type: "poke", state: this.state });
    }
    playDoubleClick() {
      if (this.bubbleSessionId) {
        postToHost({ type: "openBubbleSession", sessionId: this.bubbleSessionId });
        this.clearBubble();
        return;
      }
      if (!this.canStartMouseAction()) return;
      this.setState("jumping", { playMode: "once", source: "mouse" });
      postToHost({ type: "poke", state: this.state });
    }
    onPointer(e) {
      if (this.gameActive) {
        this.setPointerPassthrough(false);
        const screenX = typeof e.screenX === "number" ? e.screenX : window.screenX + e.x;
        const screenY = typeof e.screenY === "number" ? e.screenY : window.screenY + e.y;
        if (e.type === "down" && (e.button === void 0 || e.button === 0)) {
          if (this.game.isDragHandle(e.x, e.y)) {
            this.gameDragging = true;
            this.gameDragStartScreenX = screenX;
            this.gameDragStartScreenY = screenY;
            this.gameDragWindowX = window.screenX;
            this.gameDragWindowY = window.screenY;
            this.canvas.style.cursor = "grabbing";
          } else {
            this.game.pointerDown(e.x, e.y);
          }
        } else if (e.type === "move") {
          this.game.pointerMove(e.x, e.y);
          if (this.gameDragging) {
            finch.window?.setPosition(
              this.gameDragWindowX + screenX - this.gameDragStartScreenX,
              this.gameDragWindowY + screenY - this.gameDragStartScreenY
            );
            this.canvas.style.cursor = "grabbing";
          } else {
            this.canvas.style.cursor = this.game.cursorAt(e.x, e.y);
          }
        } else if (e.type === "up") {
          this.gameDragging = false;
          this.game.pointerUp(e.x, e.y);
          this.canvas.style.cursor = this.game.cursorAt(e.x, e.y);
        }
        return;
      }
      if (e.type === "move") this.updatePointerPassthrough(e);
      if (e.type === "down") {
        if (typeof e.button === "number" && e.button === 2) {
          if (performance.now() - this.lastDomContextMenuAt > 160 && this.isPointOnPet(e.x, e.y))
            this.showContextMenu(e.x, e.y);
          return;
        }
        this.contextMenu.hide();
        if (typeof e.button === "number" && e.button !== 0) return;
        if (this.inertiaFrameId !== null) this.cancelInertia(true);
        const bubbleButton = this.bubbleButtonAtPoint(e.x, e.y);
        if (bubbleButton) {
          this.bubbleButtonPressed = bubbleButton;
          this.setPointerPassthrough(false);
          return;
        }
        if (this.isMouseActionActive()) return;
        if (!this.isPointOnPet(e.x, e.y)) {
          this.setPointerPassthrough(true);
          return;
        }
        this.setPointerPassthrough(false);
        this.dragging = true;
        this.dragMoved = false;
        this.dragStartScreenX = typeof e.screenX === "number" ? e.screenX : window.screenX + e.x;
        this.dragStartScreenY = typeof e.screenY === "number" ? e.screenY : window.screenY + e.y;
        this.dragLastScreenX = this.dragStartScreenX;
        this.dragLastScreenY = this.dragStartScreenY;
        this.dragLastSampleAt = performance.now();
        this.dragWindowX = window.screenX + this.petAnchorX - this.fixedPetCenterX;
        this.dragWindowY = window.screenY;
        this.dragVelocity = { x: 0, y: 0 };
        this.dragDirection = "";
        this.dragAnimationBlocked = this.isAgentAnimationActive();
        this.dragContentBounds = this.currentDragContentBounds();
        this.refreshDisplays();
        this.clearDragIdleTimer();
        this.restoreDragCursor();
        return;
      }
      if (e.type === "move") {
        if (!this.dragging) {
          this.bubbleButtonHover = this.bubbleAction ? this.bubbleButtonAtPoint(e.x, e.y) : null;
          return;
        }
        this.contextMenu.hide();
        this.updateDragPosition(e, performance.now());
        return;
      }
      if (e.type === "up") {
        if (this.bubbleButtonPressed) {
          const pressedButton = this.bubbleButtonPressed;
          const shouldActivate = this.bubbleButtonAtPoint(e.x, e.y) === pressedButton;
          const action = this.bubbleAction;
          this.bubbleButtonPressed = null;
          if (shouldActivate && action) {
            postToHost({ type: "bubbleAction", action: action.id, sessionId: action.sessionId });
            this.clearBubble();
          }
          this.updatePointerPassthrough(e);
          return;
        }
        if (!this.dragging) return;
        const now = performance.now();
        this.updateDragPosition(e, now);
        this.dragging = false;
        this.clearDragIdleTimer();
        this.restoreDragCursor();
        if (this.dragMoved) {
          this.mouseActionUntil = 0;
          if (!this.startInertia(now)) this.settleDragAnimation();
          this.updatePointerPassthrough(e);
          return;
        }
        this.dragContentBounds = null;
        this.dragVelocity = { x: 0, y: 0 };
        this.updatePointerPassthrough(e);
        if ((this.dragAnimationBlocked || this.isAgentAnimationActive()) && !this.bubbleSessionId) {
          this.dragAnimationBlocked = false;
          return;
        }
        this.dragAnimationBlocked = false;
        if (this.clickTimer && now - this.lastClickAt <= 320) {
          clearTimeout(this.clickTimer);
          this.clickTimer = 0;
          this.lastClickAt = 0;
          this.playDoubleClick();
          return;
        }
        this.lastClickAt = now;
        this.clickTimer = setTimeout(() => {
          this.clickTimer = 0;
          this.playSingleClick();
        }, 260);
      }
    }
    onMessage(raw) {
      if (!isHostToCanvasMessage(raw)) return;
      const msg = raw;
      if (msg.type === "setState") {
        this.setState(msg.state, {
          transientMs: msg.transientMs,
          playMode: msg.playMode === "once" || msg.playMode === "freeze" ? msg.playMode : "loop",
          source: "agent"
        });
        if (msg.clearBubble) this.clearBubble(Boolean(msg.message));
        if (msg.message)
          this.say(msg.message, msg.transientMs || 2400, msg.persistent, msg.action, msg.sessionId);
      } else if (msg.type === "say") {
        this.say(msg.message, msg.transientMs || 2400, msg.persistent, msg.action, msg.sessionId);
      } else if (msg.type === "clearBubble") {
        this.clearBubble();
      } else if (msg.type === "config" && typeof msg.scale === "number") {
        this.scale = msg.scale;
      } else if (msg.type === "prepareGame") {
        this.requestGameOpen();
      } else if (msg.type === "locale") {
        this.applyStrings(msg.strings);
      } else if (msg.type === "visualTransition") {
        this.transitionFromOpacity = msg.fromOpacity;
        this.transitionToOpacity = msg.toOpacity;
        this.transitionFromScale = msg.fromScale;
        this.transitionToScale = msg.toScale;
        this.transitionStartedAt = performance.now();
        this.transitionDurationMs = Math.max(0, msg.durationMs);
      } else if (msg.type === "gameMode") {
        this.gameActive = msg.active;
        this.gameDragging = false;
        this.game.cancelPointer();
        this.canvas.style.cursor = "default";
        this.contextMenu.hide();
        this.setPointerPassthrough(false);
        if (msg.active) {
          this.cancelMouseAction();
          this.clearBubble();
          this.game.resize(this.w, this.h);
          this.game.reset();
        }
      }
    }
  };
  var app = new PetCanvasApp();
  finch.canvas.define({
    init: (args) => app.init(args),
    frame: (dt) => app.frame(dt),
    resize: (width, height) => app.resize(width, height),
    onPointer: (e) => app.onPointer(e),
    onMessage: (msg) => app.onMessage(msg)
  });
})();
