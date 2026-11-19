/* Política compartilhada de pontuação do app e do DH-Club. */
(function (root) {
  'use strict';
  const startOrder = [
    'ESTREANTE', 'ESTREANTE (EXTRA)', 'RIGIDA', 'RÍGIDA', 'RÍGIDA (EXTRA)', 'ENDURO',
    'OPEN', 'OPEN (EXTRA)', 'ELITE FEMININA', 'FEMININO ELITE', 'FEMININO',
    'INFANTO-JUVENIL', 'JUVENIL', 'PCD', 'PCD (EXTRA)', 'MASTER D',
    'MASTER C2', 'MASTER C1', 'MASTER C', 'MASTER B2', 'MASTER B1', 'MASTER B',
    'MASTER A2', 'MASTER A1', 'MASTER A', 'E-BIKE', 'E-BIKE (EXTRA)', 'JUNIOR', 'SUB-30', 'ELITE'
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
  root.DHNDCategories = Object.freeze({compareStartOrder, withEnduro});

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
