import { prisma } from "../../lib/prisma";
import { manageSmokeAccount, type SmokeAccountAction } from "../../lib/smokeAccount";

const ACTIONS = new Set<SmokeAccountAction>(["provision", "rotate", "disable", "enable", "status"]);

async function main() {
  const action = process.argv[2] as SmokeAccountAction | undefined;
  if (!action || !ACTIONS.has(action)) {
    throw new Error("Usage: npm run ops:smoke-account -- provision|rotate|disable|enable|status");
  }

  const audit = await manageSmokeAccount(prisma, {
    action,
    password: process.env.SMOKE_ACCOUNT_PASSWORD,
    newPassword: process.env.SMOKE_ACCOUNT_NEW_PASSWORD,
  });

  // Secret-free JSON is intended for release evidence capture.
  process.stdout.write(`${JSON.stringify(audit)}\n`);
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Smoke account operation failed"}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
