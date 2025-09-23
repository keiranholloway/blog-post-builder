import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VoiceRecorder from '../../components/VoiceRecorder';

// Performance monitoring utilities
interface PerformanceMetrics {
  startTime: number;
  endTime: number;
  duration: number;
  memoryUsage: number;
  audioQuality: {
    sampleRate: number;
    bitRate: number;
    channels: number;
  };
}

class PerformanceMonitor {
  private metrics: PerformanceMetrics[] = [];
  private startTime: number = 0;
  private initialMemory: number = 0;

  start(): void {
    this.startTime = performance.now();
    this.initialMemory = (performance as any).memory?.usedJSHeapSize || 0;
  }

  end(audioQuality?: any): PerformanceMetrics {
    const endTime = performance.now();
    const currentMemory = (performance as any).memory?.usedJSHeapSize || 0;
    
    const metric: PerformanceMetrics = {
      startTime: this.startTime,
      endTime,
      duration: endTime - this.startTime,
      memoryUsage: currentMemory - this.initialMemory,
      audioQuality: audioQuality || {
        sampleRate: 44100,
        bitRate: 128000,
        channels: 1
      }
    };

    this.metrics.push(metric);
    return metric;
  }

  getAverageMetrics(): Partial<PerformanceMetrics> {
    if (this.metrics.length === 0) return {};

    return {
      duration: this.metrics.reduce((sum, m) => sum + m.duration, 0) / this.metrics.length,
      memoryUsage: this.metrics.reduce((sum, m) => sum + m.memoryUsage, 0) / this.metrics.length,
    };
  }

  reset(): void {
    this.metrics = [];
  }
}

// Mock MediaRecorder with performance tracking
const createMockMediaRecorder = (options: { sampleRate?: number; bitRate?: number } = {}) => {
  const chunks: Blob[] = [];
  
  return {
    start: vi.fn().mockImplementation(() => {
      // Simulate recording start delay
      setTimeout(() => {
        mockMediaRecorder.onstart?.({} as Event);
      }, 10);
    }),
    stop: vi.fn().mockImplementation(() => {
      // Simulate processing delay
      setTimeout(() => {
        const audioBlob = new Blob(chunks, { type: 'audio/webm' });
        mockMediaRecorder.ondataavailable?.({ data: audioBlob } as BlobEvent);
        mockMediaRecorder.onstop?.({} as Event);
      }, 50);
    }),
    pause: vi.fn(),
    resume: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    state: 'inactive',
    stream: {
      getAudioTracks: () => [{
        getSettings: () => ({
          sampleRate: options.sampleRate || 44100,
          channelCount: 1
        })
      }]
    },
    mimeType: 'audio/webm',
    ondataavailable: null,
    onerror: null,
    onpause: null,
    onresume: null,
    onstart: null,
    onstop: null,
  };
};

let mockMediaRecorder: any;

