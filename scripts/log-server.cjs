#!/usr/bin/env node
// Simple HTTP server that accepts JSON POSTs at /log and appends them to tauri-renderer.log
const http = require('http');
const fs = require('fs');
const port = process.env.LOG_SERVER_PORT ? parseInt(process.env.LOG_SERVER_PORT, 10) : 1421;
const out = process.env.LOG_SERVER_OUT || 'tauri-renderer.log';

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/log') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const line = `[${new Date().toISOString()}] ${payload.level || 'log'}: ${payload.message || JSON.stringify(payload)}\n`;
        fs.appendFileSync(out, line, 'utf8');
      } catch (e) {
        fs.appendFileSync(out, `[${new Date().toISOString()}] parse-error: ${String(e)} -- ${body}\n`, 'utf8');
      }
      res.writeHead(204);
      res.end();
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Log server listening on http://127.0.0.1:${port}/`);
});
