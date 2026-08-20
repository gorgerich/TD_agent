import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { backoffBeforeRetry } from "@/lib/serializationBackoff";

export async function runOperationalTransaction<T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>,
  options: number | {
    maxAttempts?: number;
    isolationLevel?: Prisma.TransactionIsolationLevel;
  } = {},
): Promise<T> {
  const maxAttempts = typeof options === "number" ? options : options.maxAttempts ?? 3;
  const isolationLevel = typeof options === "number"
    ? Prisma.TransactionIsolationLevel.Serializable
    : options.isolationLevel ?? Prisma.TransactionIsolationLevel.Serializable;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel,
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2034") {
        throw error;
      }
      if (attempt === maxAttempts) {
        throw new OperationalCommandError(409, "Конфликт параллельных изменений. Обновите данные и повторите действие.");
      }
      await backoffBeforeRetry(attempt);
    }
  }
  throw new OperationalCommandError(409, "Команда не была выполнена после повторных попыток.");
}

export class OperationalCommandError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 409 | 422 | 503,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "OperationalCommandError";
  }
}
