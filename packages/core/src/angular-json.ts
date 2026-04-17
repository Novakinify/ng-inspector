import fs from "node:fs/promises";

import type { AngularJson } from "./types";

export async function readAngularJson(angularJsonPathAbs: string): Promise<AngularJson> {
  const raw = await fs.readFile(angularJsonPathAbs, "utf8");
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("angular.json did not parse to an object");
    }
    return parsed as AngularJson;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse angular.json: ${message}`);
  }
}

