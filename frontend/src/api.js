import axios from 'axios';

/**
 * This configuration solves the mobile/network login issue.
 *
 * THE PROBLEM:
 * When the frontend is built and served by the backend on port 5000,
 * accessing it from a phone via an IP address (e.g., http://192.168.1.5:5000) works for the initial page load.
 * However, subsequent API calls made by JavaScript might be hardcoded to 'http://localhost:5000/api/...'.
 * On a phone, 'localhost' refers to the phone itself, not the server, so the API call fails.
 *
 * THE SOLUTION:
 * We dynamically set the `baseURL` for all axios requests.
 * In 'production' mode (when the app is built), we use `window.location.origin`.
 * This will be 'http://192.168.1.5:5000' when accessed from the phone, ensuring API calls go to the correct server.
 */
if (process.env.NODE_ENV === 'production') {
  axios.defaults.baseURL = window.location.origin;
}

// To resolve build errors where some files may expect a named export,
// we export the configured axios instance as `apiClient`.
export const apiClient = axios;

// By importing this file once in the application's entry point (e.g., index.js),
// this configuration is applied globally to all subsequent axios requests.
export default axios;