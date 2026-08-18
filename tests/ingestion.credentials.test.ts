import { describe, expect, it } from "vitest";
import { appRouter } from "../server/routers";

describe("signal ingestion credentials", () => {
  it("accepts the supplied token through the lightweight ingestion health procedure", async () => {
    const token = process.env.SIGNAL_INGEST_TOKEN;
    expect(token, "SIGNAL_INGEST_TOKEN must be configured").toBeTruthy();

    const caller = appRouter.createCaller({
      user: null,
      req: {} as never,
      res: {} as never,
    });
    await expect(caller.ingestion.health({ token: token! })).resolves.toEqual({ ok: true, mode: "SIGNALS_ONLY" });
  });
});
