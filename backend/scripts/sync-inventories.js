console.warn('[DEPRECATED] sync-inventories.js is archived.', 'Use backend/scripts/updateGopalanInventory.js if you need to refresh center inventories.', 'A legacy copy with the original logic lives under scripts/legacy.');
module.exports = async function deprecatedSyncInventories() {
  throw new Error('sync-inventories.js has been archived. See backend/scripts/legacy/sync-inventories.js.');
};
