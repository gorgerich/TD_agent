import type { DocumentStorage, StoredDocument } from "../../lib/documentStorage";

export class InMemoryTestStorage implements DocumentStorage {
  private readonly objects = new Map<string, Uint8Array>();

  isConfigured() {
    return true;
  }

  async put(pathname: string, file: File): Promise<StoredDocument> {
    const value = new Uint8Array(await file.arrayBuffer());
    this.putBytes(pathname, value);
    return { pathname, url: `memory:///${pathname}` };
  }

  async delete(pathname: string) {
    this.objects.delete(pathname);
  }

  putBytes(key: string, value: Uint8Array) {
    if (this.objects.has(key)) throw new Error(`duplicate test storage key: ${key}`);
    this.objects.set(key, value.slice());
    return { key, checksumInput: Array.from(value) };
  }

  get(key: string) {
    return this.objects.get(key)?.slice() ?? null;
  }

  get size() {
    return this.objects.size;
  }

  clear() {
    this.objects.clear();
  }
}
