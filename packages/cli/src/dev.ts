import chokidar from "chokidar";
import { readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

export interface DevOptions {
  dir: string;
  registryUrl: string;
}

export async function dev(opts: DevOptions): Promise<void> {
  const dir = resolve(opts.dir);
  const registryUrl = opts.registryUrl.replace(/\/$/, "");

  log(`watching ${dir}`);
  log(`registry ${registryUrl}`);

  const watcher = chokidar.watch(`${dir}/**/*.{tsx,jsx,ts,js}`, {
    ignoreInitial: false,
    ignored: ["**/node_modules/**", "**/.git/**", "**/dist/**"],
  });

  const upload = async (file: string) => {
    const ext = extname(file);
    if (![".tsx", ".jsx", ".ts", ".js"].includes(ext)) return;
    const name = basename(file, ext);
    try {
      const source = await readFile(file, "utf8");
      const res = await fetch(`${registryUrl}/upload`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, source }),
      });
      if (!res.ok) {
        log(`! ${name}: registry returned ${res.status}`);
        return;
      }
      const body = (await res.json()) as { version: string; error?: { message: string } };
      if (body.error) {
        log(`x ${name}@${body.version} compile error: ${body.error.message}`);
      } else {
        log(`> ${name}@${body.version}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`! ${name}: ${msg}`);
    }
  };

  watcher.on("add", upload);
  watcher.on("change", upload);
  watcher.on("error", (err) => log(`! watcher error: ${String(err)}`));
}

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[dynamico] ${msg}`);
}
