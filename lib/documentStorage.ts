import { del, put } from "@vercel/blob";

export type StoredDocument = { url: string; pathname: string };

export interface DocumentStorage {
  isConfigured(): boolean;
  put(pathname: string, file: File): Promise<StoredDocument>;
  delete(pathname: string): Promise<void>;
}

const vercelBlobStorage: DocumentStorage = {
  isConfigured: () => Boolean(process.env.BLOB_READ_WRITE_TOKEN),
  async put(pathname, file) {
    const blob = await put(pathname, file, { access: "public", addRandomSuffix: true });
    return { url: blob.url, pathname: blob.pathname };
  },
  async delete(pathname) {
    await del(pathname);
  },
};

let testStorage: DocumentStorage | null = null;

export function getDocumentStorage(): DocumentStorage {
  return testStorage ?? vercelBlobStorage;
}

export function setDocumentStorageForTests(storage: DocumentStorage | null): void {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DB_TESTS !== "1") {
    throw new Error("Document storage override is forbidden in production");
  }
  testStorage = storage;
}
