/* Política compartilhada de pontuação do app e do DH-Club. */
(function (root) {
  'use strict';
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
