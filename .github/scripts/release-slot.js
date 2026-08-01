'use strict';

const METADATA_START = '<!-- build-assets:start -->';
const METADATA_END = '<!-- build-assets:end -->';
const CREATE_ATTEMPTS = 3;

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function releaseSortOrder(left, right) {
  const timeDifference = Date.parse(right.created_at) - Date.parse(left.created_at);
  return timeDifference || right.id - left.id;
}

function selectReleaseSlot(releases, product, commit, assetName) {
  const prefix = `${product}-${commit}-`;
  const tagPattern = new RegExp(`^${escapeRegex(prefix)}(\\d+)$`);
  const slots = releases
    .map((release) => ({ release, match: tagPattern.exec(release.tag_name) }))
    .filter(({ release, match }) => release.target_commitish === commit && match)
    .map(({ release, match }) => ({ release, index: Number.parseInt(match[1], 10) }))
    .sort((left, right) => releaseSortOrder(left.release, right.release));

  const reusableSlot = slots.find(
    ({ release }) => !release.assets.some((asset) => asset.name === assetName),
  );
  if (reusableSlot) {
    return { created: false, release: reusableSlot.release };
  }

  const nextIndex = Math.max(0, ...slots.map(({ index }) => index)) + 1;
  return { created: true, tagName: `${prefix}${nextIndex}` };
}

function renderReleaseMetadata(commit, assets) {
  const assetLines = assets.length === 0
    ? ['- Upload in progress']
    : assets.map((asset) => `- ${asset.label || asset.name}: \`${asset.name}\``);

  return [
    METADATA_START,
    `Build commit: \`${commit}\``,
    '',
    'Assets:',
    ...assetLines,
    METADATA_END,
  ].join('\n');
}

function replaceReleaseMetadata(existingBody, metadata) {
  const markerPattern = new RegExp(
    `${escapeRegex(METADATA_START)}[\\s\\S]*?${escapeRegex(METADATA_END)}`,
  );

  if (markerPattern.test(existingBody)) {
    return existingBody.replace(markerPattern, metadata);
  }

  return existingBody ? `${metadata}\n\n${existingBody}` : metadata;
}

async function allocateRelease({ github, owner, repo, product, commit, assetName }) {
  for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt += 1) {
    const releases = await github.paginate(github.rest.repos.listReleases, {
      owner,
      repo,
      per_page: 100,
    });
    const slot = selectReleaseSlot(releases, product, commit, assetName);

    if (!slot.created) {
      return slot.release;
    }

    try {
      const { data: release } = await github.rest.repos.createRelease({
        owner,
        repo,
        tag_name: slot.tagName,
        target_commitish: commit,
        name: slot.tagName,
        body: renderReleaseMetadata(commit, []),
        generate_release_notes: true,
      });
      return release;
    } catch (error) {
      if (error.status !== 422 || attempt === CREATE_ATTEMPTS - 1) {
        throw error;
      }
    }
  }

  throw new Error('unreachable release allocation state');
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set`);
  }
  return value;
}

async function allocateCurrentRelease({ github, context, core }) {
  const product = requiredEnvironment('RELEASE_PRODUCT');
  const assetName = requiredEnvironment('RELEASE_ASSET_NAME');
  const { owner, repo } = context.repo;
  const release = await allocateRelease({
    github,
    owner,
    repo,
    product,
    commit: context.sha,
    assetName,
  });

  core.setOutput('tag', release.tag_name);
}

async function refreshCurrentReleaseMetadata({ github, context }) {
  const tagName = requiredEnvironment('RELEASE_TAG');
  const { owner, repo } = context.repo;
  const { data: release } = await github.rest.repos.getReleaseByTag({
    owner,
    repo,
    tag: tagName,
  });

  await github.rest.repos.updateRelease({
    owner,
    repo,
    release_id: release.id,
    body: replaceReleaseMetadata(
      release.body || '',
      renderReleaseMetadata(release.target_commitish, release.assets),
    ),
  });
}

module.exports = {
  allocateCurrentRelease,
  allocateRelease,
  refreshCurrentReleaseMetadata,
  renderReleaseMetadata,
  replaceReleaseMetadata,
  selectReleaseSlot,
};
