export async function fillProtected(locator, value) {
  try {
    await locator.fill(value);
  } catch {
    // Discard Playwright's original error, which can contain the filled value.
    throw new Error("E2E_PROTECTED_INPUT_FAILED");
  }
}

// Keep delayed awaits owned even when their triggering action fails first.
export function observeLegacyPromise(promise) {
  void promise.catch(() => {});
  return promise;
}

export function createLegacyAsyncScope(closeResources) {
  let failed = false;
  const pending = new Set();
  return {
    guard(callback) {
      return (...args) => {
        const task = (async () => {
          try {
            return await callback(...args);
          } catch {
            failed = true;
            // Release an intercepted request before closing the page that owns it.
            try { await args[0]?.abort?.("failed"); } catch { /* Already closed. */ }
            try { await closeResources(); } catch { /* The outer finally retries cleanup. */ }
          }
        })();
        pending.add(task);
        void task.then(() => pending.delete(task));
        return task;
      };
    },
    async settle() {
      while (pending.size) await Promise.all([...pending]);
      this.check();
    },
    check() {
      if (failed) throw new Error("E2E_LEGACY_ASYNC_FAILED");
    },
  };
}

export function legacySecretScreenshotOptions(page) {
  const fields = 'input[type="password"], input[autocomplete="one-time-code"], input[autocomplete="new-password"]';
  return {
    // Hide glyph/QR pixels outside their layout bounds as well as masking the bounds.
    style: `code, [role="img"][aria-label="QR-код для приложения-аутентификатора"], ${fields} { visibility: hidden !important; }`,
    mask: [
      page.locator("code"),
      page.getByRole("img", { name: "QR-код для приложения-аутентификатора" }),
      page.locator(fields),
    ],
  };
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
      const match = line.match(/(?:\/|\\)(m1-operations\.mjs|m2-admin\.mjs|m2-commercial\.mjs|m3-fulfilment\.mjs|real-organization\.mjs|protectedInput\.mjs):(\d{1,7}):(\d{1,7})\)?$/);
      if (match) { location = ` ${match[1]}:${match[2]}:${match[3]}`; break; }
    }
  } catch { /* Never expose untrusted diagnostics while reporting a failure. */ }
  return `E2E_LEGACY_FAILED${location}\n`;
}
