#!/usr/bin/env node
import { chromium } from "playwright";

const url = process.env.POTION_URL || "http://127.0.0.1:8080/";
const timeout = 20000;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(timeout);

const fails = [];
function check(ok, msg) {
  if (!ok) fails.push(msg);
  else console.log("ok  " + msg);
}
async function nav(name) {
  await page.locator("aside").getByRole("button", { name, exact: true }).click();
}

try {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector("text=Potion");
  const body = await page.locator("body").innerText();
  check(/Folder/.test(body) && /Trash/.test(body) && /Sync/.test(body), "nav shows Folder, Trash, Sync");
  check(!(await page.getByRole("navigation").getByRole("button", { name: "Apps" }).count()), "Apps tab gone");
  check(!/lunchbox/i.test(body), "no lunchbox copy on home");

  const stamp = `qa-${Date.now()}`;
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByPlaceholder("Name").fill(stamp);
  await page.getByRole("button", { name: "Create" }).click();
  await page.getByRole("button", { name: stamp }).first().waitFor();
  check(true, "created folder " + stamp);

  await page.getByRole("button", { name: "Add files" }).waitFor();
  const fileName = `${stamp}.txt`;
  await page.locator('input[type="file"]').setInputFiles({
    name: fileName,
    mimeType: "text/plain",
    buffer: Buffer.from("hello potion"),
  });
  await page.getByText(fileName).first().waitFor();
  check(true, "uploaded text file");

  await page.getByRole("button", { name: "Name", exact: true }).click();
  check(true, "sort by name");

  await page.locator("article").filter({ hasText: fileName }).click();
  await page.keyboard.press("F2");
  const renamed = `renamed-${fileName}`;
  await page.locator("form input").fill(renamed);
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByText(renamed).first().waitFor();
  check(true, "rename via F2");

  await page.locator("article").filter({ hasText: renamed }).getByTitle("Actions").click();
  await page.locator("#potion-action-menu").getByRole("button", { name: "Move to trash" }).click();
  await page.getByText(/Moved .+ to trash/).waitFor();
  check(true, "delete to trash");

  await nav("Trash");
  await page.getByText(renamed).first().waitFor();
  check(true, "file appears in trash");
  await page.locator("article").filter({ hasText: renamed }).getByTitle("Actions").click();
  await page.locator("#potion-action-menu").getByRole("button", { name: "Restore" }).click();
  await page.getByText(/Restored/).waitFor();
  check(true, "restore from trash");

  await nav("Folder");
  await page.getByPlaceholder("Search Potion").fill(renamed);
  await page.getByText(renamed).first().waitFor();
  check(true, "search finds file");

  await nav("Sync");
  const sync = await page.locator("body").innerText();
  check(/How to use it/.test(sync), "sync how-to present");
  check(!/lunchbox/i.test(sync), "no lunchbox on sync");
  check(!/\bbox\b/i.test(sync), "no box copy on sync");
  check(!/locker/i.test(sync), "no locker copy on sync");
  check(/Sign in when you want/.test(sync), "sign-in copy is name-neutral");
  check(!/3 MB/.test(sync), "3 MB account cap gone");
  check(/Any size, including 1 GB/.test(sync), "no size cap copy");
  check(/Version history/.test(sync), "version history mentioned");
  check(/Comments sit on the file/.test(sync), "comments mentioned");
  check(/Live watches/.test(sync), "live watch mentioned");

  await nav("Folder");
  check(await page.getByText("Live", { exact: true }).count(), "live pill on folder");

  await page.getByPlaceholder("Search Potion").fill("");
  await page.locator("article").filter({ hasText: renamed }).waitFor();
  await page.locator("article").filter({ hasText: renamed }).getByTitle("Actions").click();
  await page.locator("#potion-action-menu").getByRole("button", { name: "Comments" }).click();
  await page.getByPlaceholder("Write a comment").fill("looks good");
  await page.getByRole("button", { name: "Post" }).click();
  await page.getByText("looks good").waitFor();
  check(true, "posted a comment");
  await page.getByRole("button", { name: "Done" }).click();

  await page.locator("article").filter({ hasText: renamed }).getByTitle("Actions").click();
  await page.locator("#potion-action-menu").getByRole("button", { name: "Version history" }).click();
  await page.getByText("Version 1").waitFor();
  check(true, "version history lists current save");
  await page.getByRole("button", { name: "Done" }).click();
} catch (err) {
  fails.push(err instanceof Error ? err.message : String(err));
} finally {
  await browser.close();
}

if (fails.length) {
  console.error("FAIL\n" + fails.map((f) => "- " + f).join("\n"));
  process.exit(1);
}
console.log("all feature checks passed");
