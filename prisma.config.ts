import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Direct (unpooled) connection — the CLI needs this for schema
    // migrations. Runtime app queries use the pooled DATABASE_URL via the
    // Neon driver adapter instead (see src/lib/prisma.ts).
    url: env("DATABASE_URL_UNPOOLED"),
  },
});
