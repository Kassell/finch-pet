import { isHostToCanvasMessage } from "../shared/protocol.js";
import { AppRegistry } from "./core/app-registry.js";
import { Game } from "./core/game.js";
import { DomInputAdapter } from "./input/dom-input.js";
import { FinchCanvasPlatform } from "./platform/canvas-platform.js";
import { FlappyBirdApp } from "./apps/flappy-bird/flappy-bird-app.js";
import { DEFAULT_CANVAS_STRINGS, PetScene, type PetInitialData } from "./pet/pet-scene.js";

const DEFAULT_APP_ID = "flappy-bird";
const game = new Game({ updatesPerSecond: 60 });
const apps = new AppRegistry();
const platform = new FinchCanvasPlatform();
let input: DomInputAdapter | undefined;

const post = (message: unknown): void => finch.postMessage(message);

game.register("pet", ({ viewport, initialData }) => new PetScene({ viewport, initialData, post, platform }));
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
    game.init(args, data.initialGameMode === true ? DEFAULT_APP_ID : "pet");
    input = new DomInputAdapter(game, args.canvas);
    input.attach();
  },
  frame: (dt) => game.frame(dt),
  resize: (width, height) => game.resize(width, height),
  onMessage: (raw) => {
    if (!isHostToCanvasMessage(raw)) return;
    if (raw.type === "gameMode") {
      game.switchScene(raw.active ? apps.require(raw.appId || DEFAULT_APP_ID) : "pet");
    }
    game.message(raw);
  },
  dispose: () => {
    input?.dispose();
    input = undefined;
    game.dispose();
  },
});
