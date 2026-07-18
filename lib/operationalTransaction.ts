import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function runOperationalTransaction<T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2034" || attempt === maxAttempts) {
        throw error;
      }
    }
  }
  throw new OperationalCommandError(409, "Конфликт параллельных изменений. Обновите данные и повторите действие.");
}

export class OperationalCommandError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 409 | 422,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "OperationalCommandError";
  }
}

