const { Queue, QueueEvents, Worker } = require("bullmq");
const IORedis = require("ioredis");
const { config } = require("./config");

function createDeployQueue(processor) {
  if (!config.redisUrl) {
    const concurrency = Math.max(1, Math.min(Number(config.deployQueueConcurrency || 3), 3));
    const pending = [];
    let active = 0;
    const pump = () => {
      if (active >= concurrency || !pending.length) return;
      const item = pending.shift();
      active += 1;
      processor(item.payload)
        .then(item.resolve)
        .catch(item.reject)
        .finally(() => {
          active -= 1;
          pump();
        });
    };
    return {
      mode: "in-memory",
      async run(_name, payload) {
        return new Promise((resolve, reject) => {
          pending.push({ payload, resolve, reject });
          pump();
        });
      },
      async add(name, payload) {
        return this.run(name, payload);
      },
      async status() {
        return { mode: "in-memory", waiting: pending.length, active, delayed: 0, concurrency };
      }
    };
  }

  const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
  connection.on("error", () => {});
  const queue = new Queue("launchpad-deployments", { connection });
  const queueEvents = new QueueEvents("launchpad-deployments", { connection });
  const worker = new Worker("launchpad-deployments", async (job) => processor(job.data), {
    connection,
    concurrency: Math.max(1, Math.min(Number(config.deployQueueConcurrency || 3), 3))
  });

  return {
    mode: "bullmq",
    queue,
    queueEvents,
    worker,
    async add(name, payload) {
      return queue.add(name, payload, {
        attempts: 2,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 200
      });
    },
    async run(name, payload) {
      const job = await this.add(name, payload);
      return job.waitUntilFinished(queueEvents);
    },
    async status() {
      const counts = await queue.getJobCounts("waiting", "active", "delayed", "completed", "failed");
      return { mode: "bullmq", concurrency: worker.opts.concurrency, ...counts };
    }
  };
}

module.exports = { createDeployQueue };
