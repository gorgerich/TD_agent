import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { del, get, put } from "@vercel/blob";

const ISOLATED_STORAGE_ROOT = path.join(process.cwd(), ".m3-private-storage");

export type StoredPrivateDocument = { storageKey: string; etag: string };

export type PrivateDocumentRead = {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  size: number;
  etag: string;
};

export interface DocumentStorage {
  isConfigured(): boolean;
  putPrivate(storageKey: string, file: File): Promise<StoredPrivateDocument>;
  readPrivate(storageKey: string): Promise<PrivateDocumentRead | null>;
  discardUncommitted(storageKey: string): Promise<void>;
}

const vercelBlobStorage: DocumentStorage = {
  isConfigured: () => Boolean(
    process.env.BLOB_READ_WRITE_TOKEN
      || (process.env.BLOB_STORE_ID && process.env.VERCEL_OIDC_TOKEN),
  ),
  async putPrivate(storageKey, file) {
    const blob = await put(storageKey, file, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: file.type,
    });
    return { storageKey: blob.pathname, etag: blob.etag };
  },
  async readPrivate(storageKey) {
    const blob = await get(storageKey, { access: "private", useCache: false });
    if (!blob || blob.statusCode !== 200) return null;
    return {
      stream: blob.stream,
      contentType: blob.blob.contentType,
      size: blob.blob.size,
      etag: blob.blob.etag,
    };
  },
  async discardUncommitted(storageKey) {
    await del(storageKey);
  },
};

const isolatedFilesystemStorage: DocumentStorage = {
  isConfigured: () => isolatedFilesystemRoot() !== null,
  async putPrivate(storageKey, file) {
    const target = isolatedStoragePath(storageKey);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
    return { storageKey, etag: createHash("sha256").update(bytes).digest("hex") };
  },
  async readPrivate(storageKey) {
    try {
      const bytes = await readFile(isolatedStoragePath(storageKey));
      return {
        stream: new Blob([bytes]).stream(),
        contentType: "application/octet-stream",
        size: bytes.byteLength,
        etag: createHash("sha256").update(bytes).digest("hex"),
      };
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw error;
    }
  },
  async discardUncommitted(storageKey) {
    await rm(isolatedStoragePath(storageKey), { force: true });
  },
};

let testStorage: DocumentStorage | null = null;

export function getDocumentStorage(): DocumentStorage {
  if (testStorage) return testStorage;
  if (process.env.M3_DOCUMENT_STORAGE === "isolated-filesystem") return isolatedFilesystemStorage;
  return vercelBlobStorage;
}

export function setDocumentStorageForTests(storage: DocumentStorage | null): void {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DB_TESTS !== "1") {
    throw new Error("Document storage override is forbidden in production");
  }
  testStorage = storage;
}

function isolatedFilesystemRoot(): string | null {
  if (process.env.M3_DOCUMENT_STORAGE !== "isolated-filesystem") return null;
  const isolatedTarget = process.env.PREVIEW_DB_ISOLATION === "PASS";
  const allowedRuntime = process.env.VERCEL_ENV === "preview" || process.env.ALLOW_DB_TESTS === "1";
  if (!isolatedTarget || !allowedRuntime) return null;
  return ISOLATED_STORAGE_ROOT;
}

function isolatedStoragePath(storageKey: string): string {
  const root = isolatedFilesystemRoot();
  if (!root) throw new Error("Isolated document storage is not safely configured");
  const target = path.resolve(root, storageKey);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error("Document storage key escapes isolated root");
  }
  return target;
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
