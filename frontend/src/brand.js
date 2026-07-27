import { getCurrentCenter } from './centers';

const currentCenter = getCurrentCenter();

export const APP_SHORT_NAME = 'CIMS';
export const APP_LONG_NAME = currentCenter ? `${currentCenter.name} - CIMS` : 'Comedkares Innovation Hub Inventory Management System';
export const APP_EXPANDED_NAME = APP_LONG_NAME;
export const APP_SUBTITLE = currentCenter ? currentCenter.name : 'Comedkares Innovation Hub';
export const PRIMARY_COLOR = currentCenter?.brand?.primaryColor || '#1a237e';
export const LOGO_URL = currentCenter?.brand?.logo || '/logo.png';
export const REGISTRATION_QUERY = '?register=1';
