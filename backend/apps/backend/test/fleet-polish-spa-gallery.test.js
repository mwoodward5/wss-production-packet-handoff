'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  dedupeJavaScriptGallery,
  fleetPolishCss,
  polishSite
} = require('../lib/mirror-engine/fleet-polish');
const { fleetPolishInputFiles } = require('../lib/mirror-engine/engine');
const { BUILD_RECIPE_VERSION } = require('../lib/mirror-engine/build-hash');

test('engine feeds SPA JavaScript into fleet polish and recipe invalidates stale builds', () => {
  const selected = fleetPolishInputFiles({
    'index.html': Buffer.from('<div id="root"></div>'),
    'assets/site.css': Buffer.from('.gallery{}'),
    'assets/app.js': Buffer.from('const gallery=[]'),
    'assets/app.js.raw': Buffer.from('const rawGallery=[]'),
    'assets/photo.webp': Buffer.from([1, 2, 3]),
  });

  test('fleet polish CSS supplies the shared audit geometry and hero safeguards', () => {
    const css = fleetPolishCss();
    assert.match(css, /scroll-margin-top: calc\(var\(--header-h\) \+ 16px\)/);
    assert.match(css, /clamp\(2\.25rem, 6vw, 5\.5rem\)/);
    assert.match(css, /max-width: min\(240px, 60vw\)/);
    assert.match(css, /rgba\(0,0,0,\.25\).*rgba\(0,0,0,\.6\)/);
    assert.match(css, /@media \(max-width: 1023px\)/);
  });

  assert.deepEqual(Object.keys(selected).sort(), [
    'assets/app.js',
    'assets/app.js.raw',
    'assets/site.css',
    'index.html',
  ]);
  assert.equal(selected['assets/app.js'], 'const gallery=[]');
  assert.match(BUILD_RECIPE_VERSION, /spa-gallery-js@2026-08-22/);
});

test('SPA gallery literals dedupe while copy and unique images remain byte exact', () => {
  const source = [
    'const gallery=[',
    '{src:"/same.jpg?width=400",alt:"First real project"},',
    '{src:"/same.jpg?width=900",alt:"Second real project"},',
    '{src:"/unique.webp",alt:"Unique real project"}',
    '];',
    'function App(){return jsx("section",{id:"gallery",children:"Our work copy"})}'
  ].join('');

  const result = dedupeJavaScriptGallery(source, {
    replacementUrls: ['https://client.example/owned-job.jpg']
  });

  assert.equal(result.replaced.length, 1);
  assert.deepEqual(result.replaced[0], {
    from: '/same.jpg?width=900',
    to: 'https://client.example/owned-job.jpg'
  });
  assert.equal(
    result.javascript,
    source.replace(
      'src:"/same.jpg?width=900"',
      'src:"https://client.example/owned-job.jpg"'
    )
  );
  assert.match(result.javascript, /alt:"Second real project"/);
  assert.match(result.javascript, /src:"\/unique\.webp"/);
  assert.match(result.javascript, /children:"Our work copy"/);
  assert.deepEqual(result.warnings, []);
});

test('minified SPA aliases resolve inside a nearby projects section', () => {
  const source = [
    'const $a="/project.jpg?small=1",b="/project.jpg?large=1",c="/third.png",',
    'g=[{image:$a,title:"One"},{image:b,title:"Two"},{image:c,title:"Three"}];',
    'function x(){return r.jsx("section",{id:`projects`,children:g.map(y)})}'
  ].join('');

  const result = dedupeJavaScriptGallery(source, {
    replacementUrls: ['https://client.example/replacement']
  });

  assert.equal(result.replaced.length, 1);
  assert.equal(result.replaced[0].from, '/project.jpg?large=1');
  assert.match(
    result.javascript,
    /\{image:"https:\/\/client\.example\/replacement",title:"Two"\}/
  );
  assert.match(result.javascript, /const \$a="\/project\.jpg\?small=1"/);
  assert.match(result.javascript, /\{image:c,title:"Three"\}/);
});

test('image-only lookbook arrays resolve their static aliases', () => {
  const source = [
    'const a="/same.webp",b="/same.webp",c="/third.webp",x=[a,b,c];',
    'function Lookbook(){return jsx("div",{children:x.map(renderImage)})}'
  ].join('');

  const result = dedupeJavaScriptGallery(source, {
    replacementUrls: ['/owned.webp']
  });

  assert.equal(result.replaced.length, 1);
  assert.equal(
    result.javascript,
    source.replace('x=[a,b,c]', 'x=[a,"/owned.webp",c]')
  );
});

test('nested packet gallery arrays dedupe img fields only', () => {
  const source = [
    'const packet={name:"Keep me",gallery:[',
    '{img:"/same.jpg",caption:"First"},',
    '{img:"/same.jpg",caption:"Second"},',
    '{img:"/third.jpg",caption:"Third"}',
    ']};'
  ].join('');

  const result = dedupeJavaScriptGallery(source, {
    replacementUrls: ['/owned.jpg']
  });

  assert.equal(result.replaced.length, 1);
  assert.match(result.javascript, /name:"Keep me"/);
  assert.match(result.javascript, /img:"\/owned\.jpg",caption:"Second"/);
  assert.match(result.javascript, /img:"\/third\.jpg",caption:"Third"/);
});

test('replacement already present elsewhere in the bundle is skipped', () => {
  const source = [
    'const hero={src:"/already.jpg"};',
    'const gallery=[{src:"/same.jpg"},{src:"/same.jpg"}];',
    'function App(){return jsx("section",{id:"gallery"})}'
  ].join('');

  const result = dedupeJavaScriptGallery(source, {
    replacementUrls: ['/already.jpg?new=1', '/fresh.jpg']
  });

  assert.equal(result.replaced.length, 1);
  assert.equal(result.replaced[0].to, '/fresh.jpg');
  assert.match(result.javascript, /src:"\/fresh\.jpg"/);
});

