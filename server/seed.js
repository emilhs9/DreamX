const { LaunchPadStore } = require("./store");

async function seed() {
  const store = new LaunchPadStore();
  await store.init();
  console.log("LaunchPad seed complete. Admin route: /dream, username: dream, password: dream");
}

if (require.main === module) {
  seed().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { seed };
