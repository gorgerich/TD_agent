import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readSecureOperatorFile } from "../lib/secureOperatorFile";

test("secure operator file is read from one exact 0600 regular-file handle", async () => {
  const directory = await mkdtemp(join(tmpdir(), "td-agent-secure-file-"));
  try {
    const protectedPath = join(directory, "protected");
    await writeFile(protectedPath, "synthetic-one-time-grant\n", { mode: 0o600 });
    await chmod(protectedPath, 0o600);
    assert.equal(await readSecureOperatorFile(protectedPath, "Synthetic grant"), "synthetic-one-time-grant");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("secure operator file rejects permissive modes and symlink substitution", async () => {
  const directory = await mkdtemp(join(tmpdir(), "td-agent-secure-file-"));
  try {
    const protectedPath = join(directory, "protected");
    const permissivePath = join(directory, "permissive");
    const linkPath = join(directory, "link");
    await writeFile(protectedPath, "synthetic-one-time-grant", { mode: 0o600 });
    await chmod(protectedPath, 0o600);
    await writeFile(permissivePath, "synthetic-permissive", { mode: 0o644 });
    await chmod(permissivePath, 0o644);
    await symlink(protectedPath, linkPath);
    await assert.rejects(
      readSecureOperatorFile(permissivePath, "Synthetic grant"),
      /mode 0600/,
    );
    await assert.rejects(readSecureOperatorFile(linkPath, "Synthetic grant"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
