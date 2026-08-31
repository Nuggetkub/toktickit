import { testDatabaseUrl } from "./test-database.js";

// Runs in every worker before the test file is imported, so the lazy
// PrismaClient in src/prisma.ts is built against the isolated test schema
// rather than the development one.
process.env.DATABASE_URL = testDatabaseUrl();

// Attachment bytes go to a directory of their own, so a test run never writes
// into the working copy's real storage folder.
process.env.ATTACHMENT_STORAGE_DIR = "./storage/test-attachments";
