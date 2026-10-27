/* Bundle availability is managed by Proax. Dates are estimates, not guarantees. */
(function (root) {
  root.MJBundleAvailability = function (bundle, english) {
    var raw = bundle.presaleDate || bundle.presale_date;
    if (!raw || !(bundle.presale || bundle.presale_date)) return '';
    var iso = String(raw).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
    var date = new Date(iso + 'T12:00:00Z');
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== iso) return '';
    return (english ? 'Pre-order · Estimated delivery: ' : 'Preventa · Entrega estimada: ') +
      date.toLocaleDateString(english ? 'en-US' : 'es-MX', {year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC'});
  };
})(typeof window === 'undefined' ? globalThis : window);
