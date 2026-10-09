// Статический сервер dist/ с теми же правилами, что в vercel.json (для e2e и локальной проверки).
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
const dist = path.resolve(import.meta.dirname, '..', 'dist')
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.webp': 'image/webp' }
const port = Number(process.env.PORT ?? 4173)
http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  let file = path.join(dist, url)
  if (!file.startsWith(dist)) { res.writeHead(400); return res.end() }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html')
  if (!fs.existsSync(file)) {
    const m = url.match(/^\/s\/([a-z0-9-]+)(\/owner)?/)
    file = m ? path.join(dist, 's', m[1], m[2] ? 'owner/index.html' : 'index.html') : path.join(dist, 'index.html')
    if (!fs.existsSync(file)) file = path.join(dist, 'index.html')
  }
  const headers = { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' }
  if (file.endsWith('sw.js')) Object.assign(headers, { 'cache-control': 'no-cache', 'service-worker-allowed': '/' })
  res.writeHead(200, headers)
  fs.createReadStream(file).pipe(res)
}).listen(port, '127.0.0.1', () => console.log(`dist на http://127.0.0.1:${port}`))
