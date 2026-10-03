export type DocumentScanInput = {
  storageKey: string;
  bytes: Uint8Array;
  checksum: string;
  mimeType: string;
};

export type DocumentScanResult = {
  status: "CLEAN" | "INFECTED" | "ERROR";
  provider: string;
  resultCode: string;
};

export interface DocumentScanner {
  isOperational(): boolean;
  scan(input: DocumentScanInput): Promise<DocumentScanResult>;
}

const failClosedScanner: DocumentScanner = {
  isOperational: () => false,
  async scan() {
    return { status: "ERROR", provider: "unconfigured", resultCode: "PROVIDER_REQUIRED" };
  },
};

const syntheticPreviewScanner: DocumentScanner = {
  isOperational: () => true,
  async scan(input) {
    const sample = new TextDecoder().decode(input.bytes.slice(0, 8_192));
    if (sample.includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE")) {
      return { status: "INFECTED", provider: "synthetic-preview-scanner", resultCode: "EICAR_TEST_SIGNATURE" };
    }
    return { status: "CLEAN", provider: "synthetic-preview-scanner", resultCode: "SYNTHETIC_CLEAN" };
  },
};

let testScanner: DocumentScanner | null = null;

export function getDocumentScanner(): DocumentScanner {
  if (testScanner) return testScanner;
  const approvedLocal = process.env.NODE_ENV !== "production" && process.env.ALLOW_DB_TESTS === "1";
  const isolatedPreview = process.env.VERCEL_ENV === "preview" && process.env.PREVIEW_DB_ISOLATION === "PASS";
  if ((approvedLocal || isolatedPreview) && process.env.M3_DOCUMENT_SCANNER === "synthetic-preview") {
    return syntheticPreviewScanner;
  }
  return failClosedScanner;
}

export function setDocumentScannerForTests(scanner: DocumentScanner | null): void {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DB_TESTS !== "1") {
    throw new Error("Document scanner override is forbidden in production");
  }
  testScanner = scanner;
}
