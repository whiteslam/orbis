// Tiny private web server. It only answers this computer (127.0.0.1), so nobody
// else on the network can open the tree, and the page makes no outside requests.
const http = require('node:http');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const path = require('node:path');

const PORT = 3000;
const HOST = '127.0.0.1';
const ROOT = path.join(__dirname, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

const CHECK_EVERY = 15 * 60 * 1000;
const LOG = path.join(__dirname, 'tools', 'update.log');
let checking = false;

// Checks for new commits in the background, one check at a time, at low priority.
function checkCommits() {
  if (checking) return;
  checking = true;
  const child = spawn(process.execPath, [path.join(__dirname, 'tools', 'update.mjs')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  try { require('node:os').setPriority(child.pid, require('node:os').constants.priority.PRIORITY_BELOW_NORMAL); } catch {}
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  child.on('close', () => {
    checking = false;
    try {
      const old = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split('\n').slice(-200).join('\n') : '';
      fs.writeFileSync(LOG, old + output);
    } catch {}
  });
  child.on('error', () => { checking = false; });
}

const server = http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://${HOST}`);
    const wanted = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.resolve(ROOT, wanted);
    if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
      res.writeHead(403);
      res.end('Not allowed');
      return;
    }
    fs.readFile(file, (err, body) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(body);
    });
  })
  .listen(PORT, HOST, () => {
    console.log(`Gaurav's skill tree: http://localhost:${PORT}`);
    fs.writeFileSync(path.join(__dirname, 'tools', 'server.pid'), String(process.pid));
    setTimeout(checkCommits, 20 * 1000);
    setInterval(checkCommits, CHECK_EVERY);
  });

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.log(`Port ${PORT} is already in use. If the tree is already running, just open http://localhost:${PORT}`);
  else throw err;
});
