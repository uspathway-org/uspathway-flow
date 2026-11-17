// engine.js — pure quiz logic: which question is next, flags, outcome, progress.
// No browser code here, so the same file runs in the page and in Node tests.
// All wording comes from content/flow.json; prices and switches from config.js.

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0/I/1

/** A new Lead ID: USP- + 8 characters. Test mode: USP-TEST + 4. */
export function newLeadId(mode, rand = Math.random) {
  const n = mode === 'live' ? 8 : 4;
  let s = '';
  for (let i = 0; i < n; i++) s += ALPHA[Math.floor(rand() * ALPHA.length)];
  return (mode === 'live' ? 'USP-' : 'USP-TEST') + s;
}
export function isValidLeadId(id) { return typeof id === 'string' && /^USP-[A-HJ-NP-Z2-9]{8}$/.test(id); }

export function fill(text, vars) {
  return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] !== undefined ? vars[k] : m));
}
const usd = (n, lang) => new Intl.NumberFormat(lang === 'es' ? 'es-US' : 'en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
export function formatPrice(n, lang) { return usd(n, lang); }

export function createEngine(flow, config) {
  const Q = flow.questions;
  const regionNames = {};
  const countryName = (code, lang) => {
    try { return (regionNames[lang] ||= new Intl.DisplayNames([lang], { type: 'region' })).of(code); }
    catch { return code; }
  };

  function vars(service, lang) {
    const svc = flow.services[service];
    const person = flow.people[svc ? svc.person : 'applicant'];
    return { person: person[lang], cutoff: usd(config.sponsorIncomeScreen, lang) };
  }
  function blockStart(service, idx) { return flow.blocks[flow.services[service].blocks[idx]].start; }
  function resolveAnswer(q, id, service) {
    if (q.type === 'country') return flow.countries.includes(id) ? { id } : null;
    const raw = q.answers.find(a => a.id === id);
    if (!raw) return null;
    return { ...raw, ...((raw.byService || {})[service] || {}) };
  }
  function questionText(qid, service, lang) { return fill(Q[qid].text[lang], vars(service, lang)); }
  function answerLabel(qid, id, service, lang) {
    const q = Q[qid];
    if (q.type === 'country') return countryName(id, lang);
    const a = q.answers.find(x => x.id === id);
    if (!a) return id;
    return fill((a.label || flow.answerLabels[a.id])[lang], vars(service, lang));
  }
  function makeFlag(code, qid, service, value) {
    const def = flow.flags[code];
    let label = fill(def.label, { question: questionText(qid, service, 'en') });
    if (value) label += ': ' + value;
    return { code, label, category: def.category, q: qid };
  }

  /**
   * Follow the answers from the first question.
   * Returns { steps:[{q, service, blockIdx}], current (unanswered question id or null), done,
   *           service, outcome (STOP|REVIEW|CONTINUE|WAITLIST|null), stopCode, flags, switched }.
   */
  function walk(answers) {
    const steps = [], flags = [];
    let service = null, blockIdx = 0, q = 'S1', switched = null;
    const finish = (outcome, stopCode = '') => ({ steps, current: null, done: true, service, outcome, stopCode, flags, switched });
    for (let guard = 0; guard < 300; guard++) {
      const question = Q[q];
      steps.push({ q, service, blockIdx });
      const a = answers[q] === undefined ? null : resolveAnswer(question, answers[q], service);
      if (!a || a.back) return { steps, current: q, done: false, service, outcome: null, stopCode: '', flags, switched };

      if (a.flag) flags.push(makeFlag(a.flag, q, service, a.flagValue));
      else if (a.id === 'not_sure' && !('flag' in a) && !a.stop) flags.push(makeFlag('not_sure', q, service));

      if (q === 'S1') {
        service = a.service;
        if (service === 'unsure') return finish('REVIEW');
        if (!config.services[service] || !config.services[service].online) return finish('WAITLIST');
        blockIdx = 0; q = blockStart(service, 0); continue;
      }
      if (a.stop) return finish('STOP', a.stop);
      if (a.switchTo) {
        switched = { from: service, to: a.switchTo, at: q };
        service = a.switchTo;
        if (!config.services[service] || !config.services[service].online) return finish('WAITLIST');
        blockIdx = 0; q = blockStart(service, 0); continue;
      }
      const target = a.next || question.next;
      if (target === 'END') {
        blockIdx++;
        if (blockIdx >= flow.services[service].blocks.length) return finish(flags.length ? 'REVIEW' : 'CONTINUE');
        q = blockStart(service, blockIdx);
      } else {
        q = target;
      }
    }
    throw new Error('flow loops');
  }

  /**
   * Record an answer to the question at step index pos.
   * Changing an answer clears every answer after it. Choosing the same answer keeps them.
   * Returns { answers, pos } where pos is the screen to show next.
   */
  function answer(answers, pos, id) {
    const before = walk(answers);
    const step = before.steps[pos];
    if (!step) throw new Error('no question at position ' + pos);
    const a = resolveAnswer(Q[step.q], id, step.service);
    if (!a) throw new Error('unknown answer ' + id + ' for ' + step.q);
    if (a.back) return { answers, pos: Math.max(0, pos - 1) };
    let next = { ...answers };
    if (answers[step.q] !== id) {
      for (let i = pos + 1; i < before.steps.length; i++) delete next[before.steps[i].q];
      next[step.q] = id;
    }
    const after = walk(next);
    const onPath = new Set(after.steps.map(s => s.q));
    for (const k of Object.keys(next)) if (!onPath.has(k)) delete next[k];
    return { answers: next, pos: pos + 1 };
  }

  // Longest number of questions still ahead (for the progress bar).
  const memo = new Map();
  function longest(service, blockIdx, q) {
    const key = service + '|' + blockIdx + '|' + q;
    if (memo.has(key)) return memo.get(key);
    const question = Q[q];
    let best = 0;
    if (q === 'S1') {
      for (const s of Object.keys(flow.services)) best = Math.max(best, longest(s, 0, blockStart(s, 0)));
    } else {
      const list = question.type === 'country' ? [{ id: 'x' }] : question.answers.map(r => ({ ...r, ...((r.byService || {})[service] || {}) }));
      for (const a of list) {
        if (a.stop || a.back) continue;
        let n = 0;
        if (a.switchTo) n = longest(a.switchTo, 0, blockStart(a.switchTo, 0));
        else {
          const t = a.next || question.next;
          if (t === 'END') n = blockIdx + 1 < flow.services[service].blocks.length ? longest(service, blockIdx + 1, blockStart(service, blockIdx + 1)) : 0;
          else n = longest(service, blockIdx, t);
        }
        best = Math.max(best, n);
      }
    }
    memo.set(key, 1 + best);
    return 1 + best;
  }

  /** Progress at screen pos: { percent, section (id) }. The contact screen counts as one more step. */
  function progress(answers, pos) {
    const w = walk(answers);
    const step = w.steps[Math.min(pos, w.steps.length - 1)];
    if (!step) return { percent: 0, section: 'start' };
    const remaining = longest(step.service, step.blockIdx, step.q) + 1;
    const percent = Math.round((100 * pos) / (pos + remaining));
    return { percent: Math.max(0, Math.min(99, percent)), section: Q[step.q].section };
  }

  /** What to show for one question, in one language. */
  function view(step, lang) {
    const q = Q[step.q];
    const v = vars(step.service, lang);
    let answers;
    if (q.type === 'country') {
      answers = flow.countries.map(id => ({ id, label: countryName(id, lang) }))
        .sort((a, b) => a.label.localeCompare(b.label, lang));
    } else {
      answers = q.answers.map(a => ({ id: a.id, label: fill((a.label || flow.answerLabels[a.id])[lang], v) }));
    }
    return {
      id: step.q, type: q.type || 'choice',
      section: flow.sections[q.section][lang],
      text: fill(q.text[lang], v),
      help: q.help ? fill(q.help[lang], v) : '',
      answers
    };
  }

  /** "Question → Answer" lines in English for staff. */
  function readableAnswers(answers) {
    const w = walk(answers);
    return w.steps.filter(s => answers[s.q] !== undefined && s.q !== w.current)
      .map(s => ({ q: questionText(s.q, s.service, 'en'), a: answerLabel(s.q, answers[s.q], s.service, 'en') }));
  }

  /** Everything the tracker needs about where the quiz stands. */
  function summary(answers) {
    const w = walk(answers);
    const service = w.service || '';
    const svc = config.services[service];
    return {
      service,
      price: svc ? svc.price : '',
      outcome: w.outcome || '',
      stopCode: w.stopCode,
      flags: w.flags,
      answers: readableAnswers(answers),
      furthest: w.current || w.steps[w.steps.length - 1].q,
      done: w.done
    };
  }

  function paymentUrl(service, email, leadId) {
    const base = config.services[service].paymentLink;
    const u = new URL(base);
    u.searchParams.set('prefilled_email', email);
    u.searchParams.set('client_reference_id', leadId);
    return u.toString();
  }

  /** The disclosure screen for one service and language. */
  function disclosures(service, lang) {
    const d = flow.disclosures;
    const sections = d.sections.map(sec => {
      const own = (sec.byService || {})[service] || {};
      const pick = k => (own[k] !== undefined ? own[k] : sec[k]);
      // A service's own bullets come first, then the bullets shared by every service.
      const bullets = [...(own.bullets || []), ...(sec.bullets || [])]
        .map(b => (b[service] ? b[service][lang] : b[lang]));
      return {
        id: sec.id,
        title: sec.title[lang],
        heading: pick('heading') ? pick('heading')[lang] : '',
        text: pick('text') ? pick('text')[lang] : '',
        bullets,
        after: pick('after') ? pick('after')[lang] : '',
        checkbox: pick('checkbox')[lang]
      };
    });
    return { intro: d.intro[lang], sections, button: d.button[lang] };
  }

  return { walk, answer, progress, view, readableAnswers, summary, paymentUrl, disclosures, questionText, answerLabel };
}

/** Read a resume link: ?resume=<leadId>&svc=<code>&email=<email>&lang=<en|es>. Returns null if anything is wrong. */
export function parseResume(search, config) {
  const p = new URLSearchParams(search);
  const leadId = p.get('resume');
  if (leadId === null) return null;
  const service = p.get('svc') || '';
  const email = (p.get('email') || '').trim();
  const lang = p.get('lang') === 'es' ? 'es' : 'en';
  const ok = isValidLeadId(leadId) && !!config.services[service] && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  return { ok, leadId, service, email, lang };
}
