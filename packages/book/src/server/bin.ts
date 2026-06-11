#!/usr/bin/env node
import { createBookServer } from './index.js';

const port = Number(process.env.PORT ?? process.argv.find((a) => a.startsWith('--port='))?.split('=')[1] ?? 6006);
const distDir = process.env.DYNAMICO_BOOK_DIST;

createBookServer({ port, ...(distDir ? { distDir } : {}) }).catch((err) => {
  console.error(err);
  process.exit(1);
});
