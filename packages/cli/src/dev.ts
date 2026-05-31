import chokidar from "chokidar";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, extname, resolve } from "node:path";

export interface DevOptions {
  dir: string;
  registryUrl: string;
}

const TEST_RE = /\.test\.(tsx|jsx|ts|js)$/;

function testPathFor(sourcePath: string): string {
  const ext = extname(sourcePath);
  return sourcePath.slice(0, -ext.length) + ".test" + ext;
}

export async function dev(opts: DevOptions): Promise<void> {
  const dir = resolve(opts.dir);
  const registryUrl = opts.registryUrl.replace(/\/$/, "");

  log(`watching ${dir}`);
  log(`registry ${registryUrl}`);

  // chokidar v4 dropped glob support: watch the directory recursively and
  // filter by extension ourselves in the upload handler.
  const watcher = chokidar.watch(dir, {
    ignoreInitial: false,
    ignored: (path) =>
      /(?:^|[\\/])(node_modules|\.git|dist)(?:[\\/]|$)/.test(path),
  });

  /**
   * Re-upload the component at `componentPath` along with its co-located
   * test file (if any). The registry rejects the push if no test is sent
   * and DYNAMICO_TEST_SKIP isn't set on the server, so we always include
   * the test when present.
   */
  const upload = async (componentPath: string) => {
    const ext = extname(componentPath);
    if (![".tsx", ".jsx", ".ts", ".js"].includes(ext)) return;
    const name = basename(componentPath, ext);
    try {
      const source = await readFile(componentPath, "utf8");
      const testPath = testPathFor(componentPath);
      let test: string | undefined;
      if (existsSync(testPath)) {
        try { test = await readFile(testPath, "utf8"); } catch { /* ignore */ }
      }
      const body: { name: string; source: string; test?: string } = { name, source };
      if (test !== undefined) body.test = test;
      const res = await fetch(`${registryUrl}/upload`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok && res.status !== 422) {
        log(`! ${name}: registry returned ${res.status}`);
        return;
      }
      const data = (await res.json()) as { version: string; error?: { kind: string; message: string } };
      if (data.error) {
        log(`x ${name}@${data.version} ${data.error.kind}: ${data.error.message}`);
      } else {
        log(`> ${name}@${data.version}${test === undefined ? "  (no test)" : ""}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`! ${name}: ${msg}`);
    }
  };

  /**
   * On any source change, route to the right thing:
   *   - Foo.tsx changed         -> upload Foo (with Foo.test.tsx if present)
   *   - Foo.test.tsx changed    -> upload Foo so the new test re-validates it
   */
  const onChange = async (file: string) => {
    if (TEST_RE.test(file)) {
      const componentPath = file.replace(TEST_RE, ".$1");
      if (existsSync(componentPath)) await upload(componentPath);
      else log(`! test file ${basename(file)} has no paired component; skipping`);
      return;
    }
    await upload(file);
  };

  watcher.on("add", onChange);
  watcher.on("change", onChange);
  watcher.on("error", (err) => log(`! watcher error: ${String(err)}`));
}

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[dynamico] ${msg}`);
}
