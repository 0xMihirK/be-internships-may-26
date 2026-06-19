// tiny http helpers shared by the tests
import http from 'node:http';
import { setTimeout as wait } from 'node:timers/promises';

export function postJson(url, { headers = {}, body }) {
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers } }, (res) => {
      let buf = '';
      res.on('data', (d) => (buf += d));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(buf || '{}') }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

export function getJson(url, { headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'GET', headers }, (res) => {
      let buf = '';
      res.on('data', (d) => (buf += d));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(buf || '{}') }));
    });
    req.on('error', reject);
    req.end();
  });
}

// poll /healthz until the server is up
export async function waitForHealth(base, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await getJson(`${base}/healthz`);
      if (res.status === 200) return;
    } catch {}
    await wait(100);
  }
  throw new Error(`server at ${base} did not start`);
}
