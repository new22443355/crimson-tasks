import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import pg from 'pg';

const { DATABASE_URL, DATABASE_HTTP_TOKEN } = process.env;
if (!DATABASE_URL || !DATABASE_HTTP_TOKEN || DATABASE_HTTP_TOKEN.length < 32) {
  throw new Error('Set DATABASE_URL and a random DATABASE_HTTP_TOKEN in .env.local.');
}
const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 5, statement_timeout: 10000 });
const expected = Buffer.from(`Bearer ${DATABASE_HTTP_TOKEN}`);
const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  const actual = Buffer.from(req.headers.authorization ?? '');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    res.writeHead(401).end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }
  if (req.method !== 'POST' || req.url !== '/query') {
    res.writeHead(404).end(JSON.stringify({ error: 'Not found' }));
    return;
  }
  try {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 65536) {
        res.writeHead(413).end(JSON.stringify({ error: 'Payload too large' }));
        return;
      }
    }
    const { query, params } = JSON.parse(raw);
    if (typeof query !== 'string' || !Array.isArray(params)) {
      res.writeHead(400).end(JSON.stringify({ error: 'Invalid query' }));
      return;
    }
    const result = await pool.query(query, params);
    res.end(JSON.stringify({ rows: result.rows }));
  } catch (error) {
    res.writeHead(400).end(JSON.stringify({ error: 'Database query failed', code: error.code ?? 'QUERY_FAILED' }));
  }
});
const port = Number(process.env.DATABASE_HTTP_PORT ?? 5541);
await pool.query('SELECT 1');
server.listen(port, '127.0.0.1', () => console.log(`Local PostgreSQL bridge: http://127.0.0.1:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(async () => { await pool.end(); process.exit(0); }));
}
