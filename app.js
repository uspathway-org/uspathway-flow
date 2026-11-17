// app.js — the quiz page: screens, language, saving progress, sending events.
// No customer wording lives here: it all comes from content/flow.json. Prices come from config.js.
import { CONFIG } from './config.js';
import { createEngine, newLeadId, parseResume, formatPrice, fill } from './engine.js';
import { createTracker } from './tracker.js';

const STATE_KEY = 'usp_state_v1';
const $ = sel => document.querySelector(sel);
const main = $('#main');

// ---------- storage (works even when the browser blocks it) ----------
const mem = {};
const store = {
  getItem(k) { try { return localStorage.getItem(k); } catch { return mem[k] ?? null; } },
  setItem(k, v) { try { localStorage.setItem(k, v); } catch { mem[k] = v; } },
  removeItem(k) { try { localStorage.removeItem(k); } catch { delete mem[k]; } }
};

let flow, E, tracker;
let S; // state

function freshState(lang) {
  return { v: 1, leadId: null, lang: lang || 'en', screen: 'welcome', answers: {}, pos: 0, contact: {}, seq: 0,
    startSent: false, startService: null, endSig: null, abandonSig: null, emailed: false, resume: null };
}
function save() { store.setItem(STATE_KEY, JSON.stringify(S)); }
function load() {
  try { const s = JSON.parse(store.getItem(STATE_KEY)); if (s && s.v === 1) return s; } catch { /* ignore */ }
  return null;
}

// ---------- text helpers ----------
const t = key => (flow.ui[key] ? flow.ui[key][S.lang] : key);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function serviceCode() {
  if (S.resume) return S.resume.service;
  return E.walk(S.answers).service;
}
function serviceName(code) { return flow.services[code] ? flow.services[code].name[S.lang] : ''; }

// ---------- events ----------
function base() { S.seq += 1; save(); return { leadId: S.leadId, seq: S.seq, lang: S.lang }; }
function sendEvent(type, data) {
  if (!S.leadId) return;
  tracker.send(base(), type, data);
}
function quizData() {
  const s = E.summary(S.answers);
  return { service: s.service, price: s.price, outcome: s.outcome, stopCode: s.stopCode, flags: s.flags, answers: s.answers, furthest: s.furthest, section: s.section };
}
function maybeAbandon() {
  if (!S || !S.leadId || !['q', 'contact'].includes(S.screen)) return;
  const d = quizData();
  const sig = d.furthest + '|' + d.answers.length + '|' + S.screen;
  if (sig === S.abandonSig) return;
  S.abandonSig = sig;
  const b = base();
  tracker.beacon(b, 'abandon', { service: d.service, flags: d.flags, answers: d.answers, furthest: S.screen === 'contact' ? 'Contact' : d.furthest,
    section: S.screen === 'contact' ? flow.sections.contact.en : d.section });
  save();
}

// ---------- screen changes ----------
let animating = false;
function go(screen, opts = {}) {
  S.screen = screen;
  if (opts.pos !== undefined) S.pos = opts.pos;
  save();
  const old = main.querySelector('.screen');
  if (old && !opts.instant && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    animating = true;
    old.classList.add('leaving');
    setTimeout(() => { animating = false; render(true); }, 180);
  } else {
    render(!opts.noFocus);
  }
}

function render(focus, still) {
  document.documentElement.lang = S.lang;
  document.title = t('title') + ' | USpathway';
  $('#lang').textContent = t('langSwitch');
  $('#lang').lang = S.lang === 'en' ? 'es' : 'en';
  $('#lang').setAttribute('aria-label', t('langSwitchLabel'));
  $('#back-label').textContent = t('back');
  $('#forward-label').textContent = t('forward');
  const banner = $('#test-banner');
  banner.hidden = CONFIG.mode === 'live';
  banner.textContent = t('testBanner');

  const fn = SCREENS[S.screen] || SCREENS.welcome;
  const html = fn();
  main.innerHTML = `<section class="screen${still ? ' still' : ''}" data-screen="${S.screen}"${S.screen === 'q' ? ` data-q="${E.walk(S.answers).steps[S.pos].q}"` : ''}>${html}</section>`;
  wire[S.screen] && wire[S.screen]();
  renderProgress();
  renderNav();
  if (focus) { const h = main.querySelector('h1'); if (h) h.focus({ preventScroll: true }); window.scrollTo(0, 0); }
}

