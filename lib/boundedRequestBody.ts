import { OperationalCommandError } from "@/lib/operationalTransaction";

export async function readBoundedRequestText(request: Request, maximumBytes: number): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) throw new OperationalCommandError(400, "Тело запроса отсутствует");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let result = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel();
        throw new OperationalCommandError(413, "Тело запроса превышает допустимый размер");
      }
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } catch (error) {
    if (error instanceof OperationalCommandError) throw error;
    throw new OperationalCommandError(400, "Не удалось прочитать тело запроса");
  } finally { reader.releaseLock(); }
}
