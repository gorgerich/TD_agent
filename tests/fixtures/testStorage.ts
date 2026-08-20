import type {
  DocumentStorage,
  PrivateDocumentRead,
  StoredPrivateDocument,
} from "../../lib/documentStorage";

export class InMemoryTestStorage implements DocumentStorage {
  private readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

  isConfigured() {
    return true;
  }

  async putPrivate(storageKey: string, file: File): Promise<StoredPrivateDocument> {
    if (this.objects.has(storageKey)) throw new Error(`duplicate test storage key: ${storageKey}`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    this.objects.set(storageKey, { bytes: bytes.slice(), contentType: file.type });
    return { storageKey };
  }

  async readPrivate(storageKey: string): Promise<PrivateDocumentRead | null> {
    const object = this.objects.get(storageKey);
    if (!object) return null;
    const copy = object.bytes.slice();
    return {
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(copy);
          controller.close();
        },
      }),
      contentType: object.contentType,
      size: copy.byteLength,
      etag: `test-${copy.byteLength}`,
    };
  }

  async discardUncommitted(storageKey: string) {
    this.objects.delete(storageKey);
  }

  putBytes(key: string, value: Uint8Array, contentType = "application/pdf") {
    if (this.objects.has(key)) throw new Error(`duplicate test storage key: ${key}`);
    this.objects.set(key, { bytes: value.slice(), contentType });
    return { key, checksumInput: Array.from(value) };
  }

  replaceBytes(key: string, value: Uint8Array, contentType = "application/pdf") {
    if (!this.objects.has(key)) throw new Error(`test storage key missing: ${key}`);
    this.objects.set(key, { bytes: value.slice(), contentType });
  }

  get(key: string) {
    return this.objects.get(key)?.bytes.slice() ?? null;
  }

  get size() {
    return this.objects.size;
  }

  clear() {
    this.objects.clear();
  }
}
