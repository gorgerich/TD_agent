import type { MutableRefObject } from "react";
import { commandIdFor, type ClientCommandIdentity } from "./clientCommandId";

export type RecoverableClientCommand = {
  signature: string;
  path: string;
  serializedBody: string | null;
  commandId: string;
};

export class ClientCommandRecoveryPendingError extends Error {
  constructor() {
    super("Сохранённую команду сначала нужно повторить с теми же данными");
    this.name = "ClientCommandRecoveryPendingError";
  }
}

export function commandEnvelopeFor(
  reference: MutableRefObject<ClientCommandIdentity | null>,
  input: { path: string; serializedBody: string | null },
  recovery: RecoverableClientCommand | null,
): RecoverableClientCommand {
  const signature = `${input.path}\n${input.serializedBody ?? ""}`;
  if (recovery) {
    if (recovery.signature !== signature) {
      throw new ClientCommandRecoveryPendingError();
    }
    return recovery;
  }

  return {
    signature,
    path: input.path,
    serializedBody: input.serializedBody,
    commandId: commandIdFor(reference, signature),
  };
}

export function isCaseProjectionRetry(status: number, code: string | undefined) {
  return status === 503 && code === "CASE_PROJECTION_RETRY";
}

export function shouldRetainCommandForRetry(status: number, code: string | undefined) {
  return isCaseProjectionRetry(status, code) || status >= 500;
}
