/* Política compartilhada de pontuação do app e do DH-Club. */
(function (root) {
  'use strict';
  const startOrder = [
    'ESTREANTE', 'ESTREANTE (EXTRA)', 'RIGIDA', 'RÍGIDA', 'RÍGIDA (EXTRA)', 'ENDURO',
    'OPEN', 'OPEN (EXTRA)', 'E-BIKE', 'E-BIKE (EXTRA)', 'ELITE FEMININA', 'FEMININO ELITE', 'FEMININO',
    'INFANTO-JUVENIL', 'JUVENIL', 'PCD', 'PCD (EXTRA)', 'MASTER D',
    'MASTER C2', 'MASTER C1', 'MASTER C', 'MASTER B2', 'MASTER B1', 'MASTER B',
    'MASTER A2', 'MASTER A1', 'MASTER A', 'JUNIOR', 'SUB-30', 'ELITE'
  ];
  const categoryLabel = value => String(value ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
  const baseCategory = value => categoryLabel(value).replace(/\s*\((?:EXTRA|OFICIAL)\)$/, '');
  function categoryOrder(value) {
    const name = categoryLabel(value);
    const exact = startOrder.indexOf(name);
    if (exact !== -1) return exact;
    const base = startOrder.indexOf(baseCategory(name));
    return base === -1 ? startOrder.length : base;
  }
  function compareStartOrder(left, right) {
    return categoryOrder(left) - categoryOrder(right) || String(left).localeCompare(String(right), 'pt-BR');
  }
  function withEnduro(categories) {
    const entries = Object.values(categories || {}).filter(category => category && typeof category.name === 'string');
    const existing = entries.find(category => category.name === 'ENDURO') ||
      entries.find(category => baseCategory(category.name) === 'ENDURO');
    if (existing) {
      return entries.filter(category => category === existing || baseCategory(category.name) !== 'ENDURO')
        .map(category => category === existing && existing.name !== 'ENDURO' ? {...existing, name:'ENDURO'} : category);
    }
    const rigidIndex = entries.findLastIndex(category => ['RIGIDA', 'RÍGIDA'].includes(baseCategory(category.name)));
    entries.splice(rigidIndex === -1 ? entries.length : rigidIndex + 1, 0, {name:'ENDURO', active:true});
    return entries;
  }
  function qualifyStartValue(value) {
    if (value === Infinity || String(value ?? '').trim().toUpperCase() === 'DNF') return -Infinity;
    if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : Infinity;
    const parts = /^(\d+):([0-5]?\d)(?:[.,](\d{1,3}))?$/.exec(String(value ?? '').trim());
    if (!parts) return Infinity;
    return Number(parts[1]) * 60000 + Number(parts[2]) * 1000 + Number((parts[3] || '').padEnd(3, '0'));
  }
  function compareQualifyStart(left, right) {
    const a = qualifyStartValue(left), b = qualifyStartValue(right);
    if (a === b) return 0;
    return a < b ? -1 : 1;
  }
  function qualifyResults(eventId, records, normalizeCategory) {
    const event = String(eventId);
    const keyOf = (cpf, cat) => JSON.stringify([
      String(cpf ?? '').replace(/[.\s-]/g, ''),
      baseCategory(normalizeCategory(String(cat ?? ''))).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    ]);
    const results = new Map();
    for (const record of Object.values(records || {})) {
      if (!record?.cpf || String(record.evtId) !== event || record.runType !== 'qualify') continue;
      const value = String(record.status ?? '').trim().toUpperCase() === 'DNF' ? 'DNF' : record.val;
      const ms = qualifyStartValue(value);
      if (ms === Infinity) continue;
      const key = keyOf(record.cpf, record.cat);
      const existing = results.get(key);
      if (!existing || (Number.isFinite(ms) && (existing.ms === -Infinity || ms < existing.ms))) {
        results.set(key, {ms, value:ms === -Infinity ? 'DNF' : value});
      }
    }
    return (cpf, cat) => results.get(keyOf(cpf, cat))?.value ?? '';
  }
  root.DHNDCategories = Object.freeze({compareStartOrder, withEnduro, compareQualifyStart, qualifyResults});

  const eventSealLabels = Object.freeze({PE:'FPC/PE', CBC:'CBC NACIONAL', NE:'NORDESTE', PB:'PARAÍBA'});

  function eventSeals(event) {
    if (!event) return [];
    const primary = event.type === 'NON_OFFICIAL' ? '' : (Object.hasOwn(eventSealLabels, event.type) ? event.type : 'PE');
    const saved = event.seals && typeof event.seals === 'object' ? Object.values(event.seals) : [];
    return [...new Set([primary, ...saved].filter(code => typeof code === 'string' && Object.hasOwn(eventSealLabels, code)))].slice(0, 3);
  }

  function hasTable(values) {
    return Array.isArray(values) && values.some(value => value !== '' && Number.isFinite(Number(value)) && Number(value) !== 0);
  }
  function isScoringEvent(event) {
    if (!event) return false;
    if (event.type !== 'NON_OFFICIAL') return true;
    if (typeof event.pointsEnabled === 'boolean') return event.pointsEnabled;
    return hasTable(event.points) || hasTable(event.qPoints);
  }
  function hasConfiguredPoints(event) {
    return !!event && (hasTable(event.points) || (!!event.hasQualify && hasTable(event.qPoints)));
  }
  root.DHNDScoring = Object.freeze({ isScoringEvent, hasConfiguredPoints, eventSeals, eventSealLabels });
})(typeof window !== 'undefined' ? window : globalThis);
