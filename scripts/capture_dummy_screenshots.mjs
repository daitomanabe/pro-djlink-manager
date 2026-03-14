import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import process from "node:process";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const OUTPUT_DIR = path.resolve(process.cwd(), "docs", "assets", "screenshots");
const DEBUG_PORT = Number.parseInt(process.env.CDP_PORT || "9223", 10);
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 2 };
const CHROME_BIN =
  process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return { promise, resolve, reject };
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText} (${url})`);
  }

  return response.json();
}

async function waitForHttp(url, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Server is still warming up.
    }

    await delay(500);
  }

  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForCdp(port, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const version = await fetchJson(`http://127.0.0.1:${port}/json/version`);
      if (version.webSocketDebuggerUrl) {
        return version;
      }
    } catch {
      // Chrome is still launching.
    }

    await delay(250);
  }

  throw new Error(`Timed out waiting for DevTools on port ${port}`);
}

function launchChrome() {
  const userDataDir = path.join("/tmp", `pdj-dummy-capture-${Date.now()}`);
  const args = [
    "--headless=new",
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${userDataDir}`,
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    "--hide-scrollbars",
    "--mute-audio",
    "--enable-webgl",
    "--use-gl=angle",
    "--enable-gpu",
    "about:blank",
  ];

  return spawn(CHROME_BIN, args, {
    stdio: "ignore",
  });
}

class CdpClient {
  constructor(webSocketUrl) {
    this.socket = new WebSocket(webSocketUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.ready = createDeferred();

    this.socket.addEventListener("open", () => this.ready.resolve());
    this.socket.addEventListener("message", (event) => {
      const payload = JSON.parse(event.data);
      if (payload.id && this.pending.has(payload.id)) {
        const entry = this.pending.get(payload.id);
        this.pending.delete(payload.id);
        if (payload.error) {
          entry.reject(new Error(payload.error.message || "CDP request failed"));
          return;
        }

        entry.resolve(payload.result || {});
        return;
      }

      this.events.push(payload);
    });
    this.socket.addEventListener("error", (error) => this.ready.reject(error));
  }

  async connect() {
    await this.ready.promise;
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    const deferred = createDeferred();
    this.pending.set(id, deferred);
    this.socket.send(JSON.stringify({ id, method, params }));
    return deferred.promise;
  }

  async close() {
    this.socket.close();
    await delay(100);
  }
}

async function createTarget(port, url) {
  const encodedUrl = encodeURIComponent(url);
  return fetchJson(`http://127.0.0.1:${port}/json/new?${encodedUrl}`, { method: "PUT" });
}

async function ensureDummyMode() {
  const response = await fetch(`${BASE_URL}/api/dummy/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Failed to start dummy mode");
  }
}

async function waitForTrack(client) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await client.send("Runtime.evaluate", {
      expression:
        "(() => { const value = document.getElementById('currentTrackTitle')?.textContent || ''; return value && value !== 'No active track'; })()",
      returnByValue: true,
      awaitPromise: true,
    });

    if (result.result?.value) {
      return;
    }

    await delay(500);
  }

  throw new Error("Timed out waiting for dummy track metadata.");
}

async function activateView(client, view) {
  await client.send("Runtime.evaluate", {
    expression: `(() => {
      const button = document.querySelector('[data-view="${view}"]');
      if (button) {
        button.click();
        return true;
      }
      return false;
    })()`,
    returnByValue: true,
    awaitPromise: true,
  });

  await delay(view === "visualizer" ? 2600 : 1200);
}

async function captureView(client, view, filename) {
  await activateView(client, view);
  const result = await client.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
    fromSurface: true,
  });
  await writeFile(path.join(OUTPUT_DIR, filename), Buffer.from(result.data, "base64"));
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await waitForHttp(`${BASE_URL}/api/state`);
  await ensureDummyMode();

  const chrome = launchChrome();

  try {
    await waitForCdp(DEBUG_PORT);
    const target = await createTarget(DEBUG_PORT, BASE_URL);
    const client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      deviceScaleFactor: VIEWPORT.deviceScaleFactor,
      mobile: false,
    });
    await client.send("Page.bringToFront");
    await delay(2500);
    await waitForTrack(client);

    await captureView(client, "onair", "dummy-on-air.png");
    await captureView(client, "monitor", "dummy-input-monitor.png");
    await captureView(client, "visualizer", "dummy-visualizer.png");

    await client.close();
  } finally {
    chrome.kill("SIGTERM");
    await delay(500);
  }
}

main().catch(async (error) => {
  console.error(error.message);
  try {
    await rm(path.join(OUTPUT_DIR, "dummy-on-air.png"), { force: true });
    await rm(path.join(OUTPUT_DIR, "dummy-input-monitor.png"), { force: true });
    await rm(path.join(OUTPUT_DIR, "dummy-visualizer.png"), { force: true });
  } catch {
    // Best effort cleanup.
  }
  process.exitCode = 1;
});
