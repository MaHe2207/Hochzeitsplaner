/*
 * Zusatzmodul für "Gemeinsam – Hochzeitsplaner"
 * Zeigt bei Gäste-Tags die Anzahl der zugeordneten Personen an.
 *
 * Dieses Modul liest ausschließlich bestehende Daten aus Supabase.
 * Es führt keine INSERT/UPDATE/DELETE-Operationen aus.
 */
(() => {
  'use strict';

  const cfg = window.APP_CONFIG || {};
  if (!window.supabase || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) return;

  const client = window.supabase.createClient(
    cfg.SUPABASE_URL,
    cfg.SUPABASE_ANON_KEY
  );

  let counts = {};
  let currentWeddingId = null;
  let loading = false;
  let refreshTimer = null;
  let lastRefresh = 0;

  function guestPageVisible() {
    return [...document.querySelectorAll('.page-title')]
      .some(el => el.textContent.trim() === 'Gästeliste');
  }

  function cleanTagLabel(text) {
    return String(text || '')
      .replace(/\s*\(\d+\)\s*$/, '')
      .trim();
  }

  function applyCounts() {
    if (!guestPageVisible()) return;

    const buttons = [...document.querySelectorAll(
      '[data-action="guest-tag-filter"]'
    )];

    for (const button of buttons) {
      const tagId = button.dataset.value;
      if (!tagId || tagId === 'all') continue;

      const baseLabel = button.dataset.baseTagLabel || cleanTagLabel(button.textContent);
      button.dataset.baseTagLabel = baseLabel;
      button.textContent = `${baseLabel} (${counts[tagId] || 0})`;
    }

    // Bei ausgewähltem Tag die Personenanzahl zusätzlich oben anzeigen.
    const selected = document.querySelector(
      '[data-action="guest-tag-filter"].tag-active'
    );

    const title = [...document.querySelectorAll('.page-title')]
      .find(el => el.textContent.trim() === 'Gästeliste');
    const subtitle = title?.parentElement?.querySelector('.page-subtitle');

    if (!subtitle) return;

    if (!subtitle.dataset.originalGuestSubtitle) {
      subtitle.dataset.originalGuestSubtitle = subtitle.textContent.trim();
    }

    if (selected && selected.dataset.value && selected.dataset.value !== 'all') {
      const tagId = selected.dataset.value;
      const label = selected.dataset.baseTagLabel || cleanTagLabel(selected.textContent);
      const personCount = counts[tagId] || 0;
      subtitle.textContent = `${personCount} ${personCount === 1 ? 'Person' : 'Personen'} mit „${label}“`;
    } else {
      subtitle.textContent = subtitle.dataset.originalGuestSubtitle;
    }
  }

  async function getWeddingId() {
    const { data: sessionData } = await client.auth.getSession();
    const userId = sessionData?.session?.user?.id;
    if (!userId) return null;

    const { data, error } = await client
      .from('wedding_members')
      .select('wedding_id')
      .eq('user_id', userId)
      .order('joined_at', { ascending: true })
      .limit(1);

    if (error) throw error;
    return data?.[0]?.wedding_id || null;
  }

  async function refreshCounts(force = false) {
    if (!guestPageVisible() || loading) return;

    const now = Date.now();
    if (!force && now - lastRefresh < 1500) {
      applyCounts();
      return;
    }

    loading = true;
    try {
      if (!currentWeddingId) currentWeddingId = await getWeddingId();
      if (!currentWeddingId) return;

      const [guestsResult, linksResult] = await Promise.all([
        client
          .from('guests')
          .select('id, party_size')
          .eq('wedding_id', currentWeddingId),
        client
          .from('guest_tag_links')
          .select('guest_id, tag_id')
          .eq('wedding_id', currentWeddingId)
      ]);

      if (guestsResult.error) throw guestsResult.error;
      if (linksResult.error) throw linksResult.error;

      const partySizeByGuest = new Map(
        (guestsResult.data || []).map(guest => [
          guest.id,
          Number(guest.party_size || 1)
        ])
      );

      const nextCounts = {};
      for (const link of linksResult.data || []) {
        nextCounts[link.tag_id] =
          (nextCounts[link.tag_id] || 0) +
          (partySizeByGuest.get(link.guest_id) || 0);
      }

      counts = nextCounts;
      lastRefresh = Date.now();
      applyCounts();
    } catch (error) {
      console.warn('Tag-Personenzählung konnte nicht geladen werden:', error);
    } finally {
      loading = false;
    }
  }

  function scheduleRefresh(force = false) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refreshCounts(force), 250);
  }

  // Die Haupt-App rendert Ansichten dynamisch neu. Daher reagieren wir auf
  // DOM-Änderungen und tragen die Zähler nach jedem Rendern wieder ein.
  const observer = new MutationObserver(() => {
    if (!guestPageVisible()) return;
    applyCounts();
    scheduleRefresh(false);
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  // Nach Aktionen, die Gäste/Tags verändern können, frische Werte holen.
  document.addEventListener('click', event => {
    const target = event.target.closest('[data-action]');
    if (!target) return;

    const actionsThatMayChangeCounts = new Set([
      'guest-tag-filter',
      'new-guest',
      'edit-guest',
      'delete-guest',
      'manage-tags',
      'delete-tag'
    ]);

    if (actionsThatMayChangeCounts.has(target.dataset.action)) {
      scheduleRefresh(true);
    }
  }, true);

  document.addEventListener('submit', event => {
    const form = event.target.closest('[data-form]');
    if (!form) return;

    if (['save-guest', 'add-tag'].includes(form.dataset.form)) {
      // Die Haupt-App speichert zuerst; danach erneut aus Supabase lesen.
      setTimeout(() => scheduleRefresh(true), 700);
    }
  }, true);

  client.auth.onAuthStateChange(() => {
    currentWeddingId = null;
    counts = {};
    setTimeout(() => scheduleRefresh(true), 300);
  });

  window.addEventListener('online', () => scheduleRefresh(true));
  scheduleRefresh(true);
})();
