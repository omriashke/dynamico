import type { CompiledModule } from "@dynamico/core";

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
