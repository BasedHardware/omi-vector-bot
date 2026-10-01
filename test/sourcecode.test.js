const assert = require('node:assert/strict');
const test = require('node:test');
const { loadOfficialSource, usefulSourceEntry } = require('../sourcecode');

test('official source selection covers support logic and excludes generated or unrelated files', () => {
  assert.equal(usefulSourceEntry({ type: 'blob', path: 'app/lib/providers/message_provider.dart', size: 1200 }), true);
  assert.equal(usefulSourceEntry({ type: 'blob', path: 'app/lib/services/capture/capture_controller.dart', size: 1200 }), true);
  assert.equal(usefulSourceEntry({ type: 'blob', path: 'app/lib/pages/home.dart', size: 1200 }), false);
  assert.equal(usefulSourceEntry({ type: 'blob', path: 'app/lib/services/api.g.dart', size: 1200 }), false);
  assert.equal(usefulSourceEntry({ type: 'tree', path: 'app/lib/services/capture', size: 1200 }), false);
});

test('official source loader indexes public app behavior files without GitHub code search', async () => {
  const saved = [];
  const count = await loadOfficialSource(
    async (url) => {
      const target = String(url);
      if (target.includes('/git/trees/')) {
        return {
          ok: true,
          json: async () => ({
            tree: [
              { type: 'blob', path: 'app/lib/providers/message_provider.dart', size: 100 },
              { type: 'blob', path: 'app/lib/services/capture/capture_controller.dart', size: 100 },
              { type: 'blob', path: 'app/lib/pages/home.dart', size: 100 },
            ],
          }),
        };
      }
      return { ok: true, text: async () => `source for ${target}` };
    },
    { saveDocPage: async (page) => saved.push(page) }
  );

  assert.equal(count, 2);
  assert.equal(saved.length, 2);
  assert.match(saved[0].url, /^https:\/\/github\.com\/BasedHardware\/omi\/blob\/main\//);
  assert.equal(saved[0].title, 'app/lib/providers/message_provider.dart');
  assert.match(saved[1].body, /capture_controller\.dart/);
});
