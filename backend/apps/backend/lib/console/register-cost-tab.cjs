// lib/console/register-cost-tab.cjs
'use strict';

function registerCostTab(navSelector, panelContainerSelector, sectionHtml) {
  if (typeof navSelector !== 'string' || !navSelector.trim()) {
    throw new TypeError('navSelector must be a non-empty string');
  }
  if (
    typeof panelContainerSelector !== 'string' ||
    !panelContainerSelector.trim()
  ) {
    throw new TypeError('panelContainerSelector must be a non-empty string');
  }
  if (typeof sectionHtml !== 'string' || !sectionHtml.trim()) {
    throw new TypeError('sectionHtml must be a non-empty string');
  }

  return `<script>
(function () {
  'use strict';

  var navSelector = ${JSON.stringify(navSelector)};
  var panelContainerSelector = ${JSON.stringify(panelContainerSelector)};
  var sectionHtml = ${JSON.stringify(sectionHtml)};

  function parseSection() {
    var template = document.createElement('template');
    template.innerHTML = sectionHtml.trim();

    var section = template.content.querySelector('#cost-tab');
    if (!section) {
      console.warn('[cost-tab] supplied markup has no #cost-tab');
      return null;
    }

    return section;
  }

  function setVisible(element, visible) {
    if (!element) return;

    element.hidden = !visible;
    element.setAttribute('aria-hidden', visible ? 'false' : 'true');
  }

  function registerIntegrated(nav, panelContainer, section) {
    if (!section.parentNode) {
      panelContainer.appendChild(section);
    }

    section.setAttribute('data-view', 'costs');
    setVisible(section, false);

    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Costs';
    button.setAttribute('data-view', 'costs');
    button.setAttribute('aria-controls', 'cost-tab');
    button.setAttribute('aria-selected', 'false');

    nav.appendChild(button);

    button.addEventListener('click', function () {
      var requestedView = button.getAttribute('data-view');

      var panels = panelContainer.querySelectorAll('[data-view]');
      for (var i = 0; i < panels.length; i += 1) {
        var panel = panels[i];
        setVisible(panel, panel.getAttribute('data-view') === requestedView);
      }

      var navItems = nav.querySelectorAll('[data-view]');
      for (var j = 0; j < navItems.length; j += 1) {
        var navItem = navItems[j];
        var active = navItem.getAttribute('data-view') === requestedView;

        navItem.classList.toggle('active', active);

        if (navItem.matches('button,[role="tab"]')) {
          navItem.setAttribute('aria-selected', active ? 'true' : 'false');
        }
      }
    });
  }

  function registerStandalone(section) {
    var wrapper = document.createElement('div');
    wrapper.setAttribute('data-cost-tab-standalone', '');

    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Show Costs';
    button.setAttribute('aria-controls', 'cost-tab');
    button.setAttribute('aria-expanded', 'false');

    setVisible(section, false);

    button.addEventListener('click', function () {
      var show = section.hidden;

      setVisible(section, show);
      button.textContent = show ? 'Hide Costs' : 'Show Costs';
      button.setAttribute('aria-expanded', show ? 'true' : 'false');
    });

    wrapper.appendChild(button);
    wrapper.appendChild(section);

    (document.body || document.documentElement).appendChild(wrapper);
  }

  function init() {
    if (document.getElementById('cost-tab')) {
      return;
    }

    var section = parseSection();
    if (!section) {
      return;
    }

    var nav = null;
    var panelContainer = null;

    try {
      nav = document.querySelector(navSelector);
    } catch (_) {}

    try {
      panelContainer = document.querySelector(panelContainerSelector);
    } catch (_) {}

    if (nav && panelContainer) {
      registerIntegrated(nav, panelContainer, section);
    } else {
      registerStandalone(section);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
</script>`;
}

module.exports = registerCostTab;
module.exports.registerCostTab = registerCostTab;
