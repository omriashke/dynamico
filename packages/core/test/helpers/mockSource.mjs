/** Shared mock Source for registry / registryModule tests. */
export function mockSource(modules = {}) {
  const listeners = new Set();
  const watchRefCounts = new Map();
  const watchReleases = [];

  return {
    modules,
    fetchCalls: [],
    watchCalls: [],
    async fetch(name) {
      this.fetchCalls.push(name);
      return (
        this.modules[name] ?? {
          name,
          version: "0",
          error: { kind: "compile", message: "missing" },
        }
      );
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    watch(name) {
      this.watchCalls.push(name);
      const next = (watchRefCounts.get(name) ?? 0) + 1;
      watchRefCounts.set(name, next);
      const release = () => {
        const count = (watchRefCounts.get(name) ?? 1) - 1;
        if (count <= 0) watchRefCounts.delete(name);
        else watchRefCounts.set(name, count);
      };
      watchReleases.push(release);
      return release;
    },
    push(module) {
      for (const l of listeners) l({ module });
    },
    watchRefCount(name) {
      return watchRefCounts.get(name) ?? 0;
    },
  };
}
