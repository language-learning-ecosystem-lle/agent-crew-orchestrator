import { defineConfig } from "vitest/config";

// Локальный конфиг: пакет — отдельный project корневого vitest (packages/*),
// без него запуск изнутри пакета подхватывает корневой список projects.
export default defineConfig({
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
