import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock MediaRecorder API
const mockMediaRecorder = {
  start: vi.fn(),
  stop: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  state: 'inactive',
  stream: null,
  mimeType: 'audio/webm',
  ondataavailable: null,
  onerror: null,
  onpause: null,
  onresume: null,
  onstart: null,
  onstop: null,
};

Object.defineProperty(window, 'MediaRecorder', {
  writable: true,
  value: vi.fn().mockImplementation(() => mockMediaRecorder),
});

Object.defineProperty(MediaRecorder, 'isTypeSupported', {
  writable: true,
  value: vi.fn().mockReturnValue(true),
});

// Mock getUserMedia
Object.defineProperty(navigator, 'mediaDevices', {
  writable: true,
  value: {
    getUserMedia: vi.fn().mockResolvedValue({
      getTracks: () => [{ stop: vi.fn() }],
    }),
  },
});

// Mock Web Audio API
Object.defineProperty(window, 'AudioContext', {
  writable: true,
  value: vi.fn().mockImplementation(() => ({
    createAnalyser: vi.fn().mockReturnValue({
      connect: vi.fn(),
      disconnect: vi.fn(),
      fftSize: 256,
      frequencyBinCount: 128,
      getByteFrequencyData: vi.fn(),
      getByteTimeDomainData: vi.fn(),
    }),
    createMediaStreamSource: vi.fn().mockReturnValue({
      connect: vi.fn(),
      disconnect: vi.fn(),
    }),
    close: vi.fn(),
    state: 'running',
  })),
});

// Mock IntersectionObserver
Object.defineProperty(window, 'IntersectionObserver', {
  writable: true,
  value: vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  })),
});

// Mock ResizeObserver
Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  })),
});

// Mock localStorage
Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  },
  writable: true,
});

// Mock sessionStorage
Object.defineProperty(window, 'sessionStorage', {
  value: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  },
  writable: true,
});

// Mock fetch
global.fetch = vi.fn();

// Mock performance API
Object.defineProperty(window, 'performance', {
  writable: true,
  value: {
    now: vi.fn(() => Date.now()),
    mark: vi.fn(),
    measure: vi.fn(),
    getEntriesByName: vi.fn(() => []),
    getEntriesByType: vi.fn(() => []),
    clearMarks: vi.fn(),
    clearMeasures: vi.fn(),
    memory: {
      usedJSHeapSize: 1000000,
      totalJSHeapSize: 2000000,
      jsHeapSizeLimit: 4000000,
    },
  },
});

// Mock requestIdleCallback
Object.defineProperty(window, 'requestIdleCallback', {
  writable: true,
  value: vi.fn((callback) => {
    setTimeout(() => callback({ timeRemaining: () => 50 }), 0);
  }),
});

// Mock cancelIdleCallback
Object.defineProperty(window, 'cancelIdleCallback', {
  writable: true,
  value: vi.fn(),
});

// Mock Notification API
Object.defineProperty(window, 'Notification', {
  writable: true,
  value: {
    permission: 'default',
    requestPermission: vi.fn().mockResolvedValue('granted'),
  },
});

// Mock Service Worker
Object.defineProperty(navigator, 'serviceWorker', {
  writable: true,
  value: {
    register: vi.fn().mockResolvedValue({
      installing: null,
      waiting: null,
      active: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
    ready: Promise.resolve({
      installing: null,
      waiting: null,
      active: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
    controller: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  },
});

// Mock online/offline status
Object.defineProperty(navigator, 'onLine', {
  writable: true,
  value: true,
});

// Mock URL.createObjectURL
Object.defineProperty(URL, 'createObjectURL', {
  writable: true,
  value: vi.fn(() => 'blob:mock-url'),
});

Object.defineProperty(URL, 'revokeObjectURL', {
  writable: true,
  value: vi.fn(),
});

// Mock Blob constructor
global.Blob = vi.fn().mockImplementation((content, options) => ({
  size: content ? content.reduce((acc: number, chunk: any) => acc + chunk.length, 0) : 0,
  type: options?.type || '',
  arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
  text: vi.fn().mockResolvedValue(''),
  stream: vi.fn(),
  slice: vi.fn(),
}));

// Mock File constructor
global.File = vi.fn().mockImplementation((content, name, options) => ({
  ...new Blob(content, options),
  name,
  lastModified: Date.now(),
  webkitRelativePath: '',
}));

// Mock FormData
global.FormData = vi.fn().mockImplementation(() => ({
  append: vi.fn(),
  delete: vi.fn(),
  get: vi.fn(),
  getAll: vi.fn(),
  has: vi.fn(),
  set: vi.fn(),
  entries: vi.fn(),
  keys: vi.fn(),
  values: vi.fn(),
}));

// Setup cleanup after each test
// afterEach(() => {
//   vi.clearAllMocks();
// });