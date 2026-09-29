// lib/console/cost-tab-fragment.cjs
'use strict';

function makeCostTab(sectionHtml) {
  if (typeof sectionHtml !== 'string' || !sectionHtml.trim()) {
    throw new TypeError('sectionHtml must be a non-empty string');
  }

  function costTabHtml() {
    return sectionHtml;
  }

  function costMeterBootScript(ratesJsonUrl, eventsEndpoint) {
    if (typeof ratesJsonUrl !== 'string' || !ratesJsonUrl.trim()) {
      throw new TypeError('ratesJsonUrl must be a non-empty string');
    }
    if (typeof eventsEndpoint !== 'string' || !eventsEndpoint.trim()) {
      throw new TypeError('eventsEndpoint must be a non-empty string');
    }

    const ratesUrl = JSON.stringify(ratesJsonUrl);
    const eventsUrl = JSON.stringify(eventsEndpoint);

    return `<script>
(function () {
  'use strict';

  var ratesJsonUrl = ${ratesUrl};
  var eventsEndpoint = ${eventsUrl};

  function resolveAuthToken() {
    try {
      if (typeof window.getAuthToken === 'function') {
        var globalToken = window.getAuthToken();
        if (globalToken && typeof globalToken.then === 'function') {
          return globalToken.then(function (value) {
            return typeof value === 'string' ? value.trim() : '';
          }).catch(function () {
            return '';
          });
        }
        if (typeof globalToken === 'string' && globalToken.trim()) {
          return Promise.resolve(globalToken.trim());
        }
      }
    } catch (_) {}

    try {
      var tokenInput = document.getElementById('token');
      if (tokenInput && typeof tokenInput.value === 'string') {
        return Promise.resolve(tokenInput.value.trim());
      }
    } catch (_) {}

    return Promise.resolve('');
  }

  function fetchEvents(sinceISO) {
    return resolveAuthToken().then(function (token) {
      var url;

      try {
        url = new URL(eventsEndpoint, window.location.href);
        if (sinceISO) {
          url.searchParams.set('since', sinceISO);
        }
      } catch (error) {
        return Promise.reject(error);
      }

      var headers = {
        'Accept': 'application/json'
      };

      if (token) {
        headers.Authorization = 'Bearer ' + token;
      }

      return fetch(url.toString(), {
        method: 'GET',
        headers: headers,
        credentials: 'same-origin'
      }).then(function (response) {
        if (!response.ok) {
          throw new Error(
            'Cost events request failed: HTTP ' + response.status
          );
        }
        return response.json();
      });
    });
  }

  Promise.all([
    fetch(ratesJsonUrl, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      credentials: 'same-origin'
    }).then(function (response) {
      if (!response.ok) {
        throw new Error(
          'Cost rates request failed: HTTP ' + response.status
        );
      }
      return response.json();
    }),
    Promise.resolve(window.WSSCostMeter)
  ]).then(function (results) {
    var rates = results[0];
    var costMeterApi = results[1];

    if (!costMeterApi || typeof costMeterApi.create !== 'function') {
      throw new Error('WSSCostMeter.create is not available');
    }

    var meter = costMeterApi.create({
      fetchEvents: fetchEvents,
      rates: rates
    });

    window.WSSCostMeter = meter;

    if (!meter || typeof meter.refresh !== 'function') {
      throw new Error('WSSCostMeter instance does not expose refresh()');
    }

    return meter.refresh();
  }).catch(function (error) {
    console.warn('[cost-meter] boot failed', error);
  });
})();
</script>`;
  }

  return {
    costTabHtml,
    costMeterBootScript
  };
}

module.exports = makeCostTab;
module.exports.makeCostTab = makeCostTab;
