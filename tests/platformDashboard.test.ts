import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { MembershipRole } from "@prisma/client";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/platform-admin/page.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;

test("platform dashboard counts all five active roles only in active organizations, after authorization", async () => {
  let authenticated = false;
  const rows = Object.values(MembershipRole).flatMap((role) => [
    { role, status: "ACTIVE", organization: { status: "ACTIVE" } },
    { role, status: "ACTIVE", organization: { status: "SUSPENDED" } },
    { role, status: "SUSPENDED", organization: { status: "ACTIVE" } },
  ]);
  type Where = { status?: string; organization?: { status?: string } };
  const selected = (where: Where) => {
    assert.equal(authenticated, true);
    assert.equal(where.status, "ACTIVE");
    assert.equal(where.organization?.status, "ACTIVE", "role groups and employee count must use the same active organization scope");
    return rows.filter((row) => row.status === where.status && row.organization.status === where.organization?.status);
  };
  const exports: { default?: () => Promise<ReactNode> } = {};
  const mocks: Record<string, unknown> = {
    "react/jsx-runtime": require("react/jsx-runtime"),
    "next/link": { default: () => null },
    "@phosphor-icons/react/dist/ssr": { WarningCircle: () => null },
    "@prisma/client": { MembershipRole },
    "@/lib/platformAuth": { requirePlatformAdmin: async () => { authenticated = true; } },
    "@/lib/prisma": { prisma: {
      organization: { count: async () => 1, findMany: async () => [] },
      platformAuditEvent: { findMany: async () => [] },
      membership: {
        count: async ({ where }: { where: Where }) => selected(where).length,
        groupBy: async ({ where }: { where: Where }) => Object.values(MembershipRole).map((role) => ({ role, _count: { _all: selected(where).filter((row) => row.role === role).length } })),
      },
    } },
  };
  vm.runInNewContext(compiled, { exports, module: { exports }, require: (name: string) => {
    assert.ok(Object.hasOwn(mocks, name), "Unexpected page dependency");
    return mocks[name];
  } });
  assert.ok(exports.default);
  const html = renderToStaticMarkup(await exports.default());
  const metrics = html.match(/<article\b[^>]*>[\s\S]*?<\/article>/g) ?? [];
  assert.equal(metrics.length, 4);
  for (const label of ["Активные сотрудники", "Роли"]) {
    const metric = metrics.find((item) => item.includes(label));
    assert.ok(metric);
    assert.match(metric, />5<\/p>/);
  }
  const roleMetric = metrics.find((item) => item.includes(">Роли<"))!;
  for (const role of Object.values(MembershipRole)) assert.ok(roleMetric.includes(`1 ${role}`));
});
