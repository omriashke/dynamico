/**
 * Playwright smoke test: Book Button preview should have pink primary background.
 * Requires book-host dev (default :6006) with fixed @omriashke/dynamico-core linked.
 *
 *   DYNAMICO_REGISTRY_PROXY=http://127.0.0.1:4000 cd examples/book-host && pnpm dev
 *   node ../../packages/core/scripts/test-book-colors.mjs
 */
import { chromium } from "playwright";

const bookUrl = process.env.DYNAMICO_BOOK_URL ?? "http://127.0.0.1:6006";
const PRIMARY_RGB = "rgb(245, 48, 113)";

const browser = await chromium.launch();
const page = await browser.newPage();

try {
  await page.goto(bookUrl, { waitUntil: "networkidle", timeout: 60_000 });
  await page.getByRole("button", { name: "Button Button" }).click();
  await page.waitForTimeout(3000);

  const hasPrimary = await page.evaluate((expected) => {
    for (const el of document.querySelectorAll("*")) {
      if (getComputedStyle(el).backgroundColor === expected) return true;
    }
    return false;
  }, PRIMARY_RGB);

  if (!hasPrimary) {
    console.error("FAIL: no primary pink background", PRIMARY_RGB, "in Button preview");
    process.exit(1);
  }

  console.log("PASS: Book Button preview shows primary pink background", PRIMARY_RGB);
} finally {
  await browser.close();
}
