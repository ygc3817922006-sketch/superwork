import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { cloneDefaultSettings, sanitizeSettings } from "./config.js";

export const DEFAULT_SETTINGS_PATH = "/Users/yu/.dsh/profiles/desktop/superwork/settings.json";

export function createSettingsStore(options = {}) {
  const path = options.path ?? DEFAULT_SETTINGS_PATH;
  let queue = Promise.resolve();

  async function read() {
    try {
      return sanitizeSettings(JSON.parse(await readFile(path, "utf8")));
    } catch (error) {
      if (error?.code === "ENOENT") return cloneDefaultSettings();
      throw error;
    }
  }

  async function write(value) {
    const next = sanitizeSettings(value);
    queue = queue.then(async () => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(next, null, 2) + "\n", "utf8");
    });
    await queue;
    return next;
  }

  return { path, read, write };
}