function renderProgress() {
  const box = $('#progress');
  let p = null;
  if (S.screen === 'q') { const pr = E.progress(S.answers, S.pos); p = { section: flow.sections[pr.section][S.lang], percent: pr.percent }; }
  else if (S.screen === 'contact' || S.screen === 'emailme') p = { section: flow.sections.contact[S.lang], percent: 95 };
  else if (['review', 'continue', 'stop', 'waitlist', 'thanks'].includes(S.screen)) p = { section: flow.sections.result[S.lang], percent: 100 };
  else if (S.screen === 'disclosures') p = { section: flow.sections.disclosures[S.lang], percent: 100 };
  else if (S.screen === 'pay') p = { section: flow.sections.payment[S.lang], percent: 100 };
  box.hidden = !p;
  if (!p) return;
  $('#progress-section').textContent = p.section;
  $('#progress-percent').textContent = p.percent + '%';
  $('#progress-fill').style.width = p.percent + '%';
  const bar = $('#progress-bar');
  bar.setAttribute('aria-valuenow', p.percent);
  bar.setAttribute('aria-label', t('progressLabel') + ': ' + p.section);
}

function backTarget() {
  const w = E.walk(S.answers);
  switch (S.screen) {
    case 'q': return S.pos > 0 ? { screen: 'q', pos: S.pos - 1 } : { screen: 'welcome' };
    case 'contact': case 'stop': case 'waitlist': return { screen: 'q', pos: w.steps.length - 1 };
    case 'emailme': return { screen: w.outcome === 'WAITLIST' ? 'waitlist' : 'stop' };
    case 'review': case 'continue': return { screen: 'contact' };
    case 'disclosures': return S.resume ? null : { screen: 'continue' };
    case 'pay': return { screen: 'disclosures' };
  }
  return null;
}
function forwardTarget() {
  if (S.screen !== 'q') return null;
  const w = E.walk(S.answers);
  const step = w.steps[S.pos];
  if (!step || S.answers[step.q] === undefined) return null;
  if (S.pos < w.steps.length - 1) return { screen: 'q', pos: S.pos + 1 };
  return w.done ? { screen: endScreen(w) } : null;
}
function renderNav() {
  const b = backTarget(), f = forwardTarget();
  $('#nav').hidden = !b && !f;
  $('#back').disabled = !b;
  $('#forward').disabled = !f;
}

function endScreen(w) {
  if (w.outcome === 'STOP') return 'stop';
  if (w.outcome === 'WAITLIST') return 'waitlist';
  return 'contact';
}

// Called when the walk reaches an end: send stop / waitlist once per distinct result.
function reachEnd(w) {
  const screen = endScreen(w);
  const sig = JSON.stringify([w.outcome, w.stopCode, w.service, S.answers]);
  if (sig !== S.endSig && (w.outcome === 'STOP' || w.outcome === 'WAITLIST')) {
    S.endSig = sig;
    const d = quizData();
    if (w.outcome === 'STOP') sendEvent('stop', d);
    else sendEvent('waitlist', { service: d.service, outcome: 'WAITLIST', answers: d.answers, furthest: d.furthest });
  }
  go(screen);
}

function choose(id) {
  const r = E.answer(S.answers, S.pos, id);
  S.answers = r.answers;
  const w = E.walk(S.answers);
  // first answer = service chosen → "start"; a later service change → "progress"
  const svc = w.service || '';
  if (!S.startSent && S.answers.S1) { S.startSent = true; S.startService = svc; sendEvent('start', { service: svc }); }
  else if (S.startService !== svc && svc) { S.startService = svc; sendEvent('progress', { service: svc }); }
  if (r.pos < w.steps.length) return go('q', { pos: r.pos });
  reachEnd(w);
}

