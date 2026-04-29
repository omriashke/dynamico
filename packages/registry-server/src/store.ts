import type { CompiledModule, CompiledModuleRemoved } from "@omriaske/core";
import { createHash } from "node:crypto";

export type StoreListener = (module: CompiledModule) => void;

/** In-memory store of latest CompiledModule per name, with broadcast. */
export class Store {
  private modules = new Map<string, CompiledModule>();
  private listeners = new Set<StoreListener>();

  set(module: CompiledModule): CompiledModule {
    const prev = this.modules.get(module.name);
    if (prev && prev.version === module.version) return prev;
    this.modules.set(module.name, module);
    for (const l of this.listeners) l(module);
    return module;
  }

  /** Remove a component and broadcast a removal event. Returns the prior module if any. */
  remove(name: string): CompiledModule | undefined {
    const prev = this.modules.get(name);
    if (!prev) return undefined;
    this.modules.delete(name);
    const event: CompiledModuleRemoved = {
      name,
      version: createHash("sha256").update(`removed:${name}:${Date.now()}`).digest("hex").slice(0, 16),
      removed: true,
    };
    for (const l of this.listeners) l(event);
    return prev;
  }

  get(name: string): CompiledModule | undefined {
    return this.modules.get(name);
  }

  list(): CompiledModule[] {
    return [...this.modules.values()];
  }

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
