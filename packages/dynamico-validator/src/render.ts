import * as React from "react";
import TestRenderer from "react-test-renderer";
import type { ReactTestInstance, ReactTestRenderer } from "react-test-renderer";

export interface RenderOptions {
  /**
   * Override or extend the auto-stubbed scope for this render. Keys are bare
   * specifiers that the component imports (e.g. '@newscast/app-hooks'); values
   * are the modules the component will receive when it require()s that key.
   *
   * The runner already auto-stubs everything the component imports with empty
   * objects; use this to set specific return values (e.g. simulate
   * `useAuth() === { isAuthenticated: true }`).
   */
  scope?: Record<string, unknown>;
}

export interface RenderResult {
  root: ReactTestInstance;
  renderer: ReactTestRenderer;
  /** Re-render with new props. */
  update: (next: React.ReactElement) => void;
  /** Tear down. Tests don't usually need to call this; the runner does it. */
  unmount: () => void;
  /**
   * Convenience: get the rendered tree as a serializable JSON snapshot. Useful
   * when a test wants to assert on overall shape rather than poking specific
   * nodes.
   */
  toJSON: () => unknown;
}

/**
 * Mount a component using react-test-renderer.
 *
 * `.root` is a lazy getter so it is never accessed during construction —
 * React 19 production builds don't export `act`, and eagerly reading `.root`
 * before React has committed the tree throws "Can't access .root on unmounted
 * test renderer". Deferring the access to call-time (when the test actually
 * needs it) avoids the race.
 *
 * `RenderOptions.scope` is currently a hint surface only — the actual scope
 * is wired up by the runner before render() is called (see runTest.ts), so
 * passing scope here when calling render() directly in a test file is a no-op
 * unless the runner is honoring it. The runner DOES merge scope from the
 * second arg, so use it to control what hooks / modules the component sees.
 */
export function render(element: React.ReactElement, _opts: RenderOptions = {}): RenderResult {
  const renderer = TestRenderer.create(element);
  return {
    get root(): ReactTestInstance { return renderer.root; },
    renderer,
    update(next: React.ReactElement) {
      renderer.update(next);
    },
    unmount() {
      renderer.unmount();
    },
    toJSON() {
      return renderer.toJSON();
    },
  };
}
