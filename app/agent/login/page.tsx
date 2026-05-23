// Экран 1 — login агента. Раздельный от B2C контур (свой поддомен/cookie).
// Метод входа: телефон + SMS-код (рекомендация). Реальный submit подключается с Auth.js.
export default function AgentLoginPage() {
  return (
    <main style={{ maxWidth: 360, margin: "80px auto", fontFamily: "system-ui" }}>
      <h1>Кабинет агента</h1>
      <p>Вход по номеру телефона.</p>
      <form>
        <input name="phone" placeholder="+7 ___ ___ __ __" inputMode="tel" />
        {/* TODO(auth): отправка кода через SMS-провайдер, верификация, установка сессии */}
        <button type="submit" disabled>
          Получить код
        </button>
      </form>
    </main>
  );
}
