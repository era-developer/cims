# Cleanup Reference

This document captures the current cleanup audit, recommended actions, and the scripts you should rely on going forward. It complements the README by calling out which files are still considered “official” and which items are now classified as archived or generated output.

## 1. Audit of untracked/generated assets

### Untracked documentation & scripts
- `.github/` (CI or workspace scaffolding that may have been cloned into the repo)
- `start-server.bat`

### Untracked data dumps
- `backend/data/belagavi/`
- `backend/data/gopalan_mall/`
- `backend/data/hubballi/`
- `backend/data/kalaburagi/`
- `backend/data/mangalore/`
- `backend/data/mysore/`
- `backend/data/tumkur/`
- `backend/data/yelahanka/`

### Legacy scripts/tools
- `backend/migrate_users.js`
- `backend/test-email-config.js`
- `backend/utils/centers.js`
- `backend/utils/centers_old.js`
- `frontend/src/centers.js`
- `frontend/src/pages/AdminAnalytics.jsx`
- `frontend/src/pages/RegisterLanding.jsx`
- `backend/verify-system.js`

## 2. Action plan

1. **Treat the untracked data dumps as working copies.** They are large Excel exports that should live outside the Git repo. Continue to ignore future `backend/data/<center>` directories via `.gitignore` (see `.gitignore` for current rules) and archive the ones listed above in an external `data-exports/` folder if you need to keep them.
2. **Archive legacy scripts.** The original `importReferenceInventory.js` and `sync-inventories.js` now live under `backend/scripts/legacy/`. Their stub replacements log a warning and throw so nobody accidentally executes them.
3. **Keep only the canonical inventory updater.** `backend/scripts/updateGopalanInventory.js` is now the single, documented entry point for refreshing any center. Run it like:
   ```
   node backend/scripts/updateGopalanInventory.js hubballi mangalore
   ```
   Pass center IDs (or omit them to refresh every center) whenever you need to sync new Excel data.

## 3. Official operational scripts

- `backend/server.js` – start the backend API.
- `frontend` scripts (`npm run start`, `npm run build`, `npm run test`) as already listed in `frontend/package.json`.
- `backend/scripts/updateGopalanInventory.js` – the only script that should modify inventories from spreadsheet inputs; see `README.md` for the detailed procedure.

Anything outside of this list (e.g., the legacy scripts above or the mass-export logs) is either for reference or should be maintained outside version control.
