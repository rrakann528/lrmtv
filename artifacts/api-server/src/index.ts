import { createServer } from "http";
import app from "./app";
import { initSocketServer } from "./lib/socket";
import { runMigrations } from "@workspace/db";

const port = Number(process.env["PORT"]) || 3000;

if (Number.isNaN(port) || port <= 0) {
  console.error(`[server] Invalid PORT value, defaulting to 3000`);
}

const httpServer = createServer(app);
initSocketServer(httpServer);

runMigrations().then(() => {
  httpServer.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
});
