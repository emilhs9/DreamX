const path = require("path");

const appDir = process.env.APP_DIR || __dirname;
const instances = process.env.PM2_INSTANCES || "1";
const clustered = instances !== "1";

module.exports = {
  apps: [
    {
      name: "dreamx-backend",
      cwd: appDir,
      script: path.join(appDir, "server.js"),
      instances,
      exec_mode: clustered ? "cluster" : "fork",
      env: {
        NODE_ENV: "development",
        PORT: process.env.PORT || 3000
      },
      env_production: {
        NODE_ENV: "production",
        PORT: process.env.PORT || 3000
      },
      error_file: "/var/log/dreamx/error.log",
      out_file: "/var/log/dreamx/out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      restart_delay: 3000,
      max_restarts: 10,
      max_memory_restart: "750M",
      watch: false,
      time: true
    }
  ]
};
