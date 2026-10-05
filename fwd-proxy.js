#!/usr/bin/env node
// Local forward proxy that chains to the egress proxy (curl-compatible behavior).
// Point Chromium at http://127.0.0.1:8899 with NO auth.
const http = require('http');
const net = require('net');

const EGRESS = new URL(process.env.HTTPS_PROXY || process.env.https_proxy);
const AUTH = 'Basic ' + Buffer.from(decodeURIComponent(EGRESS.username) + ':' + decodeURIComponent(EGRESS.password)).toString('base64');

const server = http.createServer((req, res) => {
  // plain HTTP forwarding
  const target = new URL(req.url);
  const opts = {
    host: EGRESS.hostname, port: EGRESS.port || 3128, method: req.method, path: req.url,
    headers: { ...req.headers, host: target.host, 'Proxy-Authorization': AUTH },
  };
  const proxyReq = http.request(opts, proxyRes => { res.writeHead(proxyRes.statusCode, proxyRes.headers); proxyRes.pipe(res); });
  proxyReq.on('error', e => { res.writeHead(502); res.end('proxy error: ' + e.message); });
  req.pipe(proxyReq);
});

server.on('connect', (req, sock, head) => {
  // HTTPS CONNECT tunneling
  const conn = net.connect(EGRESS.port || 3128, EGRESS.hostname, () => {
    conn.write(`CONNECT ${req.url} HTTP/1.1\r\nHost: ${req.url}\r\nProxy-Authorization: ${AUTH}\r\n\r\n`);
  });
  let buf = Buffer.alloc(0);
  conn.on('data', chunk => {
    if (sock.destroyed) return conn.destroy();
    if (head !== null) {
      buf = Buffer.concat([buf, chunk]);
      const idx = buf.indexOf('\r\n\r\n');
      if (idx !== -1) {
        const header = buf.slice(0, idx).toString();
        const status = parseInt(header.split(' ')[1], 10);
        if (status === 200) {
          sock.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          const rest = buf.slice(idx + 4);
          if (rest.length) sock.write(rest);
          conn.removeAllListeners('data');
          conn.on('data', c => sock.write(c));
          sock.on('data', c => conn.write(c));
        } else {
          sock.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
          sock.destroy(); conn.destroy();
        }
        head = null;
      }
    }
  });
  const onErr = () => { sock.destroy(); conn.destroy(); };
  conn.on('error', onErr); sock.on('error', onErr);
  if (head && head.length) conn.write(head);
});

server.listen(8899, '127.0.0.1', () => console.log('forward proxy on 127.0.0.1:8899'));
