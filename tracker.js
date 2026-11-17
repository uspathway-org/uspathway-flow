// tracker.js — sends quiz events to the tracker (Apps Script web app).
// Posts are text/plain so the browser sends them without a CORS pre-check.
// Every event has an eventId (the tracker ignores repeats) and a seq number (newest wins).
// Failed sends stay in a queue saved on the phone and are retried; sending never blocks the customer.

const QUEUE_KEY = 'usp_queue_v1';

function uuid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 3 | 8)).toString(16);
  });
}

export function createTracker({ url, storage = globalThis.localStorage, onChange = () => {} }) {
  let queue = load();
  let flushing = false;
  let retryTimer = null;
  let delay = 2000;

  function load() {
    try { return JSON.parse(storage.getItem(QUEUE_KEY) || '[]'); } catch { return []; }
  }
  function save() {
    try { storage.setItem(QUEUE_KEY, JSON.stringify(queue)); } catch { /* storage full or blocked: keep in memory */ }
    onChange(queue.length);
  }

  /** Add an event to the queue and try to send it. */
  function send(base, type, data) {
    const ev = { eventId: uuid(), type, ts: new Date().toISOString(), ...base, ...data };
    queue.push(ev);
    save();
    flush();
    return ev;
  }

  async function postOne(ev) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(ev),
      redirect: 'follow',
      keepalive: true
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    let j = null;
    try { j = await r.json(); } catch { /* opaque answer: count as sent */ }
    return j;
  }

  async function flush() {
    if (flushing) return;
    if (globalThis.navigator && navigator.onLine === false) return schedule();
    flushing = true;
    try {
      while (queue.length) {
        const ev = queue[0];
        let res;
        try { res = await postOne(ev); }
        catch { schedule(); return; }
        // A refusal with reasons (bad data) will never succeed: drop it so it can't block the rest.
        if (res && res.ok === false) console.warn('tracker refused event', ev.type, res.errors);
        queue = queue.filter(e => e.eventId !== ev.eventId);
        save();
        delay = 2000;
      }
    } finally {
      flushing = false;
    }
  }

  function schedule() {
    if (retryTimer) return;
    retryTimer = setTimeout(() => { retryTimer = null; flush(); }, delay);
    delay = Math.min(delay * 2, 30000);
  }

  /**
   * Last-chance send when the page is closing (no waiting for an answer).
   * Queued events go too; they stay queued, and the eventId stops double rows.
   */
  function beacon(base, type, data) {
    const ev = data ? { eventId: uuid(), type, ts: new Date().toISOString(), ...base, ...data } : null;
    const list = ev ? [...queue, ev] : [...queue];
    if (!(globalThis.navigator && navigator.sendBeacon)) return;
    for (const e of list) {
      try { navigator.sendBeacon(url, new Blob([JSON.stringify(e)], { type: 'text/plain;charset=utf-8' })); } catch { /* ignore */ }
    }
  }

  /** Wait (up to ms) for the queue to empty. Used before leaving for Stripe. */
  async function drain(ms) {
    const end = Date.now() + ms;
    flush();
    while (queue.length && Date.now() < end) await new Promise(r => setTimeout(r, 100));
    return queue.length === 0;
  }

  if (globalThis.addEventListener) {
    addEventListener('online', () => { delay = 2000; flush(); });
  }

  return { send, flush, beacon, drain, pending: () => queue.length };
}
