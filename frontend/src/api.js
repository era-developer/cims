import axios from 'axios';

// API Configuration
// Set REACT_APP_API_URL environment variable to change the backend URL
// Example for ngrok: REACT_APP_API_URL=https://abc123.ngrok.io

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

// Create axios instance with custom base URL
const apiClient = axios.create({
  baseURL: API_URL,
});

export default API_URL;
export { apiClient };
