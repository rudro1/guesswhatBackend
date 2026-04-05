/**
 * Run this ONCE to drop all old tables and recreate with the new schema.
 * Usage: node prisma/reset.js
 *
 * WARNING: This drops all data. Only use during initial setup / schema conflicts.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function reset() {
  console.log('Dropping old tables and enums...');

  await prisma.$executeRawUnsafe(`
    DROP TABLE IF EXISTS "Assignment" CASCADE;
    DROP TABLE IF EXISTS "Template" CASCADE;
    DROP TABLE IF EXISTS "Task" CASCADE;
    DROP TABLE IF EXISTS "User" CASCADE;
    DROP TABLE IF EXISTS "users" CASCADE;
    DROP TYPE IF EXISTS "Role" CASCADE;
    DROP TYPE IF EXISTS "TaskStatus" CASCADE;
  `);

  console.log('Old tables dropped. Now run: npx prisma db push');
  await prisma.$disconnect();
}

reset().catch((e) => {
  console.error(e);
  process.exit(1);
});
