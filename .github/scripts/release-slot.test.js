'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  allocateRelease,
  replaceReleaseMetadata,
  renderReleaseMetadata,
  selectReleaseSlot,
} = require('./release-slot.js');

const COMMIT = '0123456789abcdef0123456789abcdef01234567';

function release(tagName, createdAt, assets = [], targetCommitish = COMMIT) {
  return {
    id: Number.parseInt(tagName.match(/(\d+)$/)[1], 10),
    tag_name: tagName,
    target_commitish: targetCommitish,
    created_at: createdAt,
    assets,
  };
}

test('reuses the newest same-commit slot missing the platform asset', () => {
  const product = 'td';
  const slot = selectReleaseSlot(
    [
      release(`${product}-${COMMIT}-1`, '2026-08-01T12:00:00Z', [
        { name: 'td-linux-x86_64' },
      ]),
      release(`${product}-${COMMIT}-2`, '2026-08-01T13:00:00Z', [
        { name: 'td-macos-arm64' },
      ]),
      release(`${product}-different-commit-1`, '2026-08-01T14:00:00Z', []),
    ],
    product,
    COMMIT,
    'td-linux-x86_64',
  );

  assert.equal(slot.created, false);
  assert.equal(slot.release.tag_name, `${product}-${COMMIT}-2`);
});

test('allocates the next index when every slot already has the platform asset', () => {
  const product = 'libtorrent';
  const slot = selectReleaseSlot(
    [
      release(`${product}-${COMMIT}-1`, '2026-08-01T12:00:00Z', [
        { name: 'libtorrent-static-linux-x86_64.tar.gz' },
      ]),
      release(`${product}-${COMMIT}-3`, '2026-08-01T13:00:00Z', [
        { name: 'libtorrent-static-linux-x86_64.tar.gz' },
      ]),
    ],
    product,
    COMMIT,
    'libtorrent-static-linux-x86_64.tar.gz',
  );

  assert.equal(slot.created, true);
  assert.equal(slot.tagName, `${product}-${COMMIT}-4`);
});

test('creates the next tag at the current commit', async () => {
  const createCalls = [];
  const github = {
    paginate: async () => [
      release(`td-${COMMIT}-1`, '2026-08-01T12:00:00Z', [
        { name: 'td-linux-x86_64' },
      ]),
    ],
    rest: {
      repos: {
        listReleases: () => undefined,
        createRelease: async (parameters) => {
          createCalls.push(parameters);
          return {
            data: release(parameters.tag_name, '2026-08-01T13:00:00Z', []),
          };
        },
      },
    },
  };

  const created = await allocateRelease({
    github,
    owner: 'xpbl',
    repo: 'libtorrent-ci',
    product: 'td',
    commit: COMMIT,
    assetName: 'td-linux-x86_64',
  });

  assert.equal(created.tag_name, `td-${COMMIT}-2`);
  assert.equal(createCalls.length, 1);
  assert.equal(createCalls[0].target_commitish, COMMIT);
  assert.equal(createCalls[0].tag_name, `td-${COMMIT}-2`);
  assert.equal(createCalls[0].generate_release_notes, true);
});

test('refreshes only the build metadata and retains generated release notes', () => {
  const metadata = renderReleaseMetadata(COMMIT, [
    { name: 'td-linux-x86_64', label: 'Linux x86_64' },
    { name: 'td-macos-arm64', label: 'macOS arm64' },
  ]);
  const existingBody = [
    '<!-- build-assets:start -->',
    'outdated metadata',
    '<!-- build-assets:end -->',
    '',
    '**Full Changelog**: https://github.com/xpbl/libtorrent-ci/compare/old...new',
  ].join('\n');

  assert.match(metadata, /Build commit: `0123456789abcdef0123456789abcdef01234567`/);
  assert.match(metadata, /Linux x86_64: `td-linux-x86_64`/);
  assert.match(metadata, /macOS arm64: `td-macos-arm64`/);
  assert.equal(
    replaceReleaseMetadata(existingBody, metadata),
    `${metadata}\n\n**Full Changelog**: https://github.com/xpbl/libtorrent-ci/compare/old...new`,
  );
});
