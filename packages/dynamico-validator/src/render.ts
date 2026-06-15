import * as React from "react";
import TestRenderer from "react-test-renderer";
import type { ReactTestInstance, ReactTestRenderer } from "react-test-renderer";
import { interactSmoke } from "./interactSmoke.js";
import { flush } from "./timing.js";

export interface RenderOptions {
  /**
   * Override or extend the auto-stubbed scope for this render. Keys are bare
   * specifiers that the component imports (e.g. '@newscast/app-hooks'); values
   * are the modules the component will receive when it require()s that key.
   */
  scope?: Record<string, unknown>;
  /**
   * After mount, walk the tree and fire onPress / onValueChange on interactive
   * nodes to surface handler-time runtime errors. Default true.
   */
  interact?: boolean;
}

export interface RenderResult {
  root: ReactTestInstance;
  renderer: ReactTestRenderer;
  update: (next: React.ReactElement) => Promise<void>;
  unmount: () => void;
  toJSON: () => unknown;
}

let lastRenderError: Error | null = null;

function assertNoRenderError(phase: string): void {
  if (lastRenderError) {
    const err = lastRenderError;
    lastRenderError = null;
    const wrapped = new Error(`${phase}: ${err.message}`);
    wrapped.stack = err.stack;
    throw wrapped;
  }
}

function captureReactRenderErrors<T>(fn: () => T): T {
  const errors: string[] = [];
  const origError = console.error;
  console.error = (...args: unknown[]) => {
    const msg = args.map((a) => (a instanceof Error ? a.message : String(a))).join(" ");
    if (
      msg.includes("An error occurred in the") ||
      msg.includes("ReferenceError") ||
      msg.includes("TypeError") ||
      msg.includes("is not defined")
    ) {
      errors.push(msg);
    }
    origError.apply(console, args as []);
  };
  try {
    return fn();
  } finally {
    console.error = origError;
    if (errors.length > 0 && !lastRenderError) {
      lastRenderError = new Error(errors[0]);
    }
  }
}

/**
 * Mount a component using react-test-renderer.
 *
 * React 19 logs render errors instead of throwing from TestRenderer.create.
 * We capture those console errors and fail the push gate. After mount, optional
 * interact smoke presses handlers to catch tap-time crashes.
 */
export async function render(
  element: React.ReactElement,
  opts: RenderOptions = {},
): Promise<RenderResult> {
  const shouldInteract = opts.interact !== false;
  let renderer!: ReactTestRenderer;

  captureReactRenderErrors(() => {
    TestRenderer.act(() => {
      renderer = TestRenderer.create(element);
    });
  });
  await flush();
  assertNoRenderError("render");

  const root = renderer.root;

  const result: RenderResult = {
    root,
    renderer,
    async update(next: React.ReactElement) {
      captureReactRenderErrors(() => {
        TestRenderer.act(() => {
          renderer.update(next);
        });
      });
      await flush();
      assertNoRenderError("render update");
    },
    unmount() {
      renderer.unmount();
    },
    toJSON() {
      return renderer.toJSON();
    },
  };

  if (shouldInteract) {
    captureReactRenderErrors(() => {
      interactSmoke(root);
    });
    await flush();
    assertNoRenderError("interact");
  }

  return result;
}
