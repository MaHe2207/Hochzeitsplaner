/* Gemeinsam – Hochzeitsplaner PWA
 * Statische, mobile-first App mit Supabase Auth/DB/Realtime.
 */

(() => {
  'use strict';

  const app = document.getElementById('app');
  const cfg = window.APP_CONFIG || {};
  const configured = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_URL.includes('DEIN-PROJEKT') && !cfg.SUPABASE_ANON_KEY.includes('DEIN_');
  const sb = configured && window.supabase ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

  const state = {
    session: null,
    user: null,
    membership: null,
    wedding: null,
    members: [],
    currentTab: localStorage.getItem('wedding.tab') || 'home',
    modal: null,
    modalPayload: null,
    authMode: 'login',
    onboardingMode: null,
    online: navigator.onLine,
    channel: null,
    reloadTimer: null,
    countdownTimer: null,
    noteSaveTimer: null,
    filters: {
      todoStatus: 'all',
      guestRsvp: 'all',
      guestTags: [],
      guestHousehold: 'all',
      guestSearch: '',
      guestSort: 'name'
    },
    notes: { sectionId: null, pageId: null, saveState: '', editing: false, expandedSectionIds: [] },
    data: emptyData()
  };

  function emptyData() {
    return {
      todoSections: [], todos: [], budgetItems: [], guests: [], guestTags: [], guestTagLinks: [], noteSections: [], notePages: []
    };
  }

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (v = '') => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const attr = esc;
  const initials = (first = '', last = '') => `${first.trim()[0] || ''}${last.trim()[0] || first.trim()[1] || ''}`.toUpperCase() || '♡';
  const uid = () => state.user?.id;
  const wid = () => state.wedding?.id;
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const formatDate = (v) => v ? new Intl.DateTimeFormat('de-DE', {day:'2-digit', month:'long', year:'numeric'}).format(new Date(`${v}T12:00:00`)) : 'Noch offen';
  const shortDate = (v) => v ? new Intl.DateTimeFormat('de-DE', {day:'2-digit', month:'2-digit', year:'2-digit'}).format(new Date(`${v}T12:00:00`)) : 'ohne Termin';
  const euros = (cents = 0) => new Intl.NumberFormat('de-DE', {style:'currency', currency:'EUR'}).format(Number(cents || 0) / 100);
  const parseEuro = (v) => Math.max(0, Math.round(Number(String(v || 0).replace(',', '.')) * 100) || 0);

  function sanitizeHtml(html = '') {
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    const root = doc.body.firstElementChild;
    root.querySelectorAll('script,style,iframe,object,embed,link,meta,form,input,button').forEach(el => el.remove());
    root.querySelectorAll('*').forEach(el => {
      [...el.attributes].forEach(a => {
        const n = a.name.toLowerCase();
        const v = a.value.trim();
        if (n.startsWith('on')) el.removeAttribute(a.name);
        if (n === 'href') {
          const safeHref = /^(https?:|mailto:|tel:|#|\/)/i.test(v);
          if (!safeHref) el.removeAttribute(a.name);
        }
        if (n === 'src' && /^javascript:/i.test(v)) el.removeAttribute(a.name);
        if (n === 'style' && /(url\s*\(|expression\s*\(|javascript:)/i.test(a.value)) el.removeAttribute('style');
      });
    });
    root.querySelectorAll('a[href]').forEach(a => {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    });
    return root.innerHTML;
  }

  function injectNotebookStyles() {
    if (document.getElementById('notebook-v2-styles')) return;
    const style = document.createElement('style');
    style.id = 'notebook-v2-styles';
    style.textContent = `
      #app .notebook-layout { display:block !important; }
      #app .notebook-sidebar { position:static !important; width:100%; }
      #app .notebook-accordion { display:grid; gap:10px; margin-bottom:16px; }
      #app .notebook-section { border:1px solid var(--line, #e6e8e3); border-radius:16px; background:rgba(255,255,255,.9); overflow:hidden; }
      #app .notebook-section-head { display:grid; grid-template-columns:auto minmax(0,1fr) auto auto; align-items:center; gap:7px; padding:8px 9px; }
      #app .notebook-section-toggle { border:0; background:transparent; color:var(--green-900, #17452e); width:34px; height:34px; display:grid; place-items:center; border-radius:9px; }
      #app .notebook-section-title { border:0; background:transparent; text-align:left; min-width:0; padding:7px 3px; font-weight:700; color:var(--ink, #172019); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      #app .notebook-section-pages { display:grid; gap:5px; padding:0 10px 10px 51px; border-top:1px solid var(--line, #e6e8e3); background:rgba(247,250,246,.7); }
      #app .notebook-page-row { width:100%; border:0; background:transparent; text-align:left; padding:10px 10px; border-radius:10px; color:#465049; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      #app .notebook-page-row.active { background:var(--green-100, #eef4ef); color:var(--green-900, #17452e); font-weight:700; }
      #app .notebook-page-row:first-child { margin-top:6px; }
      #app .notebook-empty-pages { padding:10px 8px 5px; color:var(--muted, #68716b); font-size:12px; }
      #app .note-reader-card { overflow:hidden; }
      #app .note-reader-head { display:flex; align-items:center; gap:8px; padding:15px 14px; border-bottom:1px solid var(--line, #e6e8e3); }
      #app .note-reader-title { flex:1; min-width:0; margin:0; font:600 25px/1.2 Georgia, serif; overflow-wrap:anywhere; }
      #app .note-view { min-height:220px; padding:18px; line-height:1.65; background:#fff; overflow-wrap:anywhere; }
      #app .note-view a { color:var(--green-800, #24573c); text-decoration:underline; text-underline-offset:2px; overflow-wrap:anywhere; }
      #app .note-editor-card { overflow:hidden; }
      #app .note-title-input { min-width:0; }
      #app .editor-toolbar { position:static !important; overflow-x:auto; flex-wrap:nowrap !important; -webkit-overflow-scrolling:touch; }
      #app .editor-toolbar > * { flex:0 0 auto; }
      #app .notebook-header-actions { display:flex; gap:8px; align-items:center; flex:0 0 auto; }
      @media (max-width: 699px) {
        #app .notebook-section-pages { padding-left:18px; }
        #app .note-view { min-height:180px; }
      }
    `;
    document.head.appendChild(style);
  }

  function refreshIcons() {
    try { window.lucide?.createIcons({attrs:{'stroke-width':1.7}}); } catch (_) {}
  }

  function toast(message, kind = 'ok') {
    let stack = $('.toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'toast-stack';
      document.body.appendChild(stack);
    }
    const el = document.createElement('div');
    el.className = `toast ${kind === 'error' ? 'error' : ''}`;
    el.textContent = message;
    stack.appendChild(el);
    setTimeout(() => el.remove(), 3400);
  }

  function setBusy(form, busy = true) {
    if (!form) return;
    $$('button, input, select, textarea', form).forEach(el => el.disabled = busy);
    const btn = $('button[type="submit"]', form);
    if (btn) {
      if (busy) { btn.dataset.label = btn.innerHTML; btn.innerHTML = 'Bitte warten …'; }
      else if (btn.dataset.label) { btn.innerHTML = btn.dataset.label; delete btn.dataset.label; }
    }
  }

  function renderSetupNeeded() {
    app.innerHTML = `
      <main class="auth-wrap">
        <section class="auth-card card">
          <div class="auth-logo"><div class="hearts">♡♡</div><h1>Gemeinsam</h1><em>für immer</em></div>
          <div class="notice warning"><i data-lucide="settings"></i><div><strong>Supabase noch nicht konfiguriert</strong><br><span>Trage Projekt-URL und anon/public Key in <code>config.js</code> ein und führe <code>supabase/schema.sql</code> im SQL Editor aus.</span></div></div>
          <p class="muted">Alle weiteren Schritte stehen in der README.md des Projekts.</p>
        </section>
      </main>`;
    refreshIcons();
  }

  function authScreen() {
    const signup = state.authMode === 'signup';
    app.innerHTML = `
      <main class="auth-wrap">
        <section class="auth-card card">
          <div class="auth-logo"><div class="hearts">♡♡</div><h1>Gemeinsam</h1><em>für immer</em></div>
          <div class="auth-tabs">
            <button class="auth-tab ${!signup?'active':''}" data-action="auth-mode" data-mode="login">Anmelden</button>
            <button class="auth-tab ${signup?'active':''}" data-action="auth-mode" data-mode="signup">Registrieren</button>
          </div>
          <p class="page-subtitle">Eure Planung, eure Notizen und alle Entscheidungen an einem gemeinsamen Ort.</p>
          <form data-form="auth">
            ${signup ? `<div class="field"><label>Euer Anzeigename</label><input class="input" name="display_name" autocomplete="name" required placeholder="z. B. Anna" /></div>` : ''}
            <div class="field"><label>E-Mail</label><input class="input" type="email" name="email" autocomplete="email" required placeholder="name@beispiel.de" /></div>
            <div class="field"><label>Passwort</label><input class="input" type="password" name="password" autocomplete="${signup?'new-password':'current-password'}" minlength="6" required placeholder="Mindestens 6 Zeichen" /></div>
            <button class="btn btn-primary btn-block" type="submit">${signup ? 'Konto erstellen' : 'Anmelden'}</button>
          </form>
          <div class="divider">gemeinsam planen</div>
          <p class="muted" style="text-align:center;font-size:12px">Die zweite Person erhält nach der Registrierung euren Einladungscode und hat anschließend dieselben Bearbeitungsrechte.</p>
        </section>
      </main>`;
    refreshIcons();
  }

  function onboardingScreen() {
    const pendingName = localStorage.getItem('wedding.pendingName') || state.user?.email?.split('@')[0] || '';
    if (!state.onboardingMode) {
      app.innerHTML = `
        <main class="auth-wrap">
          <section class="auth-card card">
            <div class="auth-logo"><div class="hearts">♡♡</div><h1>Hallo!</h1><em>Wie möchtet ihr starten?</em></div>
            <div class="onboarding-choice">
              <button class="choice-card" data-action="onboarding-mode" data-mode="create"><i data-lucide="heart-handshake"></i><strong>Hochzeit anlegen</strong><small>Erstellt euren gemeinsamen Planungsbereich und ladet eure Partnerperson per Code ein.</small></button>
              <button class="choice-card" data-action="onboarding-mode" data-mode="join"><i data-lucide="key-round"></i><strong>Mit Code beitreten</strong><small>Ihr habt bereits einen Einladungscode? Dann verbindet dieses Konto mit derselben Hochzeit.</small></button>
            </div>
            <button class="btn btn-ghost btn-block mt-16" data-action="logout"><i data-lucide="log-out"></i> Abmelden</button>
          </section>
        </main>`;
    } else if (state.onboardingMode === 'create') {
      app.innerHTML = `
        <main class="auth-wrap"><section class="auth-card card">
          <button class="btn btn-ghost btn-sm" data-action="onboarding-back"><i data-lucide="arrow-left"></i> Zurück</button>
          <div class="section-heading"><h2>Eure Hochzeit</h2></div>
          <form data-form="create-wedding">
            <div class="field"><label>Dein Anzeigename</label><input class="input" name="display_name" required value="${attr(pendingName)}" /></div>
            <div class="field"><label>Name der Hochzeit</label><input class="input" name="name" required value="Unsere Hochzeit" /></div>
            <div class="field"><label>Hochzeitsdatum</label><input class="input" type="date" name="wedding_date" /></div>
            <button class="btn btn-primary btn-block" type="submit">Gemeinsamen Bereich erstellen</button>
          </form>
        </section></main>`;
    } else {
      app.innerHTML = `
        <main class="auth-wrap"><section class="auth-card card">
          <button class="btn btn-ghost btn-sm" data-action="onboarding-back"><i data-lucide="arrow-left"></i> Zurück</button>
          <div class="section-heading"><h2>Einladung annehmen</h2></div>
          <form data-form="join-wedding">
            <div class="field"><label>Dein Anzeigename</label><input class="input" name="display_name" required value="${attr(pendingName)}" /></div>
            <div class="field"><label>Einladungscode</label><input class="input" name="code" required maxlength="12" autocapitalize="characters" placeholder="z. B. A1B2C3D4" style="text-transform:uppercase;letter-spacing:.12em" /></div>
            <button class="btn btn-primary btn-block" type="submit">Beitreten</button>
          </form>
        </section></main>`;
    }
    refreshIcons();
  }

  function shell(viewHtml) {
    return `
      <div class="app-shell">
        <header class="topbar">
          <div class="brand-small"><span class="hearts">♡♡</span><strong>${esc(state.wedding?.name || 'Gemeinsam')}</strong></div>
          <div class="top-actions">
            <button class="icon-btn" data-action="open-settings" aria-label="Einstellungen"><i data-lucide="user-round"></i></button>
          </div>
        </header>
        <main class="view">${!state.online ? `<div class="notice warning"><i data-lucide="wifi-off"></i><div><strong>Offline</strong><br><span>Der zuletzt geladene Stand ist sichtbar. Änderungen brauchen eine Internetverbindung.</span></div></div>` : ''}${viewHtml}</main>
        <nav class="bottom-nav">
          ${navButton('home','house','Home')}
          ${navButton('todos','square-check-big','Aufgaben')}
          ${navButton('budget','wallet-cards','Budget')}
          ${navButton('guests','users-round','Gäste')}
          ${navButton('notes','notebook-tabs','Notizen')}
        </nav>
        ${state.modal ? modalHtml() : ''}
      </div>`;
  }

  function navButton(tab, icon, label) {
    return `<button class="nav-btn ${state.currentTab===tab?'active':''}" data-action="tab" data-tab="${tab}"><i data-lucide="${icon}"></i><span>${label}</span></button>`;
  }

  function homeView() {
    const d = state.data;
    const openTodos = d.todos.filter(t => t.status !== 'done').length;
    const yesPeople = d.guests.filter(g => g.rsvp_status === 'yes').reduce((s,g)=>s+Number(g.party_size||1),0);
    const totalPeople = d.guests.reduce((s,g)=>s+Number(g.party_size||1),0);
    const planned = d.budgetItems.reduce((s,b)=>s+Number(b.planned_cents||0),0);
    const actual = d.budgetItems.reduce((s,b)=>s+Number(b.actual_cents||0),0);
    const upcoming = [...d.todos].filter(t => t.status !== 'done' && t.due_date).sort((a,b)=>a.due_date.localeCompare(b.due_date))[0];
    const member = state.members.find(m => m.user_id === uid());

    return `
      <section class="hero-card">
        <span class="hero-eyebrow">Hallo ${esc(member?.display_name || 'ihr Zwei')}</span>
        <h1>Noch ein bisschen bis zum großen Tag.</h1>
        <div class="wedding-date">${formatDate(state.wedding?.wedding_date)}</div>
        <div class="countdown" id="countdown">
          <div class="count"><b data-cd="days">–</b><span>Tage</span></div>
          <div class="count"><b data-cd="hours">–</b><span>Stunden</span></div>
          <div class="count"><b data-cd="mins">–</b><span>Minuten</span></div>
          <div class="count"><b data-cd="secs">–</b><span>Sekunden</span></div>
        </div>
      </section>

      <div class="stats-grid">
        <button class="card stat-card" data-action="tab" data-tab="todos"><span class="stat-icon"><i data-lucide="square-check-big"></i></span><div><b>${openTodos}</b><span> offene Aufgaben</span></div></button>
        <button class="card stat-card" data-action="tab" data-tab="guests"><span class="stat-icon"><i data-lucide="users-round"></i></span><div><b>${yesPeople}/${totalPeople}</b><span> Personen zugesagt</span></div></button>
        <button class="card stat-card" data-action="tab" data-tab="budget"><span class="stat-icon"><i data-lucide="wallet-cards"></i></span><div><b>${euros(actual)}</b><span> von ${euros(planned)}</span></div></button>
        <button class="card stat-card" data-action="tab" data-tab="notes"><span class="stat-icon"><i data-lucide="notebook-tabs"></i></span><div><b>${d.notePages.length}</b><span> Notizseiten</span></div></button>
      </div>

      ${upcoming ? `<div class="section-heading"><h2>Als Nächstes</h2></div>
        <div class="card card-pad flex items-center justify-between gap-12">
          <div><strong>${esc(upcoming.title)}</strong><div class="muted mt-8"><i data-lucide="calendar-days" style="width:15px;vertical-align:-2px"></i> ${shortDate(upcoming.due_date)}</div></div>
          <button class="btn btn-secondary btn-sm" data-action="edit-todo" data-id="${upcoming.id}">Öffnen</button>
        </div>` : ''}

      <div class="section-heading"><h2>Gemeinsam planen</h2><small>${state.members.length} Mitglied${state.members.length===1?'':'er'}</small></div>
      <div class="card card-pad">
        <p class="mb-0"><strong>Einladungscode</strong></p>
        <p class="muted">Teilt diesen Code nur miteinander. Die zweite Person kann damit denselben Planungsbereich öffnen.</p>
        <div class="invite-code"><code>${esc(state.wedding?.invite_code || '')}</code><button class="btn btn-secondary btn-sm" data-action="copy-invite"><i data-lucide="copy"></i> Kopieren</button></div>
      </div>`;
  }

  function todosView() {
    const sections = state.data.todoSections;
    const status = state.filters.todoStatus;
    const todos = state.data.todos.filter(t => status === 'all' || t.status === status);
    const unsectioned = todos.filter(t => !t.section_id);
    const renderSection = (section, items) => `
      <section class="todo-section">
        <div class="todo-section-head">
          <h3>${esc(section?.title || 'Ohne Bereich')}</h3>
          ${section ? `<button class="icon-btn" style="width:34px;height:34px" data-action="edit-todo-section" data-id="${section.id}"><i data-lucide="pencil"></i></button>` : ''}
        </div>
        <div class="list">${items.length ? items.map(todoRow).join('') : `<div class="empty-state card"><span>Hier ist noch nichts eingetragen.</span></div>`}</div>
      </section>`;

    return `
      <h1 class="page-title">Aufgaben</h1>
      <p class="page-subtitle">Strukturiert eure Vorbereitung in frei benennbare Bereiche, Termine und Zuständigkeiten.</p>
      <div class="flex gap-8" style="flex-wrap:wrap">
        <button class="btn btn-primary" data-action="new-todo"><i data-lucide="plus"></i> Aufgabe</button>
        <button class="btn btn-secondary" data-action="new-todo-section"><i data-lucide="folder-plus"></i> Bereich</button>
      </div>
      <div class="chips mt-16">
        ${[['all','Alle'],['open','Offen'],['doing','In Arbeit'],['done','Erledigt']].map(([v,l])=>`<button class="chip ${status===v?'active':''}" data-action="todo-filter" data-value="${v}">${l} (${state.data.todos.filter(t=>v==='all'||t.status===v).length})</button>`).join('')}
      </div>
      ${sections.map(s=>renderSection(s, todos.filter(t=>t.section_id===s.id))).join('')}
      ${(unsectioned.length || !sections.length) ? renderSection(null, unsectioned) : ''}`;
  }

  function todoRow(t) {
    const assignee = state.members.find(m => m.user_id === t.assignee_id);
    const meta = [t.due_date ? shortDate(t.due_date) : '', assignee ? assignee.display_name : 'Gemeinsam'].filter(Boolean).join(' · ');
    return `<div class="list-row todo-item ${t.status==='done'?'done':''}">
      <button class="todo-check ${t.status==='done'?'done':''}" data-action="toggle-todo" data-id="${t.id}" aria-label="Status ändern">${t.status==='done'?'<i data-lucide="check"></i>':''}</button>
      <button class="row-main" style="border:0;background:transparent;text-align:left;padding:0" data-action="edit-todo" data-id="${t.id}"><strong>${esc(t.title)}</strong><small>${esc(meta)}</small></button>
      <span class="badge ${t.priority==='high'?'high':t.status==='doing'?'warn':''}">${t.priority==='high'?'Hoch':t.status==='doing'?'In Arbeit':t.status==='done'?'Erledigt':'Offen'}</span>
    </div>`;
  }

  function budgetView() {
    const items = state.data.budgetItems;
    const planned = items.reduce((s,b)=>s+Number(b.planned_cents||0),0);
    const actual = items.reduce((s,b)=>s+Number(b.actual_cents||0),0);
    const paid = items.reduce((s,b)=>s+Number(b.paid_cents||0),0);
    const pct = planned ? Math.min(100, Math.round(actual/planned*100)) : 0;
    const categories = [...new Set(items.map(i=>i.category))].sort((a,b)=>a.localeCompare(b,'de'));

    return `
      <h1 class="page-title">Budget</h1>
      <p class="page-subtitle">Soll, tatsächliche Kosten und bereits bezahlte Beträge bleiben für euch beide aktuell.</p>
      <button class="btn btn-primary" data-action="new-budget"><i data-lucide="plus"></i> Kostenpunkt</button>
      <div class="budget-summary mt-16">
        <div class="card budget-kpi"><small>Geplant</small><b>${euros(planned)}</b></div>
        <div class="card budget-kpi"><small>Tatsächlich</small><b>${euros(actual)}</b></div>
        <div class="card budget-kpi"><small>Bezahlt</small><b>${euros(paid)}</b></div>
      </div>
      <div class="card card-pad mt-12"><div class="flex justify-between gap-12"><span class="muted">Budget-Nutzung</span><strong>${pct}%</strong></div><div class="progress-track mt-8"><div class="progress-bar" style="width:${pct}%"></div></div></div>
      ${categories.map(cat => {
        const list = items.filter(i=>i.category===cat);
        return `<div class="section-heading"><h2>${esc(cat)}</h2><small>${euros(list.reduce((s,b)=>s+Number(b.actual_cents||0),0))}</small></div><div class="list">${list.map(budgetRow).join('')}</div>`;
      }).join('')}
      ${!items.length ? `<div class="empty-state card mt-16"><i data-lucide="wallet-cards"></i><strong>Noch keine Kosten eingetragen</strong><span>Legt den ersten Kostenpunkt für Location, Ringe, Floristik oder etwas ganz Eigenes an.</span></div>` : ''}`;
  }

  function budgetRow(b) {
    const sub = [b.vendor, b.due_date ? `fällig ${shortDate(b.due_date)}` : ''].filter(Boolean).join(' · ');
    return `<button class="list-row clickable" style="width:100%;text-align:left" data-action="edit-budget" data-id="${b.id}">
      <span class="stat-icon"><i data-lucide="receipt-text"></i></span>
      <span class="row-main"><strong>${esc(b.title)}</strong><small>${esc(sub || b.category)}</small></span>
      <span style="text-align:right"><strong class="money">${euros(b.actual_cents)}</strong><small class="muted" style="display:block">von ${euros(b.planned_cents)}</small></span>
    </button>`;
  }

  function guestsView() {
    const d = state.data;
    const rsvp = state.filters.guestRsvp;
    const selectedTags = Array.isArray(state.filters.guestTags) ? state.filters.guestTags : [];
    const householdFilter = state.filters.guestHousehold || 'all';
    const q = state.filters.guestSearch.trim().toLocaleLowerCase('de-DE');

    // Haushalte sind frei benennbar. Gleiche Namen (Groß-/Kleinschreibung ignoriert)
    // werden als ein Haushalt gezählt.
    const householdMap = new Map();
    d.guests.forEach(g => {
      const label = String(g.household || '').trim();
      if (!label) return;
      const key = label.toLocaleLowerCase('de-DE');
      if (!householdMap.has(key)) householdMap.set(key, label);
    });
    const households = [...householdMap.entries()]
      .map(([key, label]) => ({key, label}))
      .sort((a,b) => a.label.localeCompare(b.label, 'de'));

    let guests = d.guests.filter(g => {
      const rsvpOk = rsvp === 'all' || g.rsvp_status === rsvp;

      // Mehrere Tags werden als UND-Filter kombiniert:
      // Ein Gast muss alle ausgewählten Tags besitzen.
      const guestTagIds = d.guestTagLinks
        .filter(link => link.guest_id === g.id)
        .map(link => link.tag_id);
      const tagOk = selectedTags.length === 0 || selectedTags.every(tagId => guestTagIds.includes(tagId));

      const householdKey = String(g.household || '').trim().toLocaleLowerCase('de-DE');
      const householdOk = householdFilter === 'all' || householdKey === householdFilter;
      const searchOk = !q || `${g.first_name} ${g.last_name} ${g.household || ''}`.toLocaleLowerCase('de-DE').includes(q);
      return rsvpOk && tagOk && householdOk && searchOk;
    });

    const sort = state.filters.guestSort;
    guests.sort((a,b) => {
      if (sort === 'rsvp') return a.rsvp_status.localeCompare(b.rsvp_status) || `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`,'de');
      if (sort === 'size') return Number(b.party_size)-Number(a.party_size) || `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`,'de');
      if (sort === 'household') {
        const ah = String(a.household || '').trim();
        const bh = String(b.household || '').trim();
        if (!ah && bh) return 1;
        if (ah && !bh) return -1;
        return ah.localeCompare(bh, 'de') || `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`,'de');
      }
      return `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`,'de');
    });

    const personCount = d.guests.reduce((s,g)=>s+Number(g.party_size||1),0);
    const yesCount = d.guests.filter(g=>g.rsvp_status==='yes').reduce((s,g)=>s+Number(g.party_size||1),0);
    const openCount = d.guests.filter(g=>g.rsvp_status==='open').reduce((s,g)=>s+Number(g.party_size||1),0);
    const noCount = d.guests.filter(g=>g.rsvp_status==='no').reduce((s,g)=>s+Number(g.party_size||1),0);

    // Diese Zahl entspricht immer exakt der gerade sichtbaren, gefilterten Liste.
    const visibleEntryCount = guests.length;
    const visibleHouseholdCount = new Set(
      guests
        .map(g => String(g.household || '').trim().toLocaleLowerCase('de-DE'))
        .filter(Boolean)
    ).size;
    const totalHouseholdCount = households.length;

    return `
      <div class="flex items-center justify-between gap-12"><div><h1 class="page-title">Gästeliste</h1><p class="page-subtitle"><strong>${visibleEntryCount} ${visibleEntryCount===1?'Eintrag':'Einträge'}</strong> · ${visibleHouseholdCount} von ${totalHouseholdCount} ${totalHouseholdCount===1?'Haushalt':'Haushalten'} · ${personCount} Personen insgesamt</p></div><button class="btn btn-primary btn-sm" data-action="new-guest"><i data-lucide="user-plus"></i><span class="hidden-mobile"> Gast</span></button></div>
      <div class="chips">
        ${[['all',`Alle (${personCount})`],['yes',`Zugesagt (${yesCount})`],['open',`Offen (${openCount})`],['no',`Abgesagt (${noCount})`]].map(([v,l])=>`<button class="chip ${rsvp===v?'active':''}" data-action="guest-rsvp-filter" data-value="${v}">${l}</button>`).join('')}
      </div>
      <div class="search-row">
        <div class="search-box"><i data-lucide="search"></i><input class="input" id="guest-search" value="${attr(state.filters.guestSearch)}" placeholder="Gäste oder Haushalt suchen …" /></div>
        <button class="btn btn-secondary" data-action="manage-tags"><i data-lucide="tags"></i></button>
      </div>
      <div class="chips" style="margin-bottom:8px">
        <button class="chip ${selectedTags.length===0?'active':''}" data-action="guest-tag-filter" data-value="all">Alle Tags</button>
        ${d.guestTags.map(t=>`<button class="chip ${selectedTags.includes(t.id)?'tag-active':''}" style="background:${esc(t.color)}" data-action="guest-tag-filter" data-value="${t.id}" aria-pressed="${selectedTags.includes(t.id)?'true':'false'}">${esc(t.name)}</button>`).join('')}
      </div>
      <div class="form-grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;margin-bottom:12px">
        <select class="select" id="guest-household-filter" aria-label="Nach Haushalt filtern">
          <option value="all" ${householdFilter==='all'?'selected':''}>Alle Haushalte (${totalHouseholdCount})</option>
          ${households.map(h => {
            const count = d.guests.filter(g => String(g.household || '').trim().toLocaleLowerCase('de-DE') === h.key).length;
            return `<option value="${attr(h.key)}" ${householdFilter===h.key?'selected':''}>${esc(h.label)} (${count})</option>`;
          }).join('')}
        </select>
        <select class="select" id="guest-sort" aria-label="Gäste sortieren">
          <option value="name" ${sort==='name'?'selected':''}>Sortierung: Name</option>
          <option value="household" ${sort==='household'?'selected':''}>Sortierung: Haushalt</option>
          <option value="rsvp" ${sort==='rsvp'?'selected':''}>Sortierung: RSVP</option>
          <option value="size" ${sort==='size'?'selected':''}>Sortierung: Personen</option>
        </select>
      </div>
      <div class="list mt-12">${guests.map(guestRow).join('')}</div>
      ${!guests.length ? `<div class="empty-state card mt-12"><i data-lucide="users-round"></i><strong>Keine passenden Gäste</strong><span>Ändert Filter oder legt einen neuen Gast an.</span></div>` : ''}`;
  }

  function guestRow(g) {
    const tags = state.data.guestTagLinks.filter(l=>l.guest_id===g.id).map(l=>state.data.guestTags.find(t=>t.id===l.tag_id)).filter(Boolean);
    const badge = g.rsvp_status==='yes' ? ['Zugesagt','success'] : g.rsvp_status==='no' ? ['Abgesagt','danger'] : ['Offen',''];
    return `<button class="list-row clickable" style="width:100%;text-align:left" data-action="edit-guest" data-id="${g.id}">
      <span class="avatar">${initials(g.first_name,g.last_name)}</span>
      <span class="row-main"><strong>${esc(`${g.first_name} ${g.last_name}`.trim())}</strong><small>${g.party_size} ${Number(g.party_size)===1?'Person':'Personen'}${g.household?` · Haushalt ${esc(g.household)}`:''}</small><span class="tags-inline">${tags.map(t=>`<span class="mini-tag" style="background:${esc(t.color)}">${esc(t.name)}</span>`).join('')}</span></span>
      <span class="badge ${badge[1]}">${badge[0]}</span>
    </button>`;
  }

  function notesView() {
    const d = state.data;
    const sectionIds = new Set(d.noteSections.map(s => s.id));
    const pageIds = new Set(d.notePages.map(p => p.id));

    if (state.notes.sectionId && !sectionIds.has(state.notes.sectionId)) state.notes.sectionId = null;
    if (state.notes.pageId && !pageIds.has(state.notes.pageId)) state.notes.pageId = null;

    if (!state.notes.sectionId && d.noteSections[0]) state.notes.sectionId = d.noteSections[0].id;
    if (!Array.isArray(state.notes.expandedSectionIds)) state.notes.expandedSectionIds = [];
    if (state.notes.sectionId && !state.notes.expandedSectionIds.includes(state.notes.sectionId)) {
      state.notes.expandedSectionIds.push(state.notes.sectionId);
    }

    const section = d.noteSections.find(s => s.id === state.notes.sectionId) || null;
    const page = d.notePages.find(p => p.id === state.notes.pageId) || null;
    if (page && page.section_id !== state.notes.sectionId) state.notes.sectionId = page.section_id;

    const sectionList = d.noteSections.map(s => {
      const isOpen = state.notes.expandedSectionIds.includes(s.id);
      const isActiveSection = state.notes.sectionId === s.id;
      const pages = d.notePages
        .filter(p => p.section_id === s.id)
        .sort((a,b) => a.position - b.position || a.created_at.localeCompare(b.created_at));

      return `
        <section class="notebook-section ${isActiveSection ? 'active' : ''}">
          <div class="notebook-section-head">
            <button class="notebook-section-toggle" data-action="toggle-note-section" data-id="${s.id}" aria-label="Kapitel ${isOpen ? 'zuklappen' : 'aufklappen'}">
              <i data-lucide="${isOpen ? 'chevron-down' : 'chevron-right'}"></i>
            </button>
            <button class="notebook-section-title" data-action="toggle-note-section" data-id="${s.id}">${esc(s.title)}</button>
            <button class="icon-btn" style="width:34px;height:34px" data-action="new-note-page" data-section-id="${s.id}" title="Neue Seite"><i data-lucide="file-plus-2"></i></button>
            <button class="icon-btn" style="width:34px;height:34px" data-action="edit-note-section" data-id="${s.id}" title="Kapitel bearbeiten"><i data-lucide="pencil"></i></button>
          </div>
          ${isOpen ? `<div class="notebook-section-pages">
            ${pages.length ? pages.map(p => `
              <button class="notebook-page-row ${state.notes.pageId === p.id ? 'active' : ''}" data-action="select-note-page" data-id="${p.id}">
                ${esc(p.title || 'Neue Seite')}
              </button>`).join('') : `<div class="notebook-empty-pages">Noch keine Seiten in diesem Kapitel.</div>`}
          </div>` : ''}
        </section>`;
    }).join('');

    let pageArea = '';
    if (!page) {
      pageArea = `<div class="empty-state card">
        <i data-lucide="file-heart"></i>
        <strong>${d.noteSections.length ? 'Seite auswählen' : 'Noch kein Kapitel'}</strong>
        <span>${d.noteSections.length ? 'Klappt ein Kapitel auf und tippt auf den Titel einer Seite.' : 'Legt zuerst ein Kapitel an.'}</span>
      </div>`;
    } else if (state.notes.editing) {
      pageArea = `
        <section class="card note-editor-card">
          <div class="note-reader-head">
            <input class="note-title-input" id="note-title" value="${attr(page.title)}" aria-label="Seitentitel" />
            <button class="icon-btn" data-action="finish-note-edit" title="Bearbeitung beenden"><i data-lucide="check"></i></button>
            <button class="icon-btn" data-action="delete-note-page" data-id="${page.id}" title="Seite löschen"><i data-lucide="trash-2"></i></button>
          </div>
          <div class="editor-toolbar">
            <button class="tool-btn" data-command="bold" title="Fett"><b>B</b></button>
            <button class="tool-btn" data-command="italic" title="Kursiv"><i>I</i></button>
            <button class="tool-btn" data-command="underline" title="Unterstrichen"><u>U</u></button>
            <button class="tool-btn" data-command="insertUnorderedList" title="Aufzählung">•≡</button>
            <button class="tool-btn" data-command="insertOrderedList" title="Nummerierung">1.</button>
            <button class="tool-btn" data-action="insert-note-link" title="Link einfügen"><i data-lucide="link"></i></button>
            <select class="tool-select" data-editor-size title="Schriftgröße"><option value="3">Normal</option><option value="2">Klein</option><option value="4">Groß</option><option value="5">Sehr groß</option></select>
            <select class="tool-select" data-editor-block title="Absatz"><option value="p">Absatz</option><option value="h1">Titel</option><option value="h2">Überschrift</option><option value="blockquote">Zitat</option></select>
            <input class="tool-color" type="color" data-editor-color value="#172019" title="Textfarbe" />
            <button class="tool-btn" data-command="removeFormat" title="Formatierung entfernen">Tx</button>
          </div>
          <div class="note-editor" id="note-editor" contenteditable="true" spellcheck="true">${sanitizeHtml(page.content_html)}</div>
          <div class="note-save-state" id="note-save-state">${esc(state.notes.saveState || 'Synchronisiert')}</div>
        </section>`;
    } else {
      pageArea = `
        <section class="card note-reader-card">
          <div class="note-reader-head">
            <h2 class="note-reader-title">${esc(page.title || 'Neue Seite')}</h2>
            <button class="icon-btn" data-action="edit-note-page" data-id="${page.id}" title="Seite bearbeiten"><i data-lucide="pencil"></i></button>
          </div>
          <div class="note-view">${page.content_html ? sanitizeHtml(page.content_html) : '<span class="muted">Noch kein Inhalt. Tippt auf den Stift, um diese Seite zu bearbeiten.</span>'}</div>
        </section>`;
    }

    return `
      <div class="flex items-center justify-between gap-12">
        <div><h1 class="page-title">Notizbuch</h1><p class="page-subtitle">Kapitel aufklappen, Seite auswählen und über den Stift bearbeiten.</p></div>
        <div class="notebook-header-actions"><button class="btn btn-primary btn-sm" data-action="new-note-section"><i data-lucide="folder-plus"></i> Kapitel</button></div>
      </div>
      <div class="notebook-accordion">${sectionList}</div>
      ${pageArea}`;
  }

  function modalHtml() {
    const type = state.modal;
    const p = state.modalPayload || {};
    let title = '';
    let body = '';

    if (type === 'todo') {
      const t = p.id ? state.data.todos.find(x=>x.id===p.id) : null;
      title = t ? 'Aufgabe bearbeiten' : 'Neue Aufgabe';
      body = `<form data-form="save-todo" data-id="${t?.id || ''}">
        <div class="field"><label>Titel</label><input class="input" name="title" required value="${attr(t?.title || '')}" placeholder="z. B. Fotograf:in buchen" /></div>
        <div class="field"><label>Notiz</label><textarea class="textarea" name="description" placeholder="Details, Links, Fragen …">${esc(t?.description || '')}</textarea></div>
        <div class="form-grid">
          <div class="field"><label>Bereich</label><select class="select" name="section_id"><option value="">Ohne Bereich</option>${state.data.todoSections.map(s=>`<option value="${s.id}" ${t?.section_id===s.id?'selected':''}>${esc(s.title)}</option>`).join('')}</select></div>
          <div class="field"><label>Termin</label><input class="input" type="date" name="due_date" value="${attr(t?.due_date || '')}" /></div>
          <div class="field"><label>Status</label><select class="select" name="status"><option value="open" ${t?.status==='open'?'selected':''}>Offen</option><option value="doing" ${t?.status==='doing'?'selected':''}>In Arbeit</option><option value="done" ${t?.status==='done'?'selected':''}>Erledigt</option></select></div>
          <div class="field"><label>Priorität</label><select class="select" name="priority"><option value="low" ${t?.priority==='low'?'selected':''}>Niedrig</option><option value="normal" ${!t||t.priority==='normal'?'selected':''}>Normal</option><option value="high" ${t?.priority==='high'?'selected':''}>Hoch</option></select></div>
          <div class="field"><label>Zuständig</label><select class="select" name="assignee_id"><option value="">Gemeinsam</option>${state.members.map(m=>`<option value="${m.user_id}" ${t?.assignee_id===m.user_id?'selected':''}>${esc(m.display_name)}</option>`).join('')}</select></div>
        </div>
        <div class="form-actions">${t?`<button type="button" class="btn btn-danger" data-action="delete-todo" data-id="${t.id}">Löschen</button>`:''}<button class="btn btn-primary" type="submit">Speichern</button></div>
      </form>`;
    }

    if (type === 'todo-section') {
      const s = p.id ? state.data.todoSections.find(x=>x.id===p.id) : null;
      title = s ? 'Bereich bearbeiten' : 'Neuer Aufgabenbereich';
      body = `<form data-form="save-todo-section" data-id="${s?.id || ''}"><div class="field"><label>Name</label><input class="input" name="title" required value="${attr(s?.title || '')}" placeholder="z. B. Trauung, Feier, Papierkram" /></div><div class="form-actions">${s?`<button type="button" class="btn btn-danger" data-action="delete-todo-section" data-id="${s.id}">Bereich löschen</button>`:''}<button class="btn btn-primary" type="submit">Speichern</button></div></form>`;
    }

    if (type === 'budget') {
      const b = p.id ? state.data.budgetItems.find(x=>x.id===p.id) : null;
      title = b ? 'Kostenpunkt bearbeiten' : 'Neuer Kostenpunkt';
      body = `<form data-form="save-budget" data-id="${b?.id || ''}">
        <div class="form-grid"><div class="field"><label>Titel</label><input class="input" name="title" required value="${attr(b?.title || '')}" /></div><div class="field"><label>Kategorie</label><input class="input" name="category" required value="${attr(b?.category || 'Sonstiges')}" list="budget-cats" /><datalist id="budget-cats"><option>Location</option><option>Catering</option><option>Floristik</option><option>Foto & Video</option><option>Musik</option><option>Kleidung</option><option>Ringe</option><option>Papeterie</option><option>Dekoration</option><option>Transport</option></datalist></div></div>
        <div class="field"><label>Dienstleister / Anbieter</label><input class="input" name="vendor" value="${attr(b?.vendor || '')}" /></div>
        <div class="form-grid"><div class="field"><label>Geplant (€)</label><input class="input" inputmode="decimal" name="planned" value="${attr(((b?.planned_cents||0)/100).toFixed(2).replace('.',','))}" /></div><div class="field"><label>Tatsächlich (€)</label><input class="input" inputmode="decimal" name="actual" value="${attr(((b?.actual_cents||0)/100).toFixed(2).replace('.',','))}" /></div><div class="field"><label>Bezahlt (€)</label><input class="input" inputmode="decimal" name="paid" value="${attr(((b?.paid_cents||0)/100).toFixed(2).replace('.',','))}" /></div><div class="field"><label>Fällig am</label><input class="input" type="date" name="due_date" value="${attr(b?.due_date || '')}" /></div></div>
        <div class="field"><label>Notizen</label><textarea class="textarea" name="notes">${esc(b?.notes || '')}</textarea></div>
        <div class="form-actions">${b?`<button type="button" class="btn btn-danger" data-action="delete-budget" data-id="${b.id}">Löschen</button>`:''}<button class="btn btn-primary" type="submit">Speichern</button></div>
      </form>`;
    }

    if (type === 'guest') {
      const g = p.id ? state.data.guests.find(x=>x.id===p.id) : null;
      const linked = new Set(g ? state.data.guestTagLinks.filter(l=>l.guest_id===g.id).map(l=>l.tag_id) : []);
      title = g ? 'Gast bearbeiten' : 'Gast hinzufügen';
      body = `<form data-form="save-guest" data-id="${g?.id || ''}">
        <div class="form-grid"><div class="field"><label>Vorname</label><input class="input" name="first_name" required value="${attr(g?.first_name || '')}" /></div><div class="field"><label>Nachname</label><input class="input" name="last_name" value="${attr(g?.last_name || '')}" /></div></div>
        <div class="field"><label>Haushalt</label><input class="input" name="household" value="${attr(g?.household || '')}" placeholder="z. B. Familie Müller" /></div>
        <div class="form-grid"><div class="field"><label>RSVP</label><select class="select" name="rsvp_status"><option value="open" ${!g||g.rsvp_status==='open'?'selected':''}>Offen</option><option value="yes" ${g?.rsvp_status==='yes'?'selected':''}>Zugesagt</option><option value="no" ${g?.rsvp_status==='no'?'selected':''}>Abgesagt</option></select></div><div class="field"><label>Personen</label><input class="input" type="number" min="1" max="20" name="party_size" value="${attr(g?.party_size || 1)}" /></div></div>
        <div class="field"><label>Tags</label><div class="chips">${state.data.guestTags.length?state.data.guestTags.map(t=>`<label class="chip" style="background:${esc(t.color)}"><input type="checkbox" name="tag_ids" value="${t.id}" ${linked.has(t.id)?'checked':''} /> ${esc(t.name)}</label>`).join(''):'<span class="muted">Noch keine Tags angelegt.</span>'}</div></div>
        <div class="field"><label>Notizen</label><textarea class="textarea" name="notes">${esc(g?.notes || '')}</textarea></div>
        <div class="form-actions">${g?`<button type="button" class="btn btn-danger" data-action="delete-guest" data-id="${g.id}">Löschen</button>`:''}<button class="btn btn-primary" type="submit">Speichern</button></div>
      </form>`;
    }

    if (type === 'tags') {
      title = 'Gäste-Tags';
      body = `<form data-form="add-tag"><div class="form-grid"><div class="field"><label>Neuer Tag</label><input class="input" name="name" required placeholder="z. B. Familie, Freunde, Kinder" /></div><div class="field"><label>Farbe</label><input class="input" type="color" name="color" value="#dfe9e2" style="height:48px;padding:5px" /></div></div><button class="btn btn-primary btn-sm" type="submit"><i data-lucide="plus"></i> Tag anlegen</button></form><div class="list mt-16">${state.data.guestTags.map(t=>`<div class="list-row"><span class="avatar" style="background:${esc(t.color)}">#</span><span class="row-main"><strong>${esc(t.name)}</strong><small>${state.data.guestTagLinks.filter(l=>l.tag_id===t.id).length} Gäste-Einträge</small></span><button class="icon-btn" data-action="delete-tag" data-id="${t.id}"><i data-lucide="trash-2"></i></button></div>`).join('')}</div>`;
    }

    if (type === 'note-section') {
      const s = p.id ? state.data.noteSections.find(x=>x.id===p.id) : null;
      title = s ? 'Kapitel bearbeiten' : 'Neues Kapitel';
      body = `<form data-form="save-note-section" data-id="${s?.id || ''}"><div class="field"><label>Kapitelname</label><input class="input" name="title" required value="${attr(s?.title || '')}" placeholder="z. B. Trauung, Location, Ideen" /></div><div class="form-actions">${s?`<button type="button" class="btn btn-danger" data-action="delete-note-section" data-id="${s.id}">Kapitel löschen</button>`:''}<button class="btn btn-primary" type="submit">Speichern</button></div></form>`;
    }

    if (type === 'settings') {
      const me = state.members.find(m=>m.user_id===uid());
      title = 'Einstellungen';
      body = `<form data-form="save-settings"><div class="field"><label>Name der Hochzeit</label><input class="input" name="name" required value="${attr(state.wedding?.name || '')}" /></div><div class="form-grid"><div class="field"><label>Hochzeitsdatum</label><input class="input" type="date" name="wedding_date" value="${attr(state.wedding?.wedding_date || '')}" /></div><div class="field"><label>Dein Anzeigename</label><input class="input" name="display_name" required value="${attr(me?.display_name || '')}" /></div></div><button class="btn btn-primary" type="submit">Änderungen speichern</button></form>
      <div class="section-heading"><h2>Einladung</h2></div><div class="invite-code"><code>${esc(state.wedding?.invite_code || '')}</code><button class="btn btn-secondary btn-sm" data-action="copy-invite"><i data-lucide="copy"></i> Kopieren</button></div>
      <div class="section-heading"><h2>Mitglieder</h2></div><div class="card card-pad">${state.members.map(m=>`<div class="member-line"><span class="avatar">${initials(m.display_name)}</span><div><strong>${esc(m.display_name)}</strong><div class="muted" style="font-size:12px">${m.user_id===uid()?'Du':m.role==='owner'?'Erstellt die Hochzeit':'Partnerperson'}</div></div></div>`).join('')}</div>
      <div class="section-heading"><h2>Daten</h2></div><div class="flex gap-8" style="flex-wrap:wrap"><button class="btn btn-secondary" data-action="export-json"><i data-lucide="download"></i> JSON exportieren</button><button class="btn btn-secondary" data-action="logout"><i data-lucide="log-out"></i> Abmelden</button></div>`;
    }

    return `<div class="modal-backdrop" data-action="modal-backdrop"><section class="modal" role="dialog" aria-modal="true"><div class="modal-handle"></div><header class="modal-header"><h2>${esc(title)}</h2><button class="icon-btn" data-action="close-modal"><i data-lucide="x"></i></button></header>${body}</section></div>`;
  }

  function render() {
    clearInterval(state.countdownTimer);
    if (!configured) return renderSetupNeeded();
    if (!state.session) return authScreen();
    if (!state.membership || !state.wedding) return onboardingScreen();

    let html = '';
    if (state.currentTab === 'home') html = homeView();
    else if (state.currentTab === 'todos') html = todosView();
    else if (state.currentTab === 'budget') html = budgetView();
    else if (state.currentTab === 'guests') html = guestsView();
    else if (state.currentTab === 'notes') html = notesView();
    else html = homeView();

    app.innerHTML = shell(html);
    refreshIcons();
    if (state.currentTab === 'home') startCountdown();
  }

  function startCountdown() {
    const tick = () => {
      const el = $('#countdown');
      if (!el) return;
      if (!state.wedding?.wedding_date) {
        $$('[data-cd]', el).forEach(n => n.textContent = '–');
        return;
      }
      const target = new Date(`${state.wedding.wedding_date}T12:00:00`);
      const diff = Math.max(0, target - new Date());
      const days = Math.floor(diff / 86400000);
      const hours = Math.floor(diff % 86400000 / 3600000);
      const mins = Math.floor(diff % 3600000 / 60000);
      const secs = Math.floor(diff % 60000 / 1000);
      const vals = {days, hours:String(hours).padStart(2,'0'), mins:String(mins).padStart(2,'0'), secs:String(secs).padStart(2,'0')};
      Object.entries(vals).forEach(([k,v]) => { const n = $(`[data-cd="${k}"]`, el); if (n) n.textContent = v; });
    };
    tick();
    state.countdownTimer = setInterval(tick, 1000);
  }

  function openModal(type, payload = {}) { state.modal = type; state.modalPayload = payload; render(); }
  function closeModal() { state.modal = null; state.modalPayload = null; render(); }

  async function init() {
    injectNotebookStyles();
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
    }
    window.addEventListener('online', () => { state.online = true; toast('Wieder online – Daten werden synchronisiert.'); state.membership ? loadAllData(true) : render(); });
    window.addEventListener('offline', () => { state.online = false; render(); });

    if (!configured) return renderSetupNeeded();
    const { data } = await sb.auth.getSession();
    state.session = data.session;
    state.user = data.session?.user || null;
    if (state.user) await bootstrapUser(); else render();

    sb.auth.onAuthStateChange(async (_event, session) => {
      const changedUser = session?.user?.id !== state.user?.id;
      state.session = session;
      state.user = session?.user || null;
      if (!session) {
        cleanupRealtime();
        state.membership = null; state.wedding = null; state.members = []; state.data = emptyData();
        render();
      } else if (changedUser || !state.wedding) {
        await bootstrapUser();
      }
    });
  }

  async function bootstrapUser() {
    try {
      const { data: memberships, error } = await sb.from('wedding_members').select('*').eq('user_id', uid()).order('joined_at', {ascending:true}).limit(1);
      if (error) throw error;
      state.membership = memberships?.[0] || null;
      if (!state.membership) {
        state.wedding = null;
        state.members = [];
        state.data = emptyData();
        render();
        return;
      }
      const { data: wedding, error: werr } = await sb.from('weddings').select('*').eq('id', state.membership.wedding_id).single();
      if (werr) throw werr;
      state.wedding = wedding;
      await loadAllData(false);
      subscribeRealtime();
    } catch (err) {
      console.error(err);
      toast(`Laden fehlgeschlagen: ${err.message}`, 'error');
      loadSnapshot();
      render();
    }
  }

  async function loadAllData(fromRealtime = false) {
    if (!wid()) return;
    const queries = await Promise.all([
      sb.from('wedding_members').select('*').eq('wedding_id', wid()).order('joined_at'),
      sb.from('todo_sections').select('*').eq('wedding_id', wid()).order('position').order('created_at'),
      sb.from('todos').select('*').eq('wedding_id', wid()).order('position').order('created_at'),
      sb.from('budget_items').select('*').eq('wedding_id', wid()).order('category').order('created_at'),
      sb.from('guests').select('*').eq('wedding_id', wid()).order('last_name').order('first_name'),
      sb.from('guest_tags').select('*').eq('wedding_id', wid()).order('name'),
      sb.from('guest_tag_links').select('*').eq('wedding_id', wid()),
      sb.from('note_sections').select('*').eq('wedding_id', wid()).order('position').order('created_at'),
      sb.from('note_pages').select('*').eq('wedding_id', wid()).order('position').order('created_at'),
      sb.from('weddings').select('*').eq('id', wid()).single()
    ]);
    const error = queries.find(q => q.error)?.error;
    if (error) {
      if (!navigator.onLine && loadSnapshot()) return;
      throw error;
    }
    state.members = queries[0].data || [];
    state.data.todoSections = queries[1].data || [];
    state.data.todos = queries[2].data || [];
    state.data.budgetItems = queries[3].data || [];
    state.data.guests = queries[4].data || [];
    state.data.guestTags = queries[5].data || [];
    state.data.guestTagLinks = queries[6].data || [];
    state.data.noteSections = queries[7].data || [];
    state.data.notePages = queries[8].data || [];
    state.wedding = queries[9].data || state.wedding;
    saveSnapshot();
    if (fromRealtime && state.currentTab === 'notes' && $('#note-editor') === document.activeElement) return;
    render();
  }

  function saveSnapshot() {
    if (!wid()) return;
    try { localStorage.setItem(`wedding.snapshot.${wid()}`, JSON.stringify({wedding:state.wedding,members:state.members,data:state.data,ts:Date.now()})); } catch (_) {}
  }

  function loadSnapshot() {
    if (!wid()) return false;
    try {
      const raw = localStorage.getItem(`wedding.snapshot.${wid()}`);
      if (!raw) return false;
      const snap = JSON.parse(raw);
      state.wedding = snap.wedding || state.wedding;
      state.members = snap.members || [];
      state.data = snap.data || emptyData();
      return true;
    } catch (_) { return false; }
  }

  function subscribeRealtime() {
    cleanupRealtime();
    if (!wid()) return;
    const tables = ['wedding_members','todo_sections','todos','budget_items','guests','guest_tags','guest_tag_links','note_sections','note_pages'];
    let channel = sb.channel(`wedding-${wid()}`);
    tables.forEach(table => {
      channel = channel.on('postgres_changes', {event:'*', schema:'public', table, filter:`wedding_id=eq.${wid()}`}, scheduleReload);
    });
    channel = channel.on('postgres_changes', {event:'*', schema:'public', table:'weddings', filter:`id=eq.${wid()}`}, scheduleReload);
    state.channel = channel.subscribe();
  }

  function scheduleReload() {
    clearTimeout(state.reloadTimer);
    state.reloadTimer = setTimeout(() => loadAllData(true).catch(err=>console.error(err)), 350);
  }

  function cleanupRealtime() {
    if (state.channel) sb?.removeChannel(state.channel).catch(()=>{});
    state.channel = null;
    clearTimeout(state.reloadTimer);
  }

  async function ensureOnline() {
    if (!navigator.onLine) { toast('Diese Änderung benötigt eine Internetverbindung.', 'error'); return false; }
    return true;
  }

  async function mutate(promise, successMessage = 'Gespeichert') {
    if (!await ensureOnline()) return null;
    const { data, error } = await promise;
    if (error) { toast(error.message || 'Speichern fehlgeschlagen', 'error'); throw error; }
    if (successMessage) toast(successMessage);
    return data;
  }

  document.addEventListener('click', async (e) => {
    const cmdBtn = e.target.closest('[data-command]');
    if (cmdBtn) {
      e.preventDefault();
      document.execCommand(cmdBtn.dataset.command, false, null);
      $('#note-editor')?.focus();
      return;
    }

    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;

    try {
      if (action === 'auth-mode') { state.authMode = el.dataset.mode; render(); }
      else if (action === 'onboarding-mode') { state.onboardingMode = el.dataset.mode; render(); }
      else if (action === 'onboarding-back') { state.onboardingMode = null; render(); }
      else if (action === 'tab') {
        if (state.currentTab === 'notes') await flushNoteSave();
        state.currentTab = el.dataset.tab;
        localStorage.setItem('wedding.tab', state.currentTab);
        state.modal = null; render();
      }
      else if (action === 'open-settings') openModal('settings');
      else if (action === 'close-modal') closeModal();
      else if (action === 'modal-backdrop' && e.target === el) closeModal();
      else if (action === 'copy-invite') await copyInvite();
      else if (action === 'logout') { await flushNoteSave(); await sb.auth.signOut(); }
      else if (action === 'new-todo') openModal('todo');
      else if (action === 'edit-todo') openModal('todo', {id:el.dataset.id});
      else if (action === 'new-todo-section') openModal('todo-section');
      else if (action === 'edit-todo-section') openModal('todo-section', {id:el.dataset.id});
      else if (action === 'todo-filter') { state.filters.todoStatus = el.dataset.value; render(); }
      else if (action === 'toggle-todo') await toggleTodo(el.dataset.id);
      else if (action === 'delete-todo') await deleteRow('todos', el.dataset.id, 'Aufgabe gelöscht');
      else if (action === 'delete-todo-section') await deleteRow('todo_sections', el.dataset.id, 'Bereich gelöscht');
      else if (action === 'new-budget') openModal('budget');
      else if (action === 'edit-budget') openModal('budget', {id:el.dataset.id});
      else if (action === 'delete-budget') await deleteRow('budget_items', el.dataset.id, 'Kostenpunkt gelöscht');
      else if (action === 'new-guest') openModal('guest');
      else if (action === 'edit-guest') openModal('guest', {id:el.dataset.id});
      else if (action === 'delete-guest') await deleteRow('guests', el.dataset.id, 'Gast gelöscht');
      else if (action === 'guest-rsvp-filter') { state.filters.guestRsvp = el.dataset.value; render(); }
      else if (action === 'guest-tag-filter') {
        const value = el.dataset.value;
        if (value === 'all') {
          state.filters.guestTags = [];
        } else {
          const selected = Array.isArray(state.filters.guestTags) ? [...state.filters.guestTags] : [];
          const index = selected.indexOf(value);
          if (index >= 0) selected.splice(index, 1);
          else selected.push(value);
          state.filters.guestTags = selected;
        }
        render();
      }
      else if (action === 'manage-tags') openModal('tags');
      else if (action === 'delete-tag') {
        state.filters.guestTags = (state.filters.guestTags || []).filter(id => id !== el.dataset.id);
        await deleteRow('guest_tags', el.dataset.id, 'Tag gelöscht', false);
      }
      else if (action === 'new-note-section') openModal('note-section');
      else if (action === 'edit-note-section') openModal('note-section', {id:el.dataset.id});
      else if (action === 'toggle-note-section') {
        await flushNoteSave();
        const id = el.dataset.id;
        const expanded = Array.isArray(state.notes.expandedSectionIds) ? [...state.notes.expandedSectionIds] : [];
        const pos = expanded.indexOf(id);
        if (pos >= 0) expanded.splice(pos, 1); else expanded.push(id);
        if (state.notes.sectionId !== id) {
          state.notes.sectionId = id;
          state.notes.pageId = null;
          state.notes.editing = false;
        }
        state.notes.expandedSectionIds = expanded;
        render();
      }
      else if (action === 'new-note-page') {
        await flushNoteSave();
        const sectionId = el.dataset.sectionId || state.notes.sectionId;
        if (sectionId && !state.notes.expandedSectionIds.includes(sectionId)) state.notes.expandedSectionIds.push(sectionId);
        await createNotePage(sectionId);
      }
      else if (action === 'select-note-page') {
        await flushNoteSave();
        const nextPage = state.data.notePages.find(p => p.id === el.dataset.id);
        state.notes.pageId = el.dataset.id;
        state.notes.sectionId = nextPage?.section_id || state.notes.sectionId;
        if (state.notes.sectionId && !state.notes.expandedSectionIds.includes(state.notes.sectionId)) state.notes.expandedSectionIds.push(state.notes.sectionId);
        state.notes.editing = false;
        render();
      }
      else if (action === 'edit-note-page') {
        state.notes.pageId = el.dataset.id || state.notes.pageId;
        state.notes.editing = true;
        state.notes.saveState = 'Bearbeitung geöffnet';
        render();
        setTimeout(() => $('#note-editor')?.focus(), 0);
      }
      else if (action === 'finish-note-edit') {
        await saveCurrentNote();
        state.notes.editing = false;
        render();
      }
      else if (action === 'insert-note-link') {
        const editor = $('#note-editor');
        if (!editor) return;
        editor.focus();
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
          toast('Markiere zuerst den Text, der zum Link werden soll.', 'error');
          return;
        }
        let url = prompt('Link einfügen (z. B. https://beispiel.de):', 'https://');
        if (!url) return;
        url = url.trim();
        if (!/^(https?:|mailto:|tel:)/i.test(url)) url = `https://${url.replace(/^\/+/, '')}`;
        document.execCommand('createLink', false, url);
        state.notes.saveState = 'Änderungen werden gespeichert …';
        const status = $('#note-save-state'); if (status) status.textContent = state.notes.saveState;
        clearTimeout(state.noteSaveTimer);
        state.noteSaveTimer = setTimeout(saveCurrentNote, 500);
      }
      else if (action === 'delete-note-page') await deleteNotePage(el.dataset.id);
      else if (action === 'delete-note-section') await deleteNoteSection(el.dataset.id);
      else if (action === 'export-json') exportJSON();
    } catch (err) { console.error(err); }
  });

  document.addEventListener('submit', async (e) => {
    const form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    const kind = form.dataset.form;
    const fd = new FormData(form);
    setBusy(form, true);
    try {
      if (kind === 'auth') await submitAuth(fd);
      else if (kind === 'create-wedding') await createWedding(fd);
      else if (kind === 'join-wedding') await joinWedding(fd);
      else if (kind === 'save-todo') await saveTodo(form.dataset.id, fd);
      else if (kind === 'save-todo-section') await saveTodoSection(form.dataset.id, fd);
      else if (kind === 'save-budget') await saveBudget(form.dataset.id, fd);
      else if (kind === 'save-guest') await saveGuest(form.dataset.id, fd);
      else if (kind === 'add-tag') await addTag(fd);
      else if (kind === 'save-note-section') await saveNoteSection(form.dataset.id, fd);
      else if (kind === 'save-settings') await saveSettings(fd);
    } catch (err) {
      console.error(err);
      if (!String(err?.message || '').includes('fetch')) toast(err?.message || 'Aktion fehlgeschlagen', 'error');
    } finally { setBusy(form, false); refreshIcons(); }
  });

  document.addEventListener('input', (e) => {
    if (e.target.id === 'guest-search') {
      state.filters.guestSearch = e.target.value;
      clearTimeout(e.target._timer);
      e.target._timer = setTimeout(render, 180);
    }
    if (e.target.id === 'note-editor' || e.target.id === 'note-title') {
      state.notes.saveState = 'Änderungen werden gespeichert …';
      const status = $('#note-save-state'); if (status) status.textContent = state.notes.saveState;
      clearTimeout(state.noteSaveTimer);
      state.noteSaveTimer = setTimeout(saveCurrentNote, 700);
    }
  });

  document.addEventListener('change', (e) => {
    if (e.target.id === 'guest-sort') { state.filters.guestSort = e.target.value; render(); }
    if (e.target.id === 'guest-household-filter') { state.filters.guestHousehold = e.target.value; render(); }
    if (e.target.matches('[data-editor-size]')) {
      document.execCommand('fontSize', false, e.target.value); $('#note-editor')?.focus();
    }
    if (e.target.matches('[data-editor-block]')) {
      document.execCommand('formatBlock', false, e.target.value); $('#note-editor')?.focus();
    }
    if (e.target.matches('[data-editor-color]')) {
      document.execCommand('foreColor', false, e.target.value); $('#note-editor')?.focus();
    }
  });

  async function submitAuth(fd) {
    const email = String(fd.get('email') || '').trim();
    const password = String(fd.get('password') || '');
    if (state.authMode === 'signup') {
      const displayName = String(fd.get('display_name') || '').trim();
      localStorage.setItem('wedding.pendingName', displayName);
      const { data, error } = await sb.auth.signUp({email, password, options:{data:{display_name:displayName}}});
      if (error) throw error;
      if (!data.session) {
        toast('Konto erstellt. Bitte bestätige jetzt die E-Mail und melde dich danach an.');
        state.authMode = 'login'; render();
      } else {
        state.session = data.session; state.user = data.user; await bootstrapUser();
      }
    } else {
      const { data, error } = await sb.auth.signInWithPassword({email, password});
      if (error) throw error;
      state.session = data.session; state.user = data.user; await bootstrapUser();
    }
  }

  async function createWedding(fd) {
    if (!await ensureOnline()) return;
    const displayName = String(fd.get('display_name') || '').trim();
    const name = String(fd.get('name') || 'Unsere Hochzeit').trim();
    const weddingDate = String(fd.get('wedding_date') || '') || null;
    const { error } = await sb.rpc('create_wedding', {
      p_name:name,
      p_wedding_date:weddingDate,
      p_display_name:displayName
    });
    if (error) throw error;
    localStorage.removeItem('wedding.pendingName');
    state.onboardingMode = null;
    await bootstrapUser();
    toast('Euer gemeinsamer Planungsbereich ist bereit.');
  }

  async function joinWedding(fd) {
    if (!await ensureOnline()) return;
    const displayName = String(fd.get('display_name') || '').trim();
    const code = String(fd.get('code') || '').trim().toUpperCase();
    const { error } = await sb.rpc('join_wedding_by_code', {p_code:code, p_display_name:displayName});
    if (error) throw error;
    localStorage.removeItem('wedding.pendingName');
    state.onboardingMode = null;
    await bootstrapUser();
    toast('Ihr seid jetzt verbunden.');
  }

  async function saveTodo(id, fd) {
    const payload = {
      wedding_id: wid(), title:String(fd.get('title')||'').trim(), description:String(fd.get('description')||''),
      section_id:fd.get('section_id') || null, due_date:fd.get('due_date') || null, status:fd.get('status') || 'open',
      priority:fd.get('priority') || 'normal', assignee_id:fd.get('assignee_id') || null
    };
    if (id) await mutate(sb.from('todos').update(payload).eq('id',id), 'Aufgabe gespeichert');
    else await mutate(sb.from('todos').insert(payload), 'Aufgabe angelegt');
    state.modal = null; await loadAllData();
  }

  async function saveTodoSection(id, fd) {
    const title = String(fd.get('title')||'').trim();
    if (id) await mutate(sb.from('todo_sections').update({title}).eq('id',id), 'Bereich gespeichert');
    else await mutate(sb.from('todo_sections').insert({wedding_id:wid(), title, position:state.data.todoSections.length}), 'Bereich angelegt');
    state.modal = null; await loadAllData();
  }

  async function toggleTodo(id) {
    const t = state.data.todos.find(x=>x.id===id); if (!t) return;
    const next = t.status === 'done' ? 'open' : 'done';
    await mutate(sb.from('todos').update({status:next}).eq('id',id), next==='done'?'Aufgabe erledigt':'Aufgabe wieder geöffnet');
    await loadAllData();
  }

  async function saveBudget(id, fd) {
    const payload = {
      wedding_id:wid(), title:String(fd.get('title')||'').trim(), category:String(fd.get('category')||'Sonstiges').trim(), vendor:String(fd.get('vendor')||'').trim(),
      planned_cents:parseEuro(fd.get('planned')), actual_cents:parseEuro(fd.get('actual')), paid_cents:parseEuro(fd.get('paid')),
      due_date:fd.get('due_date') || null, notes:String(fd.get('notes')||'')
    };
    if (id) await mutate(sb.from('budget_items').update(payload).eq('id',id), 'Kostenpunkt gespeichert');
    else await mutate(sb.from('budget_items').insert(payload), 'Kostenpunkt angelegt');
    state.modal = null; await loadAllData();
  }

  async function saveGuest(id, fd) {
    const payload = {
      wedding_id:wid(), first_name:String(fd.get('first_name')||'').trim(), last_name:String(fd.get('last_name')||'').trim(),
      household:String(fd.get('household')||'').trim(), rsvp_status:fd.get('rsvp_status') || 'open',
      party_size:Number(fd.get('party_size')||1), notes:String(fd.get('notes')||'')
    };
    let guestId = id;
    if (id) await mutate(sb.from('guests').update(payload).eq('id',id), 'Gast gespeichert');
    else {
      const data = await mutate(sb.from('guests').insert(payload).select().single(), 'Gast hinzugefügt');
      guestId = data.id;
    }
    const selected = fd.getAll('tag_ids').map(String);
    await mutate(sb.from('guest_tag_links').delete().eq('guest_id',guestId), '');
    if (selected.length) await mutate(sb.from('guest_tag_links').insert(selected.map(tag_id=>({wedding_id:wid(), guest_id:guestId, tag_id}))), '');
    state.modal = null; await loadAllData();
  }

  async function addTag(fd) {
    const name = String(fd.get('name')||'').trim();
    const color = String(fd.get('color')||'#dfe9e2');
    await mutate(sb.from('guest_tags').insert({wedding_id:wid(), name, color}), 'Tag angelegt');
    await loadAllData(); state.modal='tags'; render();
  }

  async function saveNoteSection(id, fd) {
    const title = String(fd.get('title')||'').trim();
    if (id) await mutate(sb.from('note_sections').update({title}).eq('id',id), 'Kapitel gespeichert');
    else {
      const data = await mutate(sb.from('note_sections').insert({wedding_id:wid(), title, position:state.data.noteSections.length}).select().single(), 'Kapitel angelegt');
      state.notes.sectionId = data.id; state.notes.pageId = null;
    }
    state.modal = null; await loadAllData();
  }

  async function createNotePage(sectionId) {
    if (!sectionId) return;
    const existing = state.data.notePages.filter(p=>p.section_id===sectionId);
    const data = await mutate(sb.from('note_pages').insert({wedding_id:wid(), section_id:sectionId, title:'Neue Seite', content_html:'', position:existing.length}).select().single(), 'Seite angelegt');
    state.notes.sectionId = sectionId;
    state.notes.pageId = data.id;
    state.notes.editing = true;
    if (!state.notes.expandedSectionIds.includes(sectionId)) state.notes.expandedSectionIds.push(sectionId);
    await loadAllData();
  }

  async function saveCurrentNote() {
    clearTimeout(state.noteSaveTimer);
    const pageId = state.notes.pageId;
    const editor = $('#note-editor'); const title = $('#note-title');
    if (!pageId || !editor || !title || !state.membership) return;
    if (!navigator.onLine) { state.notes.saveState = 'Offline – nicht gespeichert'; const s=$('#note-save-state'); if(s)s.textContent=state.notes.saveState; return; }
    const content_html = sanitizeHtml(editor.innerHTML);
    const nextTitle = title.value.trim() || 'Neue Seite';
    const { error } = await sb.from('note_pages').update({title:nextTitle, content_html}).eq('id',pageId);
    if (error) { state.notes.saveState = 'Speichern fehlgeschlagen'; toast(error.message,'error'); }
    else {
      const local = state.data.notePages.find(p=>p.id===pageId); if (local) { local.title=nextTitle; local.content_html=content_html; }
      state.notes.saveState = `Gespeichert · ${new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})}`;
      saveSnapshot();
    }
    const s=$('#note-save-state'); if(s)s.textContent=state.notes.saveState;
  }

  async function flushNoteSave() {
    if (state.noteSaveTimer) { clearTimeout(state.noteSaveTimer); state.noteSaveTimer = null; await saveCurrentNote(); }
  }

  async function deleteNotePage(id) {
    if (!confirm('Diese Notizseite wirklich löschen?')) return;
    await mutate(sb.from('note_pages').delete().eq('id',id), 'Seite gelöscht');
    if (state.notes.pageId===id) { state.notes.pageId=null; state.notes.editing=false; }
    await loadAllData();
  }

  async function deleteNoteSection(id) {
    if (!confirm('Dieses Kapitel inklusive aller Seiten wirklich löschen?')) return;
    await mutate(sb.from('note_sections').delete().eq('id',id), 'Kapitel gelöscht');
    state.notes.sectionId=null; state.notes.pageId=null; state.notes.editing=false; state.modal=null;
    await loadAllData();
  }

  async function saveSettings(fd) {
    const name = String(fd.get('name')||'').trim();
    const wedding_date = fd.get('wedding_date') || null;
    const display_name = String(fd.get('display_name')||'').trim();
    await mutate(sb.from('weddings').update({name,wedding_date}).eq('id',wid()), 'Einstellungen gespeichert');
    await mutate(sb.from('wedding_members').update({display_name}).eq('wedding_id',wid()).eq('user_id',uid()), '');
    state.modal=null; await loadAllData();
  }

  async function deleteRow(table, id, msg, close = true) {
    if (!confirm('Wirklich löschen?')) return;
    await mutate(sb.from(table).delete().eq('id',id), msg);
    if (close) state.modal=null;
    await loadAllData();
    if (!close) { state.modal='tags'; render(); }
  }

  async function copyInvite() {
    const code = state.wedding?.invite_code || '';
    try { await navigator.clipboard.writeText(code); toast('Einladungscode kopiert.'); }
    catch (_) { prompt('Einladungscode kopieren:', code); }
  }

  function exportJSON() {
    const payload = {exported_at:new Date().toISOString(), wedding:state.wedding, members:state.members.map(m=>({display_name:m.display_name,role:m.role,joined_at:m.joined_at})), data:state.data};
    const blob = new Blob([JSON.stringify(payload,null,2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href=url; a.download=`hochzeitsplan-${todayISO()}.json`; a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    toast('Export erstellt.');
  }

  init().catch(err => {
    console.error(err);
    app.innerHTML = `<main class="auth-wrap"><section class="auth-card card"><div class="notice danger"><strong>App konnte nicht gestartet werden.</strong><br>${esc(err.message)}</div></section></main>`;
  });
})();
