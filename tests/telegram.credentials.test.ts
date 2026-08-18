import { describe, expect, it } from "vitest";

describe("Telegram long-polling credentials", () => {
  it("validates the supplied bot token through Telegram getMe without configuring a webhook", async () => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    expect(token, "TELEGRAM_BOT_TOKEN must be configured").toBeTruthy();

    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const body = (await response.json()) as {
      ok: boolean;
      result?: { id: number; is_bot: boolean; username?: string };
    };

    expect(response.ok).toBe(true);
    expect(body.ok).toBe(true);
    expect(body.result?.is_bot).toBe(true);
    expect(body.result?.id).toBeTypeOf("number");
  }, 15_000);
});
