import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path to `shared/data` (YAML SSOT). Node/server only. */
export const SHARED_DATA_DIR = dirname(fileURLToPath(import.meta.url));
