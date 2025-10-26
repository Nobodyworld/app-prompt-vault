#!/usr/bin/env node
/* eslint-env node */
// Capture console and pageerror messages from a running dev server (headless)
const puppeteer = require('puppeteer');
const fs = require('fs');
const { argv } = require('process');

const url = argv[2] || 'http://localhost:1420/';
const out = argv[3] || 'tauri-renderer.log';
const timeout = parseInt(process.env.CAPTURE_TIMEOUT || '8000', 10);

(async () => {
  const logs = [];
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();

    page.on('console', (msg) => {
      const text = msg.text();
      const type = msg.type();
      const entry = { ts: new Date().toISOString(), type, text };
      logs.push(entry);
      console.log(`[console:${type}] ${text}`);
    });

    page.on('pageerror', (err) => {
      const entry = { ts: new Date().toISOString(), type: 'pageerror', text: err.stack || String(err) };
      logs.push(entry);
      console.error('[pageerror]', err.stack || err.toString());
    });

    page.on('response', (res) => {
      const url = res.url();
      const status = res.status();
      // small log for main document
      if (res.request().resourceType() === 'document') {
        const entry = { ts: new Date().toISOString(), type: 'response', url, status };
        logs.push(entry);
        console.log(`[response] ${status} ${url}`);
      }
    });

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});

    // Wait some time to allow console errors to appear
    await new Promise((r) => setTimeout(r, timeout));

    fs.writeFileSync(out, JSON.stringify(logs, null, 2), 'utf8');
    console.log(`Captured ${logs.length} log entries to ${out}`);
  } catch (err) {
    console.error('Capture error:', err && err.stack ? err.stack : err);
    process.exitCode = 2;
  } finally {
    try { await browser.close(); } catch {}
  }
})();
