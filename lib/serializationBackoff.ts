import { setTimeout as delay } from "node:timers/promises";

const RETRY_BASE_DELAY_MS = 15;
const RETRY_MAX_DELAY_MS = 250;

/**
 * Full-jitter backoff before retrying a serialization failure (Prisma P2034).
 *
 * Retrying immediately puts the command back into the exact contention window it just
 * lost, so two commands can keep cancelling each other until the attempt budget runs out.
 * Sleeping a random slice of a growing ceiling decorrelates the retries; the ceiling stays
 * small enough that a request never waits noticeably longer than the work it is redoing.
 */
export async function backoffBeforeRetry(attempt: number): Promise<void> {
  const ceiling = Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), RETRY_MAX_DELAY_MS);
  await delay(Math.random() * ceiling);
}
