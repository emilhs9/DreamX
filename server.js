const http = require("http");
const { createApp } = require("./server/app");
const { createSocketHub } = require("./server/socketHub");
const { config } = require("./server/config");

async function main() {
  const { app, store, deployer } = await createApp();
  const server = http.createServer(app);
  const socketHub = createSocketHub(server, store);
  app.locals.socketHub = socketHub;
  deployer.attachSocketHub(socketHub);

  server.listen(config.port, () => {
    console.log(`DreamX running on http://localhost:${config.port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
