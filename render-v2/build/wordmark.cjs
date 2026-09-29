'use strict';

function esc(value) {
  return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[ch]));
}

function wordmarkSvg(name, ink) {
  const safe = esc(name);
  const fill = ink === 'light' ? '#FFFFFF' : '#000000';
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 120" width="420" height="120" role="img" aria-label="' + safe + '">' +
      '<text x="210" y="74" text-anchor="middle" textLength="388" lengthAdjust="spacingAndGlyphs" ' +
        'font-family="\'Work Sans\',Arial,Helvetica,sans-serif" font-weight="700" font-size="52" letter-spacing="0.4" fill="' + fill + '">' + safe + '</text>' +
      '<rect x="150" y="90" width="120" height="5" rx="2.5" fill="' + fill + '"/>' +
    '</svg>';
  return Buffer.from(svg, 'utf8');
}

module.exports = Object.freeze({ wordmarkSvg });
