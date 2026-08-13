import type { SceneFactory } from "./game.js";
import { Game } from "./game.js";

export interface AppDefinition {
  readonly id: string;
  readonly create: SceneFactory;
}

/** 内置 App 注册表；Pet 不属于 App，Runtime 保证 Pet 与当前 App 互斥。 */
export class AppRegistry {
  private readonly apps = new Map<string, AppDefinition>();

  register(definition: AppDefinition): this {
    const id = definition.id.trim();
    if (!id) throw new Error("app id is required");
    if (id === "pet") throw new Error("pet is a runtime scene, not an app");
    if (this.apps.has(id)) throw new Error(`app is already registered: ${id}`);
    this.apps.set(id, definition);
    return this;
  }

  install(game: Game): void {
    for (const app of this.apps.values()) game.register(app.id, app.create);
  }

  has(id: string): boolean { return this.apps.has(id); }

  require(id: string): string {
    if (!this.has(id)) throw new Error(`app is not registered: ${id}`);
    return id;
  }
}
