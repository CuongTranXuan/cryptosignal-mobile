import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("charting primitives contract", () => {
  it("exports AnnotationPrimitiveManager and shape primitives", () => {
    const manager = readFileSync(resolve(process.cwd(), "components/charting/primitives/annotation-primitive-manager.ts"), "utf8");
    const horizontal = readFileSync(resolve(process.cwd(), "components/charting/primitives/horizontal-level-primitive.ts"), "utf8");
    expect(manager).toContain("export class AnnotationPrimitiveManager");
    expect(manager).toContain("attachPrimitive");
    expect(horizontal).toContain("ISeriesPrimitive");
    expect(horizontal).toContain("useBitmapCoordinateSpace");
  });
});
