/* Política compartilhada de pontuação do app e do DH-Club. */
(function (root) {
  'use strict';
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
  root.DHNDScoring = Object.freeze({ isScoringEvent, hasConfiguredPoints });
})(typeof window !== 'undefined' ? window : globalThis);
