const { Server } = require("socket.io");

function createSocketHub(server, store) {
  const io = new Server(server, {
    cors: { origin: true, credentials: true }
  });

  io.on("connection", (socket) => {
    socket.on("deploy:join", (deploymentId) => {
      if (deploymentId) socket.join(`deploy:${deploymentId}`);
    });
    socket.on("deploy:leave", (deploymentId) => {
      if (deploymentId) socket.leave(`deploy:${deploymentId}`);
    });
  });

  return {
    io,
    emitDeployLog(deploymentId, log) {
      io.to(`deploy:${deploymentId}`).emit("deploy:log", log);
    },
    stats() {
      return {
        connections: io.engine.clientsCount,
        rooms: io.sockets.adapter.rooms.size
      };
    },
    async queueStatus() {
      const overview = await store.overview();
      return {
        waiting: 0,
        active: 0,
        completed: overview.deployments,
        failed: 0
      };
    }
  };
}

module.exports = { createSocketHub };
