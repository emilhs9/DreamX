const fs = require("fs/promises");
const path = require("path");
const { Pool } = require("pg");
const { config } = require("./config");

async function migrate(pool) {
  const ownPool = !pool;
  if (!config.databaseUrl && ownPool) {
    if (config.env !== "production") {
      console.log("DATABASE_URL is empty; PostgreSQL migration skipped for local JSON development.");
      return;
    }
    throw new Error("DATABASE_URL is required for PostgreSQL migrations.");
  }
  const db = pool || new Pool({ connectionString: config.databaseUrl });
  const sql = await fs.readFile(path.join(__dirname, "schema.sql"), "utf8");
  await db.query(sql);
  if (ownPool) await db.end();
}

if (require.main === module) {
  migrate()
    .then(() => console.log("LaunchPad PostgreSQL schema is ready."))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { migrate };