test('a hero reused in a SPA gallery keeps the hero and replaces the gallery use', () => {
  const source = [
    'const a="/hero.jpg",b="/job.jpg";',
    'function Hero(){return jsx("img",{src:a,alt:"Hero stays"})}',
    'const g=[{src:a,alt:"Repeated hero"},{src:b,alt:"Unique job"}];',
    'function Gallery(){return jsx("section",{id:"gallery",children:g})}'
  ].join('');

  const result = dedupeJavaScriptGallery(source, {
    replacementUrls: ['/owned.jpg']
  });

  assert.equal(result.replaced.length, 1);
  assert.match(result.javascript, /\{src:a,alt:"Hero stays"\}/);
  assert.match(result.javascript, /\{src:"\/owned\.jpg",alt:"Repeated hero"\}/);
  assert.match(result.javascript, /\{src:b,alt:"Unique job"\}/);
});

test('duplicate service imagery outside a gallery contract is untouched', () => {
  const source = [
    'const services=[',
    '{src:"/shared.jpg",title:"Repair projects"},',
    '{src:"/shared.jpg",title:"Install"}',
    '];',
    'function App(){return jsx("section",{id:"services",children:services})}'
  ].join('');

  const result = dedupeJavaScriptGallery(source, {
    replacementUrls: ['/owned.jpg']
  });

  assert.equal(result.javascript, source);
  assert.deepEqual(result.replaced, []);
  assert.deepEqual(result.warnings, []);
});

test('dynamic template image expressions remain untouched', () => {
  const source = [
    'const gallery=[',
    '{src:`${cdn}/same.jpg`,alt:"One"},',
    '{src:`${cdn}/same.jpg`,alt:"Two"}',
    '];',
    'function App(){return jsx("section",{id:"gallery"})}'
  ].join('');

  const result = dedupeJavaScriptGallery(source, {
    replacementUrls: ['/owned.jpg']
  });

  assert.equal(result.javascript, source);
  assert.deepEqual(result.replaced, []);
});

test('SPA gallery replacement is idempotent', () => {
  const source = [
    'const gallery=[{src:"/same.jpg"},{src:"/same.jpg"}];',
    'function App(){return jsx("section",{id:"gallery"})}'
  ].join('');
  const options = { replacementUrls: ['/owned.jpg'] };

  const first = dedupeJavaScriptGallery(source, options);
  const second = dedupeJavaScriptGallery(first.javascript, options);

  assert.equal(first.replaced.length, 1);
  assert.equal(second.javascript, first.javascript);
  assert.deepEqual(second.replaced, []);
});

test('missing replacement preserves the bundle and warns once per duplicate URL', () => {
  const source = [
    'const gallery=[',
    '{src:"/same.jpg"},{src:"/same.jpg"},{src:"/same.jpg"}',
    '];',
    'function App(){return jsx("section",{id:"gallery"})}'
  ].join('');

  const result = dedupeJavaScriptGallery(source, { replacementUrls: [] });

  assert.equal(result.javascript, source);
  assert.deepEqual(result.replaced, []);
  assert.deepEqual(result.warnings, [
    'no replacement available for /same.jpg'
  ]);
});

test('replacement stays a JavaScript string and cannot inject executable code', () => {
  const source = [
    'const gallery=[{src:"/same.jpg"},{src:"/same.jpg"}];',
    'function App(){return jsx("section",{id:"gallery"})}'
  ].join('');
  const hostile = 'https://client.example/x.jpg";globalThis.pwned=1;//<script>';

  const result = dedupeJavaScriptGallery(source, {
    replacementUrls: [hostile]
  });

  assert.equal(result.replaced.length, 1);
  assert.doesNotMatch(result.javascript, /\/\/<script>/);
  assert.match(result.javascript, /\\u003cscript\\u003e/);
  assert.match(result.javascript, /x\.jpg\\";globalThis\.pwned=1;/);
});

test('polishSite handles first-party SPA bundles and skips vendor bundles', () => {
  const bundle = [
    'const g=[{src:"/same.jpg",alt:"One"},{src:"/same.jpg",alt:"Two"}];',
    'function App(){return jsx("section",{id:"portfolio",children:g})}'
  ].join('');
  const files = {
    'index.html': '<html><head></head><body><div id="root"></div></body></html>',
    'assets/index-abc123.js': bundle,
    'assets/vendor-react.js': bundle,
    'assets/legacy.min.js': bundle,
    'assets/site.css': '.gallery{display:grid}'
  };

  const result = polishSite(files, {
    replacementUrls: ['/owned.jpg']
  });

  assert.equal(result.applied.deduped, 1);
  assert.match(result.files['assets/index-abc123.js'], /src:"\/owned\.jpg"/);
  assert.equal(result.files['assets/vendor-react.js'], bundle);
  assert.equal(result.files['assets/legacy.min.js'], bundle);
  assert.equal(result.files['assets/site.css'], files['assets/site.css']);
  assert.match(result.files['index.html'], /id="wss-fleet-polish"/);
});

test('hostile JavaScript inputs fail soft', () => {
  for (const value of [null, undefined, 42, true, {}, []]) {
    const result = dedupeJavaScriptGallery(value);
    assert.equal(result.javascript, value);
    assert.deepEqual(result.replaced, []);
    assert.ok(result.warnings.length >= 1);
  }
});
