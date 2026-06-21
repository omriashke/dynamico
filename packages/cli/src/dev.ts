import chokidar from "chokidar";
import { readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

import { isComponentTestFilename } from "@omriashke/dynamico-core";

export interface DevOptions {
  dir: string;
  registryUrl: string;
}


export async function dev(opts: DevOptions): Promise<void> {
  const dir = resolve(opts.dir);
  const registryUrl = opts.registryUrl.replace(/\/$/, "");

  log(`watching ${dir}`);
  log(`registry ${registryUrl}`);

  const watcher = chokidar.watch(dir, {
    ignoreInitial: false,
    ignored: (path) =>
      /(?:^|[\\/])(node_modules|\.git|dist)(?:[\\/]|$)/.test(path),
  });

  const upload = async (componentPath: string) => {
    const ext = extname(componentPath);
    if (![".tsx", ".jsx", ".ts", ".js"].includes(ext)) return;
    const name = basename(componentPath, ext);
    try {
      const source = await readFile(componentPath, "utf8");
      const res = await fetch(`${registryUrl}/upload`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, source }),
      });
      if (!res.ok && res.status !== 422) {
        log(`! ${name}: registry returned ${res.status}`);
        return;
      }
      const data = (await res.json()) as { version: string; error?: { kind: string; message: string } };
      if (data.error) {
        log(`x ${name}@${data.version} ${data.error.kind}: ${data.error.message}`);
      } else {
        log(`> ${name}@${data.version}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`! ${name}: ${msg}`);
    }
  };

  const onChange = async (file: string) => {
    if (isComponentTestFilename(file)) return;
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
