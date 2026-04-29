#!/usr/bin/env node
import { createServer } from "./server.js";
import type { AuthOptions } from "./auth.js";

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

const auth: AuthOptions = {};
if (process.env.DYNAMICO_TOKEN) auth.token = process.env.DYNAMICO_TOKEN;
if (process.env.DYNAMICO_BASIC_USER && process.env.DYNAMICO_BASIC_PASSWORD) {
  auth.basic = {
    user: process.env.DYNAMICO_BASIC_USER,
    password: process.env.DYNAMICO_BASIC_PASSWORD,
  };
}
if (process.env.DYNAMICO_ALLOW_IPS) {
  auth.allowIps = process.env.DYNAMICO_ALLOW_IPS.split(",").map((s) => s.trim()).filter(Boolean);
}

const sourceDir = process.env.DYNAMICO_SOURCE_DIR;
if (!sourceDir) {
  process.stderr.write(
    "dynamico-registry: DYNAMICO_SOURCE_DIR is required.\n" +
      "  Set it to a directory containing your .tsx source files and dynamico.config.json.\n" +
      "  Example: DYNAMICO_SOURCE_DIR=./components dynamico-registry\n",
  );
  process.exit(1);
}
const { app } = await createServer({ auth, sourceDir });

app.listen({ port, host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
