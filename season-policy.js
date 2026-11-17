/* Temporadas compartilhadas: calendário independente da raiz de cadastros e do relógio. */
(function (root) {
  'use strict';
  const LEGACY_ROOT = 'dhpe_v25_final_stable_fix';
  const MONTHS = {JAN:1, FEV:2, MAR:3, ABR:4, MAI:5, JUN:6, JUL:7, AGO:8, SET:9, OUT:10, NOV:11, DEZ:12};

  function validYear(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    if (typeof value === 'string' && !/^\d{4}$/.test(value.trim())) return null;
    const number = Number(value);
    return Number.isInteger(number) && number >= 1900 && number <= 9999 ? number : null;
  }

  function yearFromRoot(dataRoot) {
    const match = /^dhpe_(\d{4})_(?:archive|active)$/.exec(String(dataRoot || ''));
    return match ? validYear(match[1]) : null;
  }

  function stored(storage, key) {
    try {
      const value = storage && typeof storage.getItem === 'function' ? storage.getItem(key) : null;
      return typeof value === 'string' ? value.trim() : value;
    } catch (_) {
      return null;
    }
  }

  function context(storage, clockYear) {
    const clock = validYear(clockYear) || new Date().getFullYear();
    const dataRoot = stored(storage, 'dhpe_active_season') || LEGACY_ROOT;
    const maximum = Math.max(clock + 1, 2027);
    const rootYear = yearFromRoot(dataRoot);
    const selected = validYear(stored(storage, 'dhpe_selected_year'));
    const year = rootYear && rootYear <= maximum ? rootYear :
      selected && selected >= 2026 && selected <= maximum ? selected : clock;
    return {root:dataRoot, year};
  }

  function monthNumber(value) {
    const text = String(value || '').trim().toUpperCase();
    if (/^\d{1,2}$/.test(text)) {
      const number = Number(text);
      return number >= 1 && number <= 12 ? number : null;
    }
    return MONTHS[text.slice(0, 3)] || null;
  }

  function isoYearInMonth(value, month) {
    if (typeof value !== 'string') return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(value.trim());
    if (!match) return null;
    if (value.includes('T') && !Number.isFinite(Date.parse(value.trim()))) return null;
    const year = validYear(match[1]), parsedMonth = Number(match[2]), day = Number(match[3]);
    if (!year || parsedMonth !== month || day < 1 || day > 31) return null;
    const parsed = new Date(Date.UTC(year, parsedMonth - 1, day));
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== parsedMonth || parsed.getUTCDate() !== day) return null;
    return year;
  }

  function eventYear(event, dataRoot = LEGACY_ROOT) {
    const legacyYear = yearFromRoot(dataRoot) || 2026;
    if (!event || typeof event !== 'object') return legacyYear;
    const explicit = validYear(event.year) || validYear(event.ano);
    if (explicit) return explicit;
    const month = monthNumber(event.m);
    if (month) {
      const inferred = [event.closeDate, event.qDate].map(value => isoYearInMonth(value, month)).filter(Boolean);
      if (inferred.length && inferred.every(year => year === inferred[0])) return inferred[0];
    }
    return legacyYear;
  }

  function inYear(event, year, dataRoot = LEGACY_ROOT) {
    const selected = validYear(year);
    return !!event && typeof event === 'object' && !!selected && eventYear(event, dataRoot) === selected;
  }

  function records(value) {
    return (Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : [])
      .filter(item => item && typeof item === 'object');
  }

  function scopeCore(core, year, dataRoot = LEGACY_ROOT) {
    const original = core && typeof core === 'object' ? core : {};
    const events = records(original.events).filter(event => inYear(event, year, dataRoot));
    const eventIds = new Set(events.filter(event => event.id != null).map(event => String(event.id)));
    const tempos = records(original.tempos).filter(result => result.evtId != null && eventIds.has(String(result.evtId)));
    return {...original, users:original.users || [], config:original.config || {}, events, tempos};
  }

  root.DHNDSeasons = Object.freeze({context, eventYear, inYear, scopeCore});
})(typeof window !== 'undefined' ? window : globalThis);
