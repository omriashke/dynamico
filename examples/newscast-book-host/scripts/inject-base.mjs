import { readFileSync, writeFileSync } from 'node:fs';

const base = process.env.DYNAMICO_BOOK_BASE ?? '/book/';
const indexPath = './dist/index.html';
let html = readFileSync(indexPath, 'utf8');
if (!html.includes('<base ')) {
  html = html.replace('<head>', `<head>\n<base href="${base}">`);
  writeFileSync(indexPath, html);
}
