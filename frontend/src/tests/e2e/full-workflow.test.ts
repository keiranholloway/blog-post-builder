import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import App from '../../App';

// Mock services
vi.mock('../../services/inputProcessingService');
vi.mock('../../services/contentGenerationService');
vi.mock('../../services/imageGenerationService');
vi.mock('../../services/publishingStatusService');
vi.mock('../../services/authenticationService');

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

describe('Full Workflow End-to-End Tests', () => {
  const user = userEvent.setup();

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock successful API responses
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/process-audio')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            transcription: 'This is a test blog post about AI and technology.',
            contentId: 'test-content-id'
          }),
        });
      }
      if (url.includes('/api/content-status')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            status: 'completed',
            content: {
              title: 'AI and Technology: The Future',
              body: 'This is a comprehensive blog post about AI and technology...',
              imageUrl: 'https://example.com/generated-image.jpg'
            }
          }),
        });
      }
      if (url.includes('/api/publish')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            publishedUrls: {
              medium: 'https://medium.com/@user/test-post',
              linkedin: 'https://linkedin.com/pulse/test-post'
            }
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('completes full voice-to-published-blog workflow', async () => {
    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>
    );

    // Step 1: Voice input
    const voiceButton = screen.getByRole('button', { name: /start recording/i });
    expect(voiceButton).toBeInTheDocument();

    await user.click(voiceButton);
    expect(mockMediaRecorder.start).toHaveBeenCalled();

    // Simulate recording completion
    const stopButton = screen.getByRole('button', { name: /stop recording/i });
    await user.click(stopButton);
    expect(mockMediaRecorder.stop).toHaveBeenCalled();

    // Simulate audio data available
    const audioBlob = new Blob(['fake audio data'], { type: 'audio/webm' });
    mockMediaRecorder.ondataavailable?.({ data: audioBlob } as BlobEvent);
    mockMediaRecorder.onstop?.({} as Event);

    // Step 2: Wait for transcription and content generation
    await waitFor(() => {
      expect(screen.getByText(/processing your content/i)).toBeInTheDocument();
    }, { timeout: 5000 });

    // Step 3: Review interface should appear
    await waitFor(() => {
      expect(screen.getByText(/AI and Technology: The Future/i)).toBeInTheDocument();
      expect(screen.getByText(/This is a comprehensive blog post/i)).toBeInTheDocument();
    }, { timeout: 10000 });

    // Step 4: Approve content and proceed to publishing
    const approveButton = screen.getByRole('button', { name: /approve and publish/i });
    await user.click(approveButton);

    // Step 5: Select publishing platforms
    const mediumCheckbox = screen.getByRole('checkbox', { name: /medium/i });
    const linkedinCheckbox = screen.getByRole('checkbox', { name: /linkedin/i });
    
    await user.click(mediumCheckbox);
    await user.click(linkedinCheckbox);

    const publishButton = screen.getByRole('button', { name: /publish to selected platforms/i });
    await user.click(publishButton);

    // Step 6: Verify publishing success
    await waitFor(() => {
      expect(screen.getByText(/successfully published/i)).toBeInTheDocument();
      expect(screen.getByText(/medium.com/i)).toBeInTheDocument();
      expect(screen.getByText(/linkedin.com/i)).toBeInTheDocument();
    }, { timeout: 15000 });

    // Verify all API calls were made
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/process-audio'),
      expect.any(Object)
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/content-status'),
      expect.any(Object)
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/publish'),
      expect.any(Object)
    );
  });

  it('handles text input workflow', async () => {
    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>
    );

    // Switch to text input
    const textInputTab = screen.getByRole('tab', { name: /text input/i });
    await user.click(textInputTab);

    // Enter text content
    const textArea = screen.getByRole('textbox', { name: /enter your blog idea/i });
    await user.type(textArea, 'This is a test blog post idea about machine learning and its applications in healthcare.');

    // Submit text
    const submitButton = screen.getByRole('button', { name: /create blog post/i });
    await user.click(submitButton);

    // Wait for content generation
    await waitFor(() => {
      expect(screen.getByText(/processing your content/i)).toBeInTheDocument();
    }, { timeout: 5000 });

    // Verify content appears
    await waitFor(() => {
      expect(screen.getByText(/AI and Technology: The Future/i)).toBeInTheDocument();
    }, { timeout: 10000 });
  });

  it('handles revision workflow', async () => {
    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>
    );

    // Start with voice input (abbreviated)
    const voiceButton = screen.getByRole('button', { name: /start recording/i });
    await user.click(voiceButton);
    
    const stopButton = screen.getByRole('button', { name: /stop recording/i });
    await user.click(stopButton);

    const audioBlob = new Blob(['fake audio data'], { type: 'audio/webm' });
    mockMediaRecorder.ondataavailable?.({ data: audioBlob } as BlobEvent);
    mockMediaRecorder.onstop?.({} as Event);

    // Wait for content to appear
    await waitFor(() => {
      expect(screen.getByText(/AI and Technology: The Future/i)).toBeInTheDocument();
    }, { timeout: 10000 });

    // Request revision
    const revisionButton = screen.getByRole('button', { name: /request revision/i });
    await user.click(revisionButton);

    const feedbackTextarea = screen.getByRole('textbox', { name: /feedback/i });
    await user.type(feedbackTextarea, 'Please make the introduction more engaging and add more technical details.');

    const submitFeedbackButton = screen.getByRole('button', { name: /submit feedback/i });
    await user.click(submitFeedbackButton);

    // Verify revision request was processed
    await waitFor(() => {
      expect(screen.getByText(/revision requested/i)).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it('handles error scenarios gracefully', async () => {
    // Mock API failure
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>
    );

    const voiceButton = screen.getByRole('button', { name: /start recording/i });
    await user.click(voiceButton);
    
    const stopButton = screen.getByRole('button', { name: /stop recording/i });
    await user.click(stopButton);

    const audioBlob = new Blob(['fake audio data'], { type: 'audio/webm' });
    mockMediaRecorder.ondataavailable?.({ data: audioBlob } as BlobEvent);
    mockMediaRecorder.onstop?.({} as Event);

    // Verify error handling
    await waitFor(() => {
      expect(screen.getByText(/error processing/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it('handles offline scenarios', async () => {
    // Mock offline state
    Object.defineProperty(navigator, 'onLine', {
      writable: true,
      value: false,
    });

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>
    );

    // Verify offline indicator
    expect(screen.getByText(/offline/i)).toBeInTheDocument();

    const voiceButton = screen.getByRole('button', { name: /start recording/i });
    await user.click(voiceButton);

    // Verify offline message
    await waitFor(() => {
      expect(screen.getByText(/will be processed when online/i)).toBeInTheDocument();
    }, { timeout: 2000 });
  });
});