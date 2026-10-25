import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const memoryDir = resolve(root, "runs/.hmem");
if (existsSync(memoryDir)) rmSync(memoryDir, { recursive: true, force: true });
console.log(`[memory:reset] cleared ${memoryDir}`);
