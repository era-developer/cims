# Project Guidelines

## Code Style
- Variables/Functions: camelCase (`getUserById`, `fetchOrders`)
- React Components: PascalCase (`AdminDashboard`, `StudentDashboard`)
- Routes/IDs: snake_case or kebab-case (`jp_nagar`, `gopalan_mall`)
- User Roles: `'student'`, `'admin'`, `'super_admin'` (strings)
- Order Status: `'Pending'`, `'Approved'`, `'Rejected'`, `'Issued'`, `'Returned'` (Title case in Excel, lowercase in code)

Reference: [backend/utils/excel.js](backend/utils/excel.js) for data schemas

## Architecture
Express.js backend (port 5000) serving React 18 frontend, with Excel-based data persistence. 9 isolated centers, each with separate `users.xlsx`, `inventory.xlsx`, `orders.xlsx` files. `super_admin` can view all centers; others see only their center.

Key files: [backend/server.js](backend/server.js) (entry point), [backend/utils/centers.js](backend/utils/centers.js) (center definitions), [backend/utils/excel.js](backend/utils/excel.js) (data access), [frontend/src/api.js](frontend/src/api.js) (dynamic API URL detection)

## Build and Test
- Quick start: `start.bat` (Windows) or `./start.sh` (Linux/Mac) - installs, builds, runs
- Backend dev: `cd backend && npm run dev`
- Frontend dev: `cd frontend && npm start`
- Build frontend: `cd frontend && npm run build` (required before serving)
- Test system: `node test-complete-system.js`
- Test email: `node backend/test-email-config.js`

## Conventions
- Error handling: try/catch with status codes (400 client, 401 auth, 403 forbidden, 500 server)
- React async data: `useEffect` calls separate async function, sets loading state
- Form modals: modal state (`'create'|'edit'|null`), form state with `EMPTY_FORM` constant
- Excel schemas: `id` (UUID), `centerId`, `active` boolean, timestamps

Reference existing docs: [README.md](README.md) for overview, [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) for setup, [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md) for production config