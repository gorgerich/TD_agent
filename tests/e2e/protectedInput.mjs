export async function fillProtected(locator, value) {
  try {
    await locator.fill(value);
  } catch {
    // Discard Playwright's original error, which can contain the filled value.
    throw new Error("E2E_PROTECTED_INPUT_FAILED");
  }
}

export function sanitizedCpoFailure(error) {
  let location = "";
  try {
    const stack = error instanceof Error && typeof error.stack === "string" ? error.stack : "";
    for (const line of stack.split("\n").slice(1)) {
      const match = line.match(/(?:\/|\\)(cpo-repair\.mjs|protectedInput\.mjs):(\d+):(\d+)\)?$/);
      if (match) { location = ` ${match[1]}:${match[2]}:${match[3]}`; break; }
    }
  } catch { /* Untrusted diagnostics must never replace the static failure. */ }
  return `E2E_CPO_REPAIR_FAILED${location}\n`;
}

export function sanitizedLegacyFailure(error) {
  let location = "";
  try {
    const stack = error instanceof Error && typeof error.stack === "string" ? error.stack : "";
    for (const line of stack.split("\n").slice(1)) {
      const match = line.match(/(?:\/|\\)(m1-operations\.mjs|m2-admin\.mjs|m2-commercial\.mjs|m3-fulfilment\.mjs|protectedInput\.mjs):(\d{1,7}):(\d{1,7})\)?$/);
      if (match) { location = ` ${match[1]}:${match[2]}:${match[3]}`; break; }
    }
  } catch { /* Never expose untrusted diagnostics while reporting a failure. */ }
  return `E2E_LEGACY_FAILED${location}\n`;
}
