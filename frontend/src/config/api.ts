// API configuration
export const API_BASE_URL = process.env.NODE_ENV === 'production' 
  ? 'https://fqz86w2yp5.execute-api.eu-west-1.amazonaws.com/prod'
  : '';

export const API_ENDPOINTS = {
  // Content endpoints
  CONTENT_GENERATE: '/api/content/generate',
  CONTENT_REVISE: '/api/content/revise',
  CONTENT_STATUS: '/api/content/status',
  CONTENT_GET: '/api/content',
  CONTENT_MESSAGES: '/api/content/{id}/messages',
  CONTENT_VALIDATE: '/api/content/validate',
  
  // Image endpoints
  IMAGE_GENERATE: '/api/image/generate',
  IMAGE_STATUS: '/api/image/status',
  IMAGE_REVISE: '/api/image/revise',
  IMAGE_ANALYZE: '/api/image/analyze',
  
  // Input endpoints
  INPUT_AUDIO: '/api/input/audio',
  INPUT_TEXT: '/api/input/text',
  INPUT_STATUS: '/api/input/status',
  
  // General endpoints
  STATUS: '/api/status',
} as const;