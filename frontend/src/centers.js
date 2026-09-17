// Centers are no longer a frontend constant.
//
// They live in the `centers` database table and are created and edited by a
// super admin at runtime (Admin -> Centers), so a compiled-in list would go
// stale the moment a center is added. Read them from the CentersProvider:
//
//   import { useCenters } from '../context/CentersContext';
//   const { centers, getCenterName } = useCenters();
//
// The subdomain-based per-center theming this file used to provide
// (getCurrentCenter / getCenterBySubdomain / brand colours per center) is
// gone with it: that was specific to the Comedkare multi-center deployment,
// where each center had its own hostname and brand assets checked into the
// repo. Org-level branding now comes from src/brand.js.

export { useCenters } from './context/CentersContext';
