import { testDatabaseUrl } from "./test-database.js";

// Runs in every worker before the test file is imported, so the lazy
// PrismaClient in src/prisma.ts is built against the isolated test schema
// rather than the development one.
process.env.DATABASE_URL = testDatabaseUrl();
