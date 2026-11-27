import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { remote } from "webdriverio";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const APP_EXE = path.join(ROOT, "backend", "target", "debug", "embedbay.exe");
const EDGE_DRIVER = path.join(__dirname, ".bin", "msedgedriver.exe");
const SCREENSHOT_DIR = path.join(__dirname, ".bin");
const PORT = 4444;

function waitForPort(port, timeoutMs = 15000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.end();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Timed out waiting for tauri-driver on :${port}`));
        } else {
          setTimeout(attempt, 200);
        }
      });
    };
    attempt();
  });
}

async function clickByText(browser, selector, pattern, timeout = 10000) {
  await browser.waitUntil(
    async () => {
      const els = await browser.$$(selector);
      for (const el of els) {
        const text = (await el.getText()).trim();
        const title = (await el.getAttribute("title")) ?? "";
        const aria = (await el.getAttribute("aria-label")) ?? "";
        if (
          pattern.test(text) ||
          pattern.test(title) ||
          pattern.test(aria)
        ) {
          if (await el.isDisplayed()) return true;
        }
      }
      return false;
    },
    { timeout, timeoutMsg: `Could not find ${selector} matching ${pattern}` },
  );

  const els = await browser.$$(selector);
  for (const el of els) {
    const text = (await el.getText()).trim();
    const title = (await el.getAttribute("title")) ?? "";
    const aria = (await el.getAttribute("aria-label")) ?? "";
    if (
      (pattern.test(text) || pattern.test(title) || pattern.test(aria)) &&
      (await el.isDisplayed())
    ) {
      await el.click();
      return el;
    }
  }
  throw new Error(`No visible ${selector} matching ${pattern}`);
}

async function waitForText(browser, pattern, timeout = 10000) {
  await browser.waitUntil(
    async () => {
      const bodyText = await browser.$("body").getText();
      return pattern.test(bodyText);
    },
    { timeout, timeoutMsg: `Timed out waiting for text ${pattern}` },
  );
}

async function run() {
  if (!fs.existsSync(APP_EXE)) {
    throw new Error(`Missing debug executable: ${APP_EXE}`);
  }
  if (!fs.existsSync(EDGE_DRIVER)) {
    throw new Error(`Missing msedgedriver.exe: ${EDGE_DRIVER}`);
  }

  console.log(`[e2e] Starting tauri-driver on :${PORT}...`);
  const tauriDriver = spawn(
    "tauri-driver",
    ["--port", String(PORT), "--native-driver", EDGE_DRIVER],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  tauriDriver.stderr.on("data", (d) => {
    const msg = d.toString().trim();
    if (msg) console.error(`[tauri-driver] ${msg}`);
  });

  let browser;
  const results = [];
  const instName = `E2E_SqliteVec_${Date.now()}`;

  const step = async (name, fn) => {
    const t0 = Date.now();
    try {
      await fn();
      const ms = Date.now() - t0;
      console.log(`  [PASS] ${name} (${ms}ms)`);
      results.push({ name, status: "PASS", ms });
    } catch (err) {
      const ms = Date.now() - t0;
      console.error(`  [FAIL] ${name} (${ms}ms): ${err.message}`);
      results.push({ name, status: "FAIL", ms, error: err.message });
      if (browser) {
        try {
          await browser.saveScreenshot(
            path.join(SCREENSHOT_DIR, `fail-${Date.now()}.png`),
          );
        } catch {
          // ignore screenshot failure
        }
      }
      throw err;
    }
  };

  try {
    await waitForPort(PORT, 15000);
    console.log(`[e2e] Launching ${APP_EXE}...`);

    browser = await remote({
      hostname: "127.0.0.1",
      port: PORT,
      logLevel: "warn",
      strictSelectors: false,
      capabilities: {
        "tauri:options": {
          application: APP_EXE,
        },
      },
    });

    await step("T1. Real Tauri Runtime & Onboarding", async () => {
      await browser.waitUntil(
        async () => {
          const ready = await browser.execute(() =>
            Boolean(window.__TAURI_INTERNALS__),
          );
          return Boolean(ready);
        },
        { timeout: 15000, timeoutMsg: "window.__TAURI_INTERNALS__ not found" },
      );

      // Dismiss splash & complete onboarding if present
      await browser.pause(1500);
      const body = await browser.$("body").getText();
      if (/Welcome to EmbedBay/i.test(body)) {
        await clickByText(browser, "button", /^Get Started$/i);
        for (let i = 0; i < 3; i++) {
          await clickByText(browser, "button", /^Continue$/i);
        }
        await clickByText(browser, "button", /^Launch EmbedBay$/i);
      }

      const nav = await browser.$('aside[aria-label="Primary Navigation"]');
      await nav.waitForDisplayed({ timeout: 10000 });
      const textAfter = await browser.$("body").getText();
      assert.ok(
        !/IPC status check error/i.test(textAfter),
        "Unexpected IPC status check error",
      );
    });

    await step("T2. Engine Store, Refresh Catalog, Detail Page & Back", async () => {
      await clickByText(
        browser,
        'aside[aria-label="Primary Navigation"] button',
        /Engine Store/i,
      );
      await waitForText(browser, /Native Engine Store/i);

      await clickByText(browser, "button", /Refresh Catalog/i);
      await waitForText(browser, /Catalog refreshed/i);

      // Open SQLite + sqlite-vec Detail page
      await clickByText(browser, "button", /SQLite \+ sqlite-vec/i);
      await waitForText(browser, /Available Releases/i);

      // Enable embedded runtime if not yet enabled
      const body = await browser.$("body").getText();
      if (/Enable Runtime/i.test(body)) {
        await clickByText(browser, "button", /Enable Runtime/i);
        await waitForText(browser, /Installed/i, 15000);
      }

      await clickByText(browser, "button", /Back to Engine Store/i);
      await waitForText(browser, /Native Engine Store/i);
    });

    await step(`T3. Create Real sqlite_vec Instance (${instName})`, async () => {
      await clickByText(
        browser,
        'aside[aria-label="Primary Navigation"] button',
        /Local Runtimes/i,
      );
      await clickByText(browser, "button", /New Instance/i);

      const dialog = await browser.$("dialog[open]");
      await dialog.waitForDisplayed({ timeout: 5000 });
      const selectEl = (await dialog.$$("select"))[0];
      await selectEl.selectByAttribute("value", "sqlite_vec");

      const nameInput = await dialog.$('input[placeholder="e.g. Local Qdrant Dev"]');
      await nameInput.setValue(instName);

      await clickByText(browser, "dialog[open] button", /Create Instance/i);
      await waitForText(browser, new RegExp(instName), 10000);

      // Find the specific instance card containing <h3>{instName}</h3> and click its Explore button
      const h3s = await browser.$$("h3");
      let explored = false;
      for (const h of h3s) {
        if ((await h.getText()).trim() === instName) {
          const card = await h.$("./ancestor::div[contains(@class,'rounded-xl')][1]");
          const btn = await card.$("button*=Explore");
          await btn.click();
          explored = true;
          break;
        }
      }
      assert.ok(explored, `Could not click Explore on ${instName}`);
      await waitForText(browser, new RegExp(instName), 10000);
    });

    await step("T4. Real Collection CRUD (Create + Upsert 3 Vectors + Filter)", async () => {
      await clickByText(browser, "button", /^(New|Create) Collection$/i);
      const colDialog = await browser.$("dialog[open]");
      await colDialog.waitForDisplayed({ timeout: 5000 });

      const nameInput = await colDialog.$('input[type="text"]');
      await nameInput.setValue("e2e_docs");
      const dimInput = await colDialog.$('input[type="number"]');
      await dimInput.setValue("4");
      await clickByText(browser, "dialog[open] button", /Create Collection/i);

      await waitForText(browser, /e2e_docs/i, 10000);
      await waitForText(browser, /Upsert Record/i, 10000);

      const sampleRecords = [
        { id: "e2e-1", doc: "First real sqlite-vec document", vec: "[0.1, 0.2, 0.3, 0.4]" },
        { id: "e2e-2", doc: "Second real sqlite-vec document", vec: "[0.8, 0.1, 0.1, 0.0]" },
        { id: "e2e-3", doc: "Third real sqlite-vec document", vec: "[0.2, 0.7, 0.2, 0.1]" },
      ];

      for (const rec of sampleRecords) {
        await clickByText(browser, "button", /Upsert Record/i);
        const uDialog = await browser.$("dialog[open]");
        await uDialog.waitForDisplayed({ timeout: 5000 });

        const textInputs = await uDialog.$$('input[type="text"]');
        await textInputs[0].setValue(rec.id);
        const textareas = await uDialog.$$("textarea");
        await textareas[0].setValue(rec.doc);
        await textareas[1].setValue(rec.vec);

        await clickByText(browser, "dialog[open] button", /Upsert Record/i);
        await waitForText(browser, new RegExp(rec.id), 10000);
      }

      // FilterBuilder invalid JSON disables Apply
      await clickByText(browser, "button", /Raw JSON/i);
      const rawFilter = await browser.$('textarea[placeholder*="must"], textarea[placeholder*="status"], textarea');
      await rawFilter.setValue("{invalid-json");
      const applyBtn = await browser.$("button=Apply");
      assert.equal(await applyBtn.isEnabled(), false, "Apply must be disabled on invalid JSON");
    });

    await step("T5. Real Search Playground (KNN Search & Compare A/B)", async () => {
      await clickByText(browser, "button", /Search Playground/i);
      await clickByText(browser, "button", /^Raw Vector$/i);

      const vecInput = await browser.$('textarea[placeholder*="0.021"]');
      await vecInput.setValue("[0.1, 0.2, 0.3, 0.4]");
      await clickByText(browser, "button", /Run Search/i);

      await waitForText(browser, /e2e-1/i, 10000);

      await clickByText(browser, "button", /Compare A\/B/i);
      await waitForText(browser, /Exit Compare/i, 5000);
      await clickByText(browser, "button", /Exit Compare/i);
    });

    await step("T6. Real WebGL Embedding Visualizer (PCA & UMAP, 2D & 3D)", async () => {
      await clickByText(
        browser,
        'div[role="tab"]',
        new RegExp(`^${instName}.*e2e_docs`, "i"),
      );
      await clickByText(browser, "button", /Visualize 2D\/3D/i);

      await waitForText(browser, /PCA/i, 10000);
      await clickByText(browser, "button", /^UMAP$/i);
      await clickByText(browser, "button", /^3D$/i);
      await browser.pause(500);
    });

    await step("T7. Command Palette (Ctrl+K) & Real Windows Diagnostics", async () => {
      await browser.keys(["Control", "k"]);
      const paletteInput = await browser.$(
        'input[placeholder*="Type a command"]',
      );
      await paletteInput.waitForDisplayed({ timeout: 5000 });
      await paletteInput.setValue("Diagnostics");
      await clickByText(browser, '[cmdk-item], div[role="option"]', /Settings: Diagnostics/i);

      await waitForText(browser, /Windows Credential Manager/i, 10000);
      await waitForText(browser, /SQLite|Integrity|wal/i, 5000);

      await clickByText(browser, 'button[role="tab"]', /General/i);
      await clickByText(browser, "button", /^Light\b/i);
      await clickByText(browser, "button", /^Dark\b/i);
      await clickByText(browser, "button", /Close settings/i);
    });

    await step(`T8. Delete ${instName} & Clean Teardown`, async () => {
      await clickByText(
        browser,
        'aside[aria-label="Primary Navigation"] button',
        /Local Runtimes/i,
      );
      await waitForText(browser, new RegExp(instName), 10000);

      // Click Delete button inside the specific instName card
      const h3s = await browser.$$("h3");
      let deleted = false;
      for (const h of h3s) {
        if ((await h.getText()).trim() === instName) {
          const card = await h.$("./ancestor::div[contains(@class,'rounded-xl')][1]");
          const delBtn = await card.$('button[title="Delete Instance"]');
          await delBtn.click();
          deleted = true;
          break;
        }
      }
      assert.ok(deleted, `Could not click Delete Instance on ${instName}`);

      const delDialog = await browser.$("dialog[open]");
      await delDialog.waitForDisplayed({ timeout: 5000 });
      const checkbox = await delDialog.$('input[type="checkbox"]');
      if (await checkbox.isExisting()) {
        await checkbox.click();
      }
      await clickByText(browser, "dialog[open] button", /Delete Instance/i);

      await browser.waitUntil(
        async () => !(await browser.$("body").getText()).includes(instName),
        { timeout: 10000, timeoutMsg: `${instName} still visible after delete` },
      );
    });

    console.log(`\n[e2e] ALL ${results.length} REAL E2E TESTS PASSED!`);
  } finally {
    if (browser) {
      try {
        await browser.deleteSession();
      } catch {
        // ignore session close errors
      }
    }
    tauriDriver.kill();
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/IM", "embedbay.exe", "/F"], { stdio: "ignore" });
    }
  }
}

run().catch((err) => {
  console.error("[e2e] Run failed:", err);
  process.exit(1);
});
