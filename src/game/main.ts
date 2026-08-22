import { isHostToCanvasMessage } from "../shared/protocol.js";
import { AppRegistry } from "./core/app-registry.js";
import { Game } from "./core/game.js";
import { DomInputAdapter } from "./input/dom-input.js";
import { FinchCanvasPlatform } from "./platform/canvas-platform.js";
import { FlappyBirdApp } from "./apps/flappy-bird/flappy-bird-app.js";
import { DEFAULT_CANVAS_STRINGS, PetScene, type PetInitialData } from "./pet/pet-scene.js";

const DEFAULT_APP_ID = "flappy-bird";
const THUMBNAIL_RENDERER_APP_ID = "thumbnail-renderer";
const game = new Game({ updatesPerSecond: 60 });
const apps = new AppRegistry();
const platform = new FinchCanvasPlatform();
let input: DomInputAdapter | undefined;
let canvasElement: HTMLCanvasElement | undefined;

const post = (message: unknown): void => finch.postMessage(message);

const focusInteractiveWindow = (): void => {
  requestAnimationFrame(() => {
    window.focus();
    canvasElement?.focus({ preventScroll: true });
  });
};

const renderCatalogThumbnail = (requestId: string, dataUrl: string): void => {
  const image = new Image();
  image.onload = () => {
    try {
      const frameHeight = Math.max(1, image.naturalHeight);
      const frameWidth = Math.max(1, Math.min(image.naturalWidth, Math.round(frameHeight * (192 / 208))));
      const canvas = document.createElement("canvas");
      canvas.width = frameWidth;
      canvas.height = frameHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("2D canvas is unavailable");
      context.imageSmoothingEnabled = false;
      context.clearRect(0, 0, frameWidth, frameHeight);
      context.drawImage(image, 0, 0, frameWidth, frameHeight, 0, 0, frameWidth, frameHeight);
      const png = canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
      post({ type: "catalogThumbnailRendered", requestId, data: png });
    } catch (error) {
      post({ type: "catalogThumbnailRendered", requestId, error: error instanceof Error ? error.message : String(error) });
    }
  };
  image.onerror = () => post({ type: "catalogThumbnailRendered", requestId, error: "Failed to decode Petdex preview" });
  image.src = dataUrl;
};

game.register("pet", ({ viewport, initialData }) => new PetScene({ viewport, initialData, post, platform }));
apps.register({
  id: THUMBNAIL_RENDERER_APP_ID,
  create: ({ viewport }) => ({
    id: THUMBNAIL_RENDERER_APP_ID,
    enter: () => undefined,
    exit: () => undefined,
    resize: () => undefined,
    update: () => undefined,
    render: () => viewport.context.clearRect(0, 0, viewport.width, viewport.height),
    pointer: () => undefined,
    message: () => undefined,
    dispose: () => undefined,
  }),
});
apps.register({
  id: DEFAULT_APP_ID,
  create: ({ viewport, initialData }) => {
    const data = (initialData || {}) as PetInitialData;
    return new FlappyBirdApp({
      viewport,
      strings: data.strings || DEFAULT_CANVAS_STRINGS,
      post,
      platform,
    });
  },
});
apps.install(game);

/** Runtime 组合根：Pet 与当前 App 互斥，App 可被直接启动。 */
finch.canvas.define({
  init: (args) => {
    const data = (args.initialData || {}) as PetInitialData;
    const initialScene = data.initialAppId
      ? apps.require(data.initialAppId)
      : data.initialGameMode === true ? DEFAULT_APP_ID : "pet";
    game.init(args, initialScene);
    canvasElement = args.canvas;
    canvasElement.tabIndex = -1;
    canvasElement.style.outline = "none";
    input = new DomInputAdapter(game, args.canvas);
    input.attach();
  },
  frame: (dt) => game.frame(dt),
  resize: (width, height) => game.resize(width, height),
  onMessage: (raw) => {
    if (!isHostToCanvasMessage(raw)) return;
    if (raw.type === "renderCatalogThumbnail") {
      renderCatalogThumbnail(raw.requestId, raw.dataUrl);
      return;
    }
    if (raw.type === "focusWindow") {
      focusInteractiveWindow();
      return;
    }
    if (raw.type === "requestWindowPosition") {
      post({ type: "windowPositionSnapshot", requestId: raw.requestId, x: window.screenX, y: window.screenY });
      return;
    }
    if (raw.type === "gameMode") {
      game.switchScene(raw.active ? apps.require(raw.appId || DEFAULT_APP_ID) : "pet");
    }
    game.message(raw);
  },
  dispose: () => {
    input?.dispose();
    input = undefined;
    canvasElement = undefined;
    game.dispose();
  },
});
