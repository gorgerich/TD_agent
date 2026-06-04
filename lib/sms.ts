/**
 * SMS-провайдер для OTP. По умолчанию SMS.ru (популярен в РФ). Провайдер и
 * отправитель конфигурируются через env. Без ключа — кидаем SmsNotConfigured,
 * чтобы роут отдал 503, а не падал.
 *
 * env:
 *   SMS_PROVIDER_API_KEY  — ключ (api_id для SMS.ru). Без него SMS не шлём.
 *   SMS_PROVIDER          — "smsru" (default)
 *   SMS_SENDER            — необязательное имя отправителя (одобренное у провайдера)
 */

export class SmsNotConfigured extends Error {
  constructor() {
    super("SMS-провайдер не настроен");
    this.name = "SmsNotConfigured";
  }
}

export class SmsSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmsSendError";
  }
}

export function smsConfigured(): boolean {
  return Boolean(process.env.SMS_PROVIDER_API_KEY);
}

/** Отправить OTP-сообщение. Бросает SmsNotConfigured / SmsSendError. */
export async function sendOtpSms(phone: string, code: string): Promise<void> {
  const apiKey = process.env.SMS_PROVIDER_API_KEY;
  if (!apiKey) throw new SmsNotConfigured();

  const provider = (process.env.SMS_PROVIDER ?? "smsru").toLowerCase();
  const text = `Код входа в кабинет «Тихий дом»: ${code}. Никому не сообщайте.`;

  if (provider === "smsru") {
    const url = new URL("https://sms.ru/sms/send");
    url.searchParams.set("api_id", apiKey);
    url.searchParams.set("to", phone.replace(/\D/g, ""));
    url.searchParams.set("msg", text);
    url.searchParams.set("json", "1");
    if (process.env.SMS_SENDER) url.searchParams.set("from", process.env.SMS_SENDER);

    let res: Response;
    try {
      res = await fetch(url, { method: "POST" });
    } catch (e) {
      throw new SmsSendError("Сеть недоступна: " + (e instanceof Error ? e.message : "ошибка"));
    }
    if (!res.ok) throw new SmsSendError(`SMS.ru HTTP ${res.status}`);
    const data = (await res.json().catch(() => ({}))) as { status?: string; status_code?: number };
    if (data.status !== "OK") throw new SmsSendError(`SMS.ru status ${data.status ?? "?"} (${data.status_code ?? "?"})`);
    return;
  }

  throw new SmsSendError(`Неизвестный SMS-провайдер: ${provider}`);
}
