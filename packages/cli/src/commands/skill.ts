import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { flagBool, flagString } from "../args.js";
import { emit, fail } from "../output.js";

export interface SkillArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

/**
 * `dynamico skill install [--target <dir>] [--force]`
 *
 * Copies the bundled SKILL.md (shipped inside the @omriaske/cli npm package)
 * into a Cursor skill directory. Default target is the user's personal
 * skills folder: `~/.cursor/skills/dynamico/`.
 *
 * After running this once, the agent gets concise instructions for using the
 * Dynamico CLI in every subsequent chat — no setup, no config file editing.
 *
 * Flags:
 *   --target <dir>  Override the destination skill directory. Useful for
 *                   project-scoped skills (e.g. --target .cursor/skills/dynamico).
 *   --force         Overwrite an existing SKILL.md without prompting.
 *   --json          Emit machine-readable result.
 */
export async function skill(args: SkillArgs): Promise<void> {
  const sub = args.positional[0];
  const json = flagBool(args.flags, "json");

  if (sub !== "install") {
    fail(
      json,
      { error: "unknown subcommand", usage: "dynamico skill install [--target <dir>] [--force]" },
      [`error: unknown skill subcommand '${sub ?? ""}'`, "usage: dynamico skill install [--target <dir>] [--force]"],
    );
  }

  const target = flagString(args.flags, "target") ?? join(homedir(), ".cursor", "skills", "dynamico");
  const force = flagBool(args.flags, "force");
  const source = locateSkillSource();

  if (!source) {
    fail(
      json,
      { error: "could not locate bundled SKILL.md inside the @omriaske/cli package" },
      [
        "error: could not locate bundled SKILL.md",
        "this usually means the cli was invoked without its shipped 'skill/' directory.",
        "reinstall with: npm install -g @omriaske/cli",
      ],
    );
  }

  const destDir = resolve(target);
  const destFile = join(destDir, "SKILL.md");

  if (existsSync(destFile) && !force) {
    fail(
      json,
      { error: "SKILL.md already exists", path: destFile, hint: "pass --force to overwrite" },
      [`error: ${destFile} already exists`, "pass --force to overwrite"],
      1,
    );
  }

  await mkdir(destDir, { recursive: true });
  await copyTree(source, destDir);

  emit(
    json,
    { installed: true, source, target: destDir },
    [
      `installed dynamico skill -> ${destDir}`,
      `restart Cursor (or reload the window) if the skill doesn't appear right away.`,
    ],
  );
}

/**
 * Walk up from this file to find the shipped `skill/` directory. When the CLI
 * is installed via npm, dist/commands/skill.js lives under
 * `<pkg>/dist/commands/skill.js` and the skill folder is at `<pkg>/skill/`.
 */
function locateSkillSource(): string | null {
  const here = fileURLToPath(import.meta.url);
  let dir = dirname(here);
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, "skill");
    if (existsSync(join(candidate, "SKILL.md"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Recursively copy every file under `src` into `dst`, preserving layout. */
async function copyTree(src: string, dst: string): Promise<void> {
  const entries = await readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = join(src, e.name);
    const d = join(dst, e.name);
    if (e.isDirectory()) {
      await mkdir(d, { recursive: true });
      await copyTree(s, d);
    } else if (e.isFile()) {
      await copyFile(s, d);
    } else {
      const info = await stat(s);
      if (info.isFile()) await copyFile(s, d);
    }
  }
}