describe('Mobile Voice Recording Performance Tests', () => {
  const performanceMonitor = new PerformanceMonitor();
  const user = userEvent.setup();

  beforeEach(() => {
    mockMediaRecorder = createMockMediaRecorder();
    
    Object.defineProperty(window, 'MediaRecorder', {
      writable: true,
      value: vi.fn().mockImplementation(() => mockMediaRecorder),
    });

    Object.defineProperty(MediaRecorder, 'isTypeSupported', {
      writable: true,
      value: vi.fn().mockReturnValue(true),
    });

    Object.defineProperty(navigator, 'mediaDevices', {
      writable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() }],
        }),
      },
    });

    performanceMonitor.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('measures recording initialization performance', async () => {
    const onRecordingStart = vi.fn();
    
    render(
      <VoiceRecorder
        onRecordingComplete={vi.fn()}
        onRecordingStart={onRecordingStart}
        onError={vi.fn()}
      />
    );

    performanceMonitor.start();
    
    const recordButton = screen.getByRole('button', { name: /start recording/i });
    await user.click(recordButton);

    await waitFor(() => {
      expect(onRecordingStart).toHaveBeenCalled();
    });

    const metrics = performanceMonitor.end();
    
    // Recording should start within 100ms on mobile
    expect(metrics.duration).toBeLessThan(100);
    
    // Memory usage should be minimal for initialization
    expect(metrics.memoryUsage).toBeLessThan(1024 * 1024); // Less than 1MB
  });

  it('measures recording performance under different audio qualities', async () => {
    const audioQualities = [
      { sampleRate: 8000, bitRate: 64000, name: 'Low Quality' },
      { sampleRate: 16000, bitRate: 96000, name: 'Medium Quality' },
      { sampleRate: 44100, bitRate: 128000, name: 'High Quality' },
    ];

    const results: { [key: string]: PerformanceMetrics } = {};

    for (const quality of audioQualities) {
      mockMediaRecorder = createMockMediaRecorder(quality);
      
      const onRecordingComplete = vi.fn();
      
      render(
        <VoiceRecorder
          onRecordingComplete={onRecordingComplete}
          onRecordingStart={vi.fn()}
          onError={vi.fn()}
          audioQuality={quality}
        />
      );

      performanceMonitor.start();
      
      const recordButton = screen.getByRole('button', { name: /start recording/i });
      await user.click(recordButton);

      // Simulate 3-second recording
      await new Promise(resolve => setTimeout(resolve, 3000));

      const stopButton = screen.getByRole('button', { name: /stop recording/i });
      await user.click(stopButton);

      await waitFor(() => {
        expect(onRecordingComplete).toHaveBeenCalled();
      });

      results[quality.name] = performanceMonitor.end(quality);
    }

    // Verify performance scales appropriately with quality
    expect(results['Low Quality'].memoryUsage).toBeLessThan(results['Medium Quality'].memoryUsage);
    expect(results['Medium Quality'].memoryUsage).toBeLessThan(results['High Quality'].memoryUsage);
    
    // All qualities should complete processing within reasonable time
    Object.values(results).forEach(metric => {
      expect(metric.duration).toBeLessThan(5000); // 5 seconds max
    });
  });

  it('measures performance during long recording sessions', async () => {
    const onRecordingComplete = vi.fn();
    
    render(
      <VoiceRecorder
        onRecordingComplete={onRecordingComplete}
        onRecordingStart={vi.fn()}
        onError={vi.fn()}
        maxRecordingTime={180000} // 3 minutes
      />
    );

    performanceMonitor.start();
    
    const recordButton = screen.getByRole('button', { name: /start recording/i });
    await user.click(recordButton);

    // Simulate long recording with memory monitoring
    const memoryCheckpoints: number[] = [];
    
    for (let i = 0; i < 10; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      const currentMemory = (performance as any).memory?.usedJSHeapSize || 0;
      memoryCheckpoints.push(currentMemory);
    }

    const stopButton = screen.getByRole('button', { name: /stop recording/i });
    await user.click(stopButton);

    await waitFor(() => {
      expect(onRecordingComplete).toHaveBeenCalled();
    });

    const metrics = performanceMonitor.end();

    // Memory should not grow excessively during recording
    const memoryGrowth = Math.max(...memoryCheckpoints) - Math.min(...memoryCheckpoints);
    expect(memoryGrowth).toBeLessThan(10 * 1024 * 1024); // Less than 10MB growth

    // Total processing time should be reasonable
    expect(metrics.duration).toBeLessThan(10000); // 10 seconds max
  });

  it('measures performance under simulated mobile constraints', async () => {
    // Simulate mobile device constraints
    const originalRequestIdleCallback = window.requestIdleCallback;
    const originalPerformance = window.performance;

    // Mock slower mobile performance
    Object.defineProperty(window, 'performance', {
      writable: true,
      value: {
        ...originalPerformance,
        now: () => originalPerformance.now() * 1.5, // Simulate slower processing
      },
    });

    // Mock limited idle time
    window.requestIdleCallback = vi.fn().mockImplementation((callback) => {
      setTimeout(() => callback({ timeRemaining: () => 5 }), 100);
    });

    const onRecordingComplete = vi.fn();
    
    render(
      <VoiceRecorder
        onRecordingComplete={onRecordingComplete}
        onRecordingStart={vi.fn()}
        onError={vi.fn()}
      />
    );

    performanceMonitor.start();
    
    const recordButton = screen.getByRole('button', { name: /start recording/i });
    await user.click(recordButton);

    await new Promise(resolve => setTimeout(resolve, 2000));

    const stopButton = screen.getByRole('button', { name: /stop recording/i });
    await user.click(stopButton);

    await waitFor(() => {
      expect(onRecordingComplete).toHaveBeenCalled();
    });

    const metrics = performanceMonitor.end();

    // Should still perform reasonably under mobile constraints
    expect(metrics.duration).toBeLessThan(8000); // 8 seconds max under constraints

    // Restore original functions
    window.requestIdleCallback = originalRequestIdleCallback;
    Object.defineProperty(window, 'performance', {
      writable: true,
      value: originalPerformance,
    });
  });

  it('measures concurrent recording performance', async () => {
    const recorders = Array.from({ length: 3 }, (_, i) => ({
      onRecordingComplete: vi.fn(),
      onRecordingStart: vi.fn(),
      onError: vi.fn(),
    }));

    // Render multiple recorders
    const { rerender } = render(
      <div>
        {recorders.map((recorder, index) => (
          <VoiceRecorder
            key={index}
            onRecordingComplete={recorder.onRecordingComplete}
            onRecordingStart={recorder.onRecordingStart}
            onError={recorder.onError}
          />
        ))}
      </div>
    );

    performanceMonitor.start();

    // Start all recordings simultaneously
    const recordButtons = screen.getAllByRole('button', { name: /start recording/i });
    await Promise.all(recordButtons.map(button => user.click(button)));

    await new Promise(resolve => setTimeout(resolve, 2000));

    // Stop all recordings
    const stopButtons = screen.getAllByRole('button', { name: /stop recording/i });
    await Promise.all(stopButtons.map(button => user.click(button)));

    // Wait for all to complete
    await waitFor(() => {
      recorders.forEach(recorder => {
        expect(recorder.onRecordingComplete).toHaveBeenCalled();
      });
    });

    const metrics = performanceMonitor.end();

    // Concurrent recording should not significantly impact performance
    expect(metrics.duration).toBeLessThan(6000); // 6 seconds max
    expect(metrics.memoryUsage).toBeLessThan(15 * 1024 * 1024); // Less than 15MB
  });

  it('measures audio processing and upload performance', async () => {
    const onRecordingComplete = vi.fn();
    
    // Mock fetch for upload performance testing
    global.fetch = vi.fn().mockImplementation(() => {
      return new Promise(resolve => {
        setTimeout(() => {
          resolve({
            ok: true,
            json: () => Promise.resolve({ success: true }),
          });
        }, 1000); // Simulate 1-second upload
      });
    });

    render(
      <VoiceRecorder
        onRecordingComplete={onRecordingComplete}
        onRecordingStart={vi.fn()}
        onError={vi.fn()}
        autoUpload={true}
      />
    );

    performanceMonitor.start();
    
    const recordButton = screen.getByRole('button', { name: /start recording/i });
    await user.click(recordButton);

    await new Promise(resolve => setTimeout(resolve, 2000));

    const stopButton = screen.getByRole('button', { name: /stop recording/i });
    await user.click(stopButton);

    // Wait for upload completion
    await waitFor(() => {
      expect(onRecordingComplete).toHaveBeenCalled();
    }, { timeout: 5000 });

    const metrics = performanceMonitor.end();

    // Total time should include processing and upload
    expect(metrics.duration).toBeGreaterThan(1000); // At least upload time
    expect(metrics.duration).toBeLessThan(8000); // But not excessive

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/process-audio'),
      expect.objectContaining({
        method: 'POST',
        body: expect.any(FormData),
      })
    );
  });

  it('generates performance report', () => {
    // Run multiple test scenarios and collect metrics
    const testScenarios = [
      'Quick Recording',
      'Long Recording',
      'High Quality',
      'Mobile Constraints',
      'Concurrent Usage'
    ];

    testScenarios.forEach(scenario => {
      performanceMonitor.start();
      // Simulate different performance characteristics
      const delay = Math.random() * 1000 + 500;
      setTimeout(() => {
        performanceMonitor.end({
          sampleRate: 44100,
          bitRate: 128000,
          channels: 1
        });
      }, delay);
    });

    const averageMetrics = performanceMonitor.getAverageMetrics();
    
    // Generate performance report
    const report = {
      timestamp: new Date().toISOString(),
      averageDuration: averageMetrics.duration,
      averageMemoryUsage: averageMetrics.memoryUsage,
      recommendations: [] as string[]
    };

    if (averageMetrics.duration && averageMetrics.duration > 3000) {
      report.recommendations.push('Consider optimizing audio processing pipeline');
    }

    if (averageMetrics.memoryUsage && averageMetrics.memoryUsage > 5 * 1024 * 1024) {
      report.recommendations.push('Memory usage is high, consider implementing cleanup');
    }

    expect(report.timestamp).toBeDefined();
    expect(typeof report.averageDuration).toBe('number');
    expect(Array.isArray(report.recommendations)).toBe(true);
  });
});