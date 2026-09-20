import { chromium } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = "/workspace/screenshots";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(20000);
await page.goto("http://127.0.0.1:8080/", { waitUntil: "networkidle" });
await page.waitForSelector("text=Potion");

await page.getByRole("button", { name: "New folder" }).click();
await page.getByPlaceholder("Name").fill("Photos");
await page.getByRole("button", { name: "Create" }).click();
await page.getByRole("button", { name: "Photos" }).first().waitFor();

const logo = await readFile("/workspace/public/potion-logo.png");
await page.locator('input[type="file"]').setInputFiles({
  name: "flask.png",
  mimeType: "image/png",
  buffer: logo,
});
await page.getByText("flask.png").first().waitFor();
await page.locator('input[type="file"]').setInputFiles({
  name: "notes.txt",
  mimeType: "text/plain",
  buffer: Buffer.from("Potion keeps any size. A gigabyte is just more slices."),
});
await page.getByText("notes.txt").first().waitFor();
await page.locator('input[type="file"]').setInputFiles({
  name: "notes.txt",
  mimeType: "text/plain",
  buffer: Buffer.from("Second save. Version history should list two versions."),
});
await page.getByRole("button", { name: "Add files" }).waitFor();
await page.screenshot({ path: join(out, "v150-folder.png") });

await page.getByRole("button", { name: "Grid" }).click();
await page.waitForTimeout(200);
await page.screenshot({ path: join(out, "v150-grid.png") });
await page.getByRole("button", { name: "List" }).click();

await page.locator("article").filter({ hasText: "notes.txt" }).getByTitle("Actions").click();
await page.locator("#potion-action-menu").getByRole("button", { name: "Version history" }).click();
await page.getByText("Version").first().waitFor();
await page.screenshot({ path: join(out, "v150-history.png") });
await page.getByRole("button", { name: "Done" }).click();

await page.locator("article").filter({ hasText: "notes.txt" }).getByTitle("Actions").click();
await page.locator("#potion-action-menu").getByRole("button", { name: "Comments" }).click();
await page.getByPlaceholder("Write a comment").fill("Keep this cut for the trailer.");
await page.getByRole("button", { name: "Post" }).click();
await page.getByText("Keep this cut").waitFor();
await page.screenshot({ path: join(out, "v150-comments.png") });
await page.getByRole("button", { name: "Done" }).click();

await page.locator("aside").getByRole("button", { name: "Sync", exact: true }).click();
await page.getByText("How to use it").waitFor();
await page.screenshot({ path: join(out, "v150-sync.png") });

await browser.close();
console.log("screenshots written");
