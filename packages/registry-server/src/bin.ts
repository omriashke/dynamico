#!/usr/bin/env node
import { createServer } from "./server.js";

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

const { app } = await createServer();

app.listen({ port, host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
