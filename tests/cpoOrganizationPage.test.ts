import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/platform-admin/organizations/[organizationId]/page.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture(existingId: string) {
  const queries: string[] = [];
  let authenticated = false;
  const exports: { default?: (props: { params: Promise<{ organizationId: string }> }) => Promise<unknown> } = {};
  const helpers = { PageHeader: () => null, Status: () => null, OrganizationStatusControl: () => null, FirstOrganizationAdminControl: () => null, OrganizationOnboardingControl: () => null, formatDate: () => "synthetic" };
  const organization = { id: existingId, name: "Synthetic organization", slug: "synthetic", timezone: "Europe/Moscow", status: "ACTIVE",
    createdAt: new Date(), memberships: [], auditEvents: [] };
  const mocks: Record<string, unknown> = {
    "react/jsx-runtime": require("react/jsx-runtime"),
    "next/navigation": { notFound: () => { throw Object.assign(new Error("SYNTHETIC_NOT_FOUND"), { status: 404 }); } },
    "@/lib/platformAuth": { requirePlatformAdmin: async () => { authenticated = true; } },
    "@/lib/prisma": { prisma: { organization: { findUnique: async ({ where }: { where: { id: string } }) => {
      assert.equal(authenticated, true); queries.push(where.id); return where.id === existingId ? organization : null;
    } }, platformAuditEvent: { findFirst: async () => null }, organizationInvite: { findFirst: async () => null }, platformOrganizationInvite: { findFirst: async () => null } } },
    "../../page": helpers, "../page": helpers, "./OrganizationStatusControl": helpers, "./FirstOrganizationAdminControl": helpers, "../OrganizationOnboardingControl": helpers,
  };
  vm.runInNewContext(compiled, { exports, module: { exports }, require: (name: string) => {
    assert.ok(Object.hasOwn(mocks, name), "Unexpected page dependency"); return mocks[name];
  } }, { filename: "cpo-organization-page-under-test.js" });
  assert.ok(exports.default);
  return { queries, render: (id: string) => exports.default!({ params: Promise.resolve({ organizationId: id }) }) };
}

test("CPO organization SSR page looks up the exact decoded colon ID for encoded and bare parameters", async () => {
  const id = "m3-uat:test:b";
  for (const routeId of [encodeURIComponent(id), id]) {
    const f = fixture(id);
    assert.ok(await f.render(routeId));
    assert.deepEqual(f.queries, [id]);
  }
});

test("CPO organization SSR page rejects malformed encoding before an organization lookup", async () => {
  for (const routeId of ["%", "%ZZ", "%E0%A4%A"]) {
    const f = fixture("m3-uat:test:b");
    await assert.rejects(f.render(routeId), { status: 404 });
    assert.deepEqual(f.queries, []);
  }
});

test("CPO organization SSR page decodes literal percent IDs exactly once without recursive/raw fallback", async () => {
  const literal = "literal%3Aorganization";
  const f = fixture(literal);
  assert.ok(await f.render(encodeURIComponent(literal)));
  assert.deepEqual(f.queries, [literal]);
  const canonical = fixture("m3-uat:test:b");
  const twiceEncoded = encodeURIComponent(encodeURIComponent("m3-uat:test:b"));
  await assert.rejects(canonical.render(twiceEncoded), { status: 404 });
  assert.deepEqual(canonical.queries, [encodeURIComponent("m3-uat:test:b")]);
});
