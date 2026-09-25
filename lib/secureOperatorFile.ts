import { constants } from "node:fs";
import { open } from "node:fs/promises";

/** Read one protected operator input without resolving its pathname twice. */
export async function readSecureOperatorFile(path: string, label: string): Promise<string> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) {
      throw new Error(`${label} must be a regular file with mode 0600`);
    }
    const value = (await handle.readFile({ encoding: "utf8" })).trim();
    if (!value) throw new Error(`${label} is empty`);
    return value;
  } finally {
    await handle.close();
  }
}
