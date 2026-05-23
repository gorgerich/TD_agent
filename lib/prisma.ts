import { PrismaClient } from "@prisma/client";

// Singleton, чтобы dev-hot-reload не плодил коннекты к общей с B2C БД.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
