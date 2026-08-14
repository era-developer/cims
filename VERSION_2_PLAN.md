# CIMS Version 2 — Implementation Plan

**Status:** Phases 0-3 complete. Auth, inventory, orders/issue-return, and center-to-center transfers all run on SQLite now; the old per-center Excel files are no longer read or written by any live code path (archived, not deleted, at `backend/legacy_excel_data_archive/`, per this plan's original archival policy). All 9 centers share JP Nagar's catalog structure — JP Nagar carries real stock from its spreadsheet import, the other 8 start at zero stock pending their own procurement. The app was reset to a clean "under construction" state at the user's request: one super_admin, one admin, and one test student per center are the only surviving accounts (all `Cims@2026`), with all prior student/order history cleared.

**Additions beyond the original phase scope**, based on hands-on testing feedback:
- Photos now live once per component type (`product_catalog.image`), not duplicated per physical unit — avoids database bloat from camera-captured photos. Camera capture (via `PhotoInput` component) and URL paste both supported, on both the full Invoice Entry form and the quick Add Component modal.
- Invoice edit and delete (`PUT`/`DELETE /api/invoices/:id`), restricted to `super_admin`. Delete is blocked with a clear message if any generated asset has moved past "available" (issued/damaged/etc.) — real usage history is never silently destroyed. Editing supports quantity changes (increase adds new units; decrease only removes still-"available" ones).
- "Add Component" quick-add (single-line-item invoice) consolidated onto the Invoice Entry page below the history table, rather than duplicated on the Inventory page — keeps Inventory focused on browsing/lifecycle, Invoice Entry as the one procurement entry point.
- Search and classification filter added to the invoice history list.

**Phase 3 delivered (plus transfers, originally scoped under reqs 5/9):** student issue/return runs on the dormant Phase-0 `issue_records`/`issue_record_items`/`issue_record_assets`/`order_return_items` tables, replacing the old per-center `*_orders.xlsx` files entirely — `backend/routes/orders.js`. Checkout is restricted server-side to the "Electronic components" classification (other classifications show read-only, "information only" in the UI); non-electronics can't reach the cart. Partial approval, partial return (good/damaged split), rejection with full stock restore, and return reminders (`backend/utils/reminders.js`) all run against real assets. `backend/routes/transfers.js` was rewritten the same way: approving a transfer physically reassigns the specific asset rows' `center_id` and `catalog_id` to the requesting center (and back again on return), instead of just editing a stock count — so a transferred unit's full lifecycle history stays intact and center totals never drift out of sync. Activity logs and WhatsApp message history also moved off Excel onto SQLite (`activity_logs`/`whatsapp_messages` tables) as part of finishing the Excel removal cleanly.

**Phase 2 delivered:** lifecycle status transitions (`available` &rarr; `damaged`/`under_repair` &rarr; `disposed`, plus repair-back-to-available), enforced via an allowed-transition map in `backend/routes/assets.js` (`PUT /api/assets/:id/status` for one unit, `PUT /api/assets/bulk-status` for moving N units at once). `AdminInventory.jsx` was rewritten to read live from the new asset/catalog system instead of the old Excel-backed `/api/components` — this also fixed the gap where invoice-added stock wasn't showing up in the Inventory page. Each catalog row now shows a live Available/Issued/Under Repair/Damaged/Disposed breakdown, with a per-unit drawer for viewing individual asset tags and triggering lifecycle actions.

**Phase 1 delivered:** `backend/routes/invoices.js` (invoice + line item entry, GST calc confirmed as line-items-only, mandatory field validation, duplicate invoice detection, auto-creates vendor/project/business-head if new), `backend/routes/assets.js` (asset listing, catalog-summary rollup, critical-electronics view, per-asset detail + history), `backend/utils/assetTag.js` (asset tag generation, format `<CENTER_CODE>-<CLASSIFICATION_ABBR>-<SEQ>`), `backend/utils/classifications.js` (shared classification list + critical-item keyword detection), frontend `AdminInvoiceEntry.jsx` wired at `/admin/invoices`. All tested against a throwaway DB copy before touching the live `backend/data/cims.db`, then read-only verified against the live server.

**Driver note:** the plan named `better-sqlite3`, but that needs a native C++ build (Visual Studio Build Tools), which isn't installed on this machine. Switched to Node's built-in `node:sqlite` module instead — same synchronous API, zero extra install, zero cost, currently marked experimental but works correctly on the installed Node v24.

**Phase 0 dry-run results** (against a copy of production data, live files untouched):
- 3,533 legacy inventory SKUs -> 130,672 individual asset records
- 5/5 orders -> 5 issue records (all items preserved)
- 27/27 users migrated
- 0 foreign-key violations
- 1 open question: Mangalore's "JUMPER WIRES BUNCH (M-F)" has totalProcured=5994 — unusually large, needs confirmation it's a real bulk count and not a data-entry error, before this becomes the live migration.
**v1 backup:** tagged in git as `v1-final` (recoverable anytime via `git checkout v1-final`).
**Cost:** $0 — every new dependency (SQLite, better-sqlite3, pdfkit) is free and open-source; no external services introduced.

## Context

The admin team submitted requirements for a v2 rebuild adding: invoice-based inventory entry with GST, unique per-asset IDs, full lifecycle tracking (procure→issue→return→repair→damage→dispose), persistent student profiles, exportable reports, waste analysis, procurement planning, project BOMs, and a richer dashboard.

The current (v1) system stores inventory as one row per **component type** (a stock count) in per-center Excel files, read/written positionally by column index. None of the above is representable in that model without significant fragility — v2's requirements are fundamentally relational (invoice → line items → individual assets → lifecycle history → issue/return → project/BOM → waste), so the datastore is migrating to an embedded SQLite database (still a single local file, no server, keeping the project's no-external-DB deployment philosophy).

