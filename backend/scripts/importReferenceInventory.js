console.warn(
  '[DEPRECATED] `importReferenceInventory.js` has been archived.',
  'Run `node scripts/updateGopalanInventory.js` (with center IDs) or use the legacy copy under `scripts/legacy` instead.',
);

module.exports = async function deprecatedImportReferenceInventory() {
  throw new Error(
    'importReferenceInventory.js is deprecated. ' +
    'See backend/scripts/legacy/importReferenceInventory.js for the original implementation, ' +
    'and use backend/scripts/updateGopalanInventory.js for current workflows.',
  );
};
