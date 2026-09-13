// Vercel's Preview environment has no DATABASE_URL_UNPOOLED configured, so
// `prisma migrate deploy` must only run for the actual Production-target
// build (VERCEL_ENV=production) - otherwise every preview deployment fails
// at the migration step before it even reaches `next build`. Plain JS (not
// a shell conditional) so this also works unchanged in local `npm run
// build` on Windows, where VERCEL_ENV is unset and migrations are skipped.
const { execSync } = require("child_process");

if (process.env.VERCEL_ENV === "production") {
  execSync("prisma migrate deploy", { stdio: "inherit" });
}
execSync("next build", { stdio: "inherit" });
