import { chromium } from "playwright";
import assert from "node:assert/strict";

const baseUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3001";
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const response = await page.goto(`${baseUrl}/agent/login`, { waitUntil: "networkidle" });
  assert.ok(response?.ok(), `login page returned ${response?.status()}`);
  await page.getByRole("heading", { name: /Войти в кабинет|Создать профиль агента/ }).waitFor();
  await page.locator('form button[type="submit"]').waitFor();
} finally {
  await browser.close();
}
