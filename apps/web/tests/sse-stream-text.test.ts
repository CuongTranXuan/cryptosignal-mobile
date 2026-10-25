import { describe, expect, it } from "vitest";
import { joinStreamTextBlocks } from "../lib/sse-stream-text";

describe("joinStreamTextBlocks", () => {
  it("inserts a paragraph break between glued server blocks", () => {
    const prev =
      "⚠ Xu hướng bạn chọn (Giảm) mâu thuẫn với chế độ thị trường phát hiện (Xu hướng tăng); hình vẽ theo chế độ thị trường.";
    const delta = "Mô hình đã xong. Đang dựng lớp phủ…";
    expect(joinStreamTextBlocks(prev, delta)).toBe(`${prev}\n\n${delta}`);
  });

  it("keeps intentional inline continuation when delta starts with whitespace", () => {
    expect(joinStreamTextBlocks("Found ", "a triangle")).toBe("Found a triangle");
  });

  it("paragraph-breaks before client scroll notice after overlay text", () => {
    const prev = "Lớp phủ sẵn sàng: 6 — Triangle.";
    const scroll = "Đã cuộn biểu đồ để hiển thị các lớp phủ.";
    expect(joinStreamTextBlocks(prev, scroll)).toBe(`${prev}\n\n${scroll}`);
  });
});
