// server.js
const { createServer } = require('http');
const next = require('next');

const port = process.env.PORT || 3001;
const host = process.env.HOST || '127.0.0.1';
const dev = process.env.NODE_ENV !== 'production';

const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  createServer((req, res) => handle(req, res)).listen(port, host, (err) => {
    if (err) throw err;
    console.log(`Ready on http://${host}:${port}`);
  });
});