Decisions confirmed with the user:
- Migrate to SQLite (not extending Excel further).
- Migrate existing v1 data into the new schema (not starting clean).
- Roll out to all 9 centers simultaneously (not piloted).
- Build phases in the requirement document's order, **except** BOM (req 8) is built before Waste Analysis (req 6) — waste tracking is far more useful once it can compare "consumed" against a BOM standard quantity.
- Auth (user login) migrates into SQLite alongside everything else, rather than staying on Excel.

## Schema overview

- **Master data**: `centers`, `vendors`, `business_heads`, `classifications` (fixed 13-item list), `projects`
- **Procurement**: `invoices` → `invoice_line_items` → `assets` (one row per physical unit — the core structural change from v1's per-SKU stock count)
- **Lifecycle & usage**: `asset_lifecycle_events` (append-only status history), `students`, `issue_records`/`issue_record_items`/`issue_record_assets` (replaces "orders"), `transfers`/`transfer_items`
- **Planning**: `boms`/`bom_items`, `waste_records`, `product_catalog` (keeps the familiar "one row per component type" list view over individually-tracked assets)
- **Auth**: `users` (migrated from `users.xlsx`, same bcrypt hashing)

Full column-level detail lives in the design session that produced this plan; will be formalized as `backend/db/migrations/001_init.sql` in Phase 0.

## Migration approach

1. Seed lookup tables (centers, classifications, placeholder vendor/business-head for unknowns).
2. Extract & dedupe vendors, projects, students from existing free-text fields.
3. Explode each SKU's `stock` count into individual synthetic `assets` rows (flagged `is_legacy`), with status back-filled from existing stock/issued/damaged counters.
4. Legacy items default to an "Unclassified (Legacy)" classification bucket for manual cleanup — no auto-guessing.
5. GST, unit price, and exact procurement dates for pre-v2 stock are left NULL, not fabricated.
6. Old Excel files are archived (moved, not deleted) after a validation report confirms row counts reconcile.

**Known limitation to accept going in**: legacy assets get no real per-unit history before cutover. Full lifecycle accuracy starts from whatever is procured *after* go-live.

## Phase plan

| Phase | Requirement(s) | Delivers | Status |
|---|---|---|---|
| 0 | Foundation | SQLite setup, schema migration runner, migration script dry-run + validation report against a **copy** of production data | Done |
| 1 | 1, 2 | Invoice entry (GST calc), unique Asset ID generation | Done |
| 2 | 3 | Lifecycle status tracking + full history view | Done |
| 3 | 4 | Student profiles, issue/return tied to real assets | Done |
| — | 5, 9 (pulled forward) | Center-to-center transfers on real assets; Excel fully removed | Done |
| 4 | 7, 8 | BOM + Procurement planning | Not started |
| 5 | 6 | Waste analysis (compares against BOM standard quantity) | Not started |
| 6 | 5, 9 | Reports (Excel/PDF export) + Dashboard | Dashboard live-stats done; export reports done for orders/users/transfers/inventory/logs/WhatsApp; PDF export not started |

## Open decisions to make at the right phase (not now)

| Decision | Phase | Leaning |
|---|---|---|
| GST calculation rule (applies before/after installation & freight) | 1 | confirm with finance before building |
| Consumable item return semantics (does "return" apply at all?) | 3 | decide during issue/return rework |
| PDF export library | 6 | `pdfkit` (lightweight, open-source, no headless browser needed) |
| Low-stock alert threshold model | 6 | per-catalog-item configurable reorder point |

## Verification approach

- Phase 0's migration runs against a **copy** of `backend/data/`, never the live files directly, until the validation report is reviewed and approved.
- Each phase ships with the existing frontend pages still functional against the new backend (API contracts preserved where reasonable) before the next phase starts.
- No production Excel files are deleted — archived alongside the `v1-final` git tag as a second layer of rollback safety.
