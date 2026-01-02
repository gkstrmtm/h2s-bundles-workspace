const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient({ log: ['error'] });
  try {
    const rows = await prisma.$queryRaw`
      select to_regclass('public."Offers"')::text as offers_table
    `;
    console.log(JSON.stringify({ ok: true, offers_table: rows?.[0]?.offers_table ?? null }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }, null, 2));
  process.exit(1);
});