// ---------- screens ----------
const SCREENS = {
  welcome() {
    const has = Object.keys(S.answers).length > 0;
    return `
      <h1 tabindex="-1">${esc(t('title'))}</h1>
      <p class="lead">${esc(t('subtitle'))}</p>
      <p class="disclaimer">${esc(t('disclaimer'))}</p>
      <div class="actions">
        <button class="btn" id="start" type="button">${esc(has ? t('submit') : t('start'))}</button>
        ${has ? `<button class="btn secondary" id="restart" type="button">${esc(t('startOver'))}</button>` : ''}
      </div>`;
  },

  q() {
    const w = E.walk(S.answers);
    const step = w.steps[S.pos];
    const v = E.view(step, S.lang);
    const chosen = S.answers[step.q];
    if (v.type === 'country') {
      const opts = v.answers.map(a => `<option value="${a.id}"${a.id === chosen ? ' selected' : ''}>${esc(a.label)}</option>`).join('');
      return `
        <h1 tabindex="-1" id="qtext">${esc(v.text)}</h1>
        ${v.help ? `<p class="help">${esc(v.help)}</p>` : ''}
        <label for="country" class="sr-only">${esc(t('selectCountry'))}</label>
        <select id="country" aria-labelledby="qtext"><option value="">${esc(t('selectCountry'))}</option>${opts}</select>
        <div class="actions"><button class="btn" id="country-next" type="button"${chosen ? '' : ' disabled'}>${esc(t('next'))}</button></div>`;
    }
    const items = v.answers.map(a => `
      <li><button type="button" class="answer" role="radio" aria-checked="${a.id === chosen}" data-answer="${esc(a.id)}">${esc(a.label)}</button></li>`).join('');
    return `
      <h1 tabindex="-1" id="qtext">${esc(v.text)}</h1>
      ${v.help ? `<p class="help">${esc(v.help)}</p>` : ''}
      <ul class="answers" role="radiogroup" aria-labelledby="qtext">${items}</ul>`;
  },

  contact() { return contactForm(false); },
  emailme() { return contactForm(true); },

  review() {
    return `
      <h1 tabindex="-1">${esc(t('reviewTitle'))}</h1>
      <p>${esc(t('reviewText'))}</p>
      <h2>${esc(t('reviewNextHeading'))}</h2>
      <ul class="steps"><li>${esc(t('reviewNext1'))}</li><li>${esc(t('reviewNext2'))}</li><li>${esc(t('reviewNext3'))}</li></ul>
      <p><strong>${esc(t('reviewTime'))}</strong></p>
      <p class="disclaimer">${esc(t('disclaimerShort'))}</p>`;
  },

  continue() {
    return `
      <h1 tabindex="-1">${esc(t('continueTitle'))}</h1>
      <p>${esc(t('continueText'))}</p>
      <div class="actions"><button class="btn" id="to-disclosures" type="button">${esc(t('reviewDisclosures'))}</button></div>`;
  },

  stop() {
    const w = E.walk(S.answers);
    const msg = flow.stops[w.stopCode] ? flow.stops[w.stopCode][S.lang] : '';
    return `
      <h1 tabindex="-1">${esc(t('stopTitle'))}</h1>
      <p class="lead" data-stop="${esc(w.stopCode)}">${esc(msg)}</p>
      <p>${esc(t('stopEnd'))}</p>
      ${S.emailed ? `<p><strong>${esc(t('thanksText'))}</strong></p>` : `
      <p class="help">${esc(t('emailMeText'))}</p>
      <div class="actions"><button class="btn secondary" id="email-me" type="button">${esc(t('emailMe'))}</button></div>`}`;
  },

  waitlist() {
    return `
      <h1 tabindex="-1">${esc(t('waitlistTitle'))}</h1>
      <p class="lead">${esc(serviceName(E.walk(S.answers).service))}</p>
      <p>${esc(t('waitlistText'))}</p>
      ${S.emailed ? `<p><strong>${esc(t('thanksText'))}</strong></p>` : `
      <div class="actions"><button class="btn" id="email-me" type="button">${esc(t('emailMe'))}</button></div>`}`;
  },

  thanks() {
    return `<h1 tabindex="-1">${esc(t('thanksTitle'))}</h1><p>${esc(t('thanksText'))}</p><p class="disclaimer">${esc(t('disclaimerShort'))}</p>`;
  },

  disclosures() {
    const svc = serviceCode();
    const d = E.disclosures(svc, S.lang);
    const cards = d.sections.map((s, i) => `
      <div class="card">
        <h2 class="disc-title">${esc(s.title)}</h2>
        ${s.heading ? `<h3>${esc(s.heading)}</h3>` : ''}
        ${s.text ? `<p>${esc(s.text)}</p>` : ''}
        ${s.bullets.length ? `<ul>${s.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
        ${s.after ? `<p>${esc(s.after)}</p>` : ''}
        <label class="check"><input type="checkbox" name="disc" value="${esc(s.id)}" data-i="${i}"> <span>${esc(s.checkbox)}</span></label>
      </div>`).join('');
    return `
      <h1 tabindex="-1">${esc(fill(t('disclosuresTitle'), { service: serviceName(svc) }))}</h1>
      <p>${esc(d.intro)}</p>
      <form id="disc-form" novalidate>
        ${cards}
        <p class="error-box" id="disc-error" role="alert" hidden>${esc(t('disclosuresError'))}</p>
        <button class="btn block" type="submit">${esc(d.button)}</button>
      </form>`;
  },

  pay() {
    const svc = serviceCode();
    const price = CONFIG.services[svc].price;
    return `
      <h1 tabindex="-1">${esc(t('payTitle'))}</h1>
      <dl class="summary">
        <dt>${esc(t('payService'))}</dt><dd>${esc(flow.services[svc].fullName[S.lang])}</dd>
        <dt>${esc(t('payPrice'))}</dt><dd class="price" data-price="${price}">${esc(formatPrice(price, S.lang))}</dd>
      </dl>
      <p>${esc(t('payFees'))}</p>
      <h2>${esc(t('payAfterHeading'))}</h2>
      <p>${esc(t('payAfter'))}</p>
      <div class="actions"><button class="btn block" id="pay" type="button">${esc(t('payButton'))}</button></div>
      <p class="help">${esc(t('payNote'))}</p>`;
  },

  resumeBad() { return `<h1 tabindex="-1">${esc(t('title'))}</h1><p>${esc(t('resumeBad'))}</p>`; }
};

function contactForm(emailMe) {
  const c = S.contact || {};
  const w = E.walk(S.answers);
  const k1 = !emailMe && w.service && flow.services[w.service] && flow.services[w.service].sponsorFields;
  const intro = emailMe ? '' : (w.service === 'unsure' ? `<p class="help">${esc(t('unsureText'))}</p>` : '');
  const field = (id, type, labelKey, req, extra = '') => `
    <div class="field">
      <label for="${id}">${esc(t(labelKey))}${req ? ` <span class="req" aria-hidden="true">*</span>` : ''}</label>
      <input id="${id}" name="${id}" type="${type}" value="${esc(c[id] || '')}" ${req ? 'required aria-required="true"' : ''} ${extra} aria-describedby="${id}-err${id === 'email' && !emailMe ? ` ${id}-help` : ''}">
      ${id === 'email' && !emailMe ? `<p class="field-help" id="email-help">${esc(t('emailHelp'))}</p>` : ''}
      <p class="field-error" id="${id}-err" hidden></p>
    </div>`;
  return `
    <h1 tabindex="-1">${esc(t(emailMe ? 'contactTitleEmailMe' : 'contactTitle'))}</h1>
    ${intro}
    <form id="contact-form" novalidate>
      <div class="row2">
        ${field('firstName', 'text', 'firstName', true, 'autocomplete="given-name" maxlength="100"')}
        ${field('lastName', 'text', 'lastName', true, 'autocomplete="family-name" maxlength="100"')}
      </div>
      ${field('email', 'email', 'email', true, 'autocomplete="email" inputmode="email" maxlength="254"')}
      ${emailMe ? '' : `
      ${field('phone', 'tel', 'phone', false, 'autocomplete="tel" inputmode="tel" maxlength="30"')}
      <div class="field"><label class="check"><input type="checkbox" id="textOk" name="textOk"${c.textOk ? ' checked' : ''}> <span>${esc(t('textOk'))}</span></label></div>
      ${field('referral', 'text', 'referral', false, 'maxlength="200"')}
      ${k1 ? `<fieldset><legend>${esc(t('sponsorHeading'))}</legend>
        <div class="row2">${field('sponsorFirstName', 'text', 'sponsorFirstName', false, 'maxlength="100"')}${field('sponsorLastName', 'text', 'sponsorLastName', false, 'maxlength="100"')}</div>
        ${field('sponsorEmail', 'email', 'sponsorEmail', false, 'maxlength="254"')}
      </fieldset>` : ''}`}
      <div class="hp" aria-hidden="true"><label for="website">Website</label><input id="website" name="website" type="text" tabindex="-1" autocomplete="off"></div>
      <button class="btn block" type="submit">${esc(t(emailMe ? 'sendEmail' : 'submit'))}</button>
    </form>`;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
function readContact(form, emailMe) {
  const val = id => (form.querySelector('#' + id) ? form.querySelector('#' + id).value.trim() : '');
  const c = {
    firstName: val('firstName'), lastName: val('lastName'), email: val('email').toLowerCase(),
    phone: emailMe ? (S.contact.phone || '') : val('phone'),
    textOk: emailMe ? !!S.contact.textOk : !!(form.querySelector('#textOk') && form.querySelector('#textOk').checked),
    referral: emailMe ? (S.contact.referral || '') : val('referral'),
    sponsorFirstName: val('sponsorFirstName'), sponsorLastName: val('sponsorLastName'), sponsorEmail: val('sponsorEmail').toLowerCase()
  };
  const errors = {};
  if (!c.firstName) errors.firstName = t('errRequired');
  if (!c.lastName) errors.lastName = t('errRequired');
  if (!c.email) errors.email = t('errRequired'); else if (!EMAIL_RE.test(c.email)) errors.email = t('errEmail');
  if (!emailMe && c.phone && c.phone.replace(/\D/g, '').length < 7) errors.phone = t('errPhone');
  if (c.sponsorEmail && !EMAIL_RE.test(c.sponsorEmail)) errors.sponsorEmail = t('errEmail');
  return { c, errors, website: val('website') };
}

// ---------- wiring per screen ----------
const wire = {
  welcome() {
    $('#start').onclick = () => {
      if (!S.leadId) S.leadId = newLeadId(CONFIG.mode);
      const w = E.walk(S.answers);
      go('q', { pos: Math.min(S.pos, w.steps.length - 1) });
    };
    const r = $('#restart');
    if (r) r.onclick = () => { if (confirm(t('startOverConfirm'))) { S = freshState(S.lang); save(); go('welcome'); } };
  },
  q() {
    main.querySelectorAll('.answer').forEach(btn => {
      btn.onclick = () => {
        if (animating || main.dataset.busy) return;
        main.dataset.busy = '1';
        main.querySelectorAll('.answer').forEach(b => b.setAttribute('aria-checked', String(b === btn)));
        setTimeout(() => { delete main.dataset.busy; choose(btn.dataset.answer); }, 300);
      };
    });
    const sel = $('#country');
    if (sel) {
      sel.onchange = () => { $('#country-next').disabled = !sel.value; };
      $('#country-next').onclick = () => { if (sel.value) choose(sel.value); };
    }
  },
  contact() { wireContact(false); },
  emailme() { wireContact(true); },
  continue() { $('#to-disclosures').onclick = () => go('disclosures'); },
  stop() { const b = $('#email-me'); if (b) b.onclick = () => go('emailme'); },
  waitlist() { const b = $('#email-me'); if (b) b.onclick = () => go('emailme'); },
  disclosures() {
    const form = $('#disc-form');
    form.onchange = () => { if ([...form.querySelectorAll('input[name=disc]')].every(x => x.checked)) $('#disc-error').hidden = true; };
    form.onsubmit = e => {
      e.preventDefault();
      const boxes = [...form.querySelectorAll('input[name=disc]')];
      const missing = boxes.filter(x => !x.checked);
      if (missing.length) { $('#disc-error').hidden = false; missing[0].focus(); return; }
      const svc = serviceCode();
      sendEvent('disclosures', { service: svc, price: CONFIG.services[svc].price, contact: S.resume ? { email: S.contact.email } : {} });
      go('pay');
    };
  },
  pay() {
    $('#pay').onclick = async () => {
      const btn = $('#pay');
      btn.disabled = true;
      const svc = serviceCode();
      sendEvent('pay_clicked', { service: svc, price: CONFIG.services[svc].price });
      await tracker.drain(1500); // give the event a moment; never block payment for long
      location.assign(E.paymentUrl(svc, S.contact.email, S.leadId));
    };
  }
};

function wireContact(emailMe) {
  const form = $('#contact-form');
  form.onsubmit = e => {
    e.preventDefault();
    const { c, errors, website } = readContact(form, emailMe);
    form.querySelectorAll('.field-error').forEach(p => { p.hidden = true; p.textContent = ''; });
    form.querySelectorAll('input').forEach(i => i.removeAttribute('aria-invalid'));
    const keys = Object.keys(errors);
    if (keys.length) {
      for (const k of keys) {
        const p = $('#' + k + '-err'); p.textContent = errors[k]; p.hidden = false;
        $('#' + k).setAttribute('aria-invalid', 'true');
      }
      $('#' + keys[0]).focus();
      return;
    }
    S.contact = { ...S.contact, ...c };
    const d = quizData();
    const outcome = d.outcome || (emailMe ? 'STOP' : '');
    const ev = { ...d, outcome, contact: c };
    if (website) ev.website = website; // bot trap: the tracker drops these quietly
    sendEvent('contact', ev);
    if (emailMe) { S.emailed = true; go('thanks'); return; }
    go(outcome === 'CONTINUE' ? 'continue' : 'review');
  };
}

// ---------- start-up ----------
async function boot() {
  flow = await (await fetch('content/flow.json', { cache: 'no-cache' })).json();
  E = createEngine(flow, CONFIG);
  tracker = createTracker({ url: CONFIG.trackerUrl, storage: store });

  const qs = new URLSearchParams(location.search);
  const langParam = qs.get('lang');
  const resume = parseResume(location.search, CONFIG);
  const saved = load();

  if (resume) {
    if (saved && saved.leadId === resume.leadId && saved.resume) S = saved;
    else {
      S = freshState(resume.lang);
      S.leadId = resume.leadId;
      S.resume = { service: resume.service };
      S.contact = { email: resume.email };
      S.screen = resume.ok ? 'disclosures' : 'resumeBad';
    }
    if (!resume.ok) S.screen = 'resumeBad';
  } else {
    S = saved && !saved.resume ? saved : freshState();
    // a saved screen that no longer fits the answers falls back to the question list
    try {
      const w = E.walk(S.answers);
      if (S.screen === 'q' && !w.steps[S.pos]) S.pos = w.steps.length - 1;
    } catch { S = freshState(); }
  }
  if (langParam === 'en' || langParam === 'es') {
    S.lang = langParam;
    // apply ?lang= once, so a refresh keeps the language the customer picked later
    if (!resume) { qs.delete('lang'); history.replaceState(null, '', location.pathname + (qs.toString() ? '?' + qs : '')); }
  }
  else if (!saved && !resume && (navigator.language || '').toLowerCase().startsWith('es')) S.lang = 'es';
  save();

  $('#lang').onclick = () => { S.lang = S.lang === 'en' ? 'es' : 'en'; save(); render(false, true); };
  $('#back').onclick = () => { const b = backTarget(); if (b && !animating) go(b.screen, b); };
  $('#forward').onclick = () => { const f = forwardTarget(); if (f && !animating) go(f.screen, f); };

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') maybeAbandon(); });
  addEventListener('pagehide', maybeAbandon);

  render(false, true);
  tracker.flush();
  window.__usp = { state: () => S, pending: () => tracker.pending() }; // for tests and debugging
}

boot().catch(err => {
  console.error(err);
  main.innerHTML = '<section class="screen"><h1>Sorry, something went wrong.</h1><p>Please refresh the page, or email support@uspathway.org.</p></section>';
});
