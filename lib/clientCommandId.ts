import type { MutableRefObject } from "react";

export type ClientCommandIdentity = {
  signature: string;
  id: string;
};

export function commandIdFor(
  reference: MutableRefObject<ClientCommandIdentity | null>,
  signature: string,
) {
  if (!reference.current || reference.current.signature !== signature) {
    reference.current = { signature, id: crypto.randomUUID() };
  }
  return reference.current.id;
}

export function clearCommandId(reference: MutableRefObject<ClientCommandIdentity | null>) {
  reference.current = null;
}
