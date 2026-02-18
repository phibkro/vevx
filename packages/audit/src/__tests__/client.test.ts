import { describe, it, expect } from 'vitest'
import { ValidationError } from '../errors'

/**
 * Unit tests for error transformation logic.
 * The client uses Claude Code CLI (no API key needed).
 * Full integration tests require a running Claude Code session.
 */

describe('Client Error Validation', () => {
  describe('ValidationError construction', () => {
    it('stores field name and message', () => {
      const error = new ValidationError('model', 'Model name is required')

      expect(error.field).toBe('model')
      expect(error.message).toContain('model')
      expect(error.message).toContain('Model name is required')
    })
  })

  describe('Model validation', () => {
    it('validates model parameter', () => {
      const error = new ValidationError('model', 'Model name is required')

      expect(error.field).toBe('model')
      expect(error.message).toContain('model')
    })
  })
})
