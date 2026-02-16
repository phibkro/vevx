import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createProgressReporter } from '../progress'

describe('Progress Reporter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows startup message when started', () => {
    const consoleSpy = vi.spyOn(console, 'log')
    const reporter = createProgressReporter()

    reporter.onProgress({ type: 'started', agentCount: 5 })

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('5')
    )
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('agents')
    )
  })

  it('shows spinner while agent is running', () => {
    const reporter = createProgressReporter()
    reporter.onProgress({ type: 'agent-started', agent: 'correctness' })

    // Verify spinner was started (ora creates a spinner instance)
    expect(reporter.isSpinning).toBe(true)
  })

  it('shows completion for each agent with score and duration', () => {
    const consoleSpy = vi.spyOn(console, 'log')
    const reporter = createProgressReporter()

    // Start then complete
    reporter.onProgress({ type: 'agent-started', agent: 'correctness' })
    reporter.onProgress({
      type: 'agent-completed',
      agent: 'correctness',
      score: 8.5,
      duration: 2.3
    })

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('✓')
    )
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('correctness')
    )
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('8.5')
    )
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('2.3')
    )
  })

  it('stops spinner when agent completes', () => {
    const reporter = createProgressReporter()

    reporter.onProgress({ type: 'agent-started', agent: 'security' })
    expect(reporter.isSpinning).toBe(true)

    reporter.onProgress({
      type: 'agent-completed',
      agent: 'security',
      score: 7.0,
      duration: 1.8
    })

    expect(reporter.isSpinning).toBe(false)
  })

  it('shows total duration when all agents complete', () => {
    const consoleSpy = vi.spyOn(console, 'log')
    const reporter = createProgressReporter()

    reporter.onProgress({ type: 'completed', totalDuration: 5.2 })

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('5.2')
    )
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Completed')
    )
  })

  it('tracks which agents have completed', () => {
    const reporter = createProgressReporter()

    reporter.onProgress({ type: 'agent-completed', agent: 'correctness', score: 8.0, duration: 2.0 })
    reporter.onProgress({ type: 'agent-completed', agent: 'security', score: 7.5, duration: 1.9 })

    const completed = reporter.getCompleted()
    expect(completed).toContain('correctness')
    expect(completed).toContain('security')
    expect(completed).toHaveLength(2)
  })
})
