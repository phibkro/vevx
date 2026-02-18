import { correctnessAgent } from '../correctness'
import { securityAgent } from '../security'
import { performanceAgent } from '../performance'
import { maintainabilityAgent } from '../maintainability'
import { edgeCasesAgent } from '../edge-cases'
import { accessibilityAgent } from '../accessibility'
import { documentationAgent } from '../documentation'
import { agents } from '../index'
import type { FileContent } from '../types'

describe('Agent Response Parsing', () => {
  const validResponse = (agentName: string, score: number) => JSON.stringify({
    score,
    summary: `Test summary for ${agentName}`,
    findings: [
      {
        severity: 'critical',
        title: 'Test finding',
        description: 'Test description',
        file: 'test.ts',
        line: 42,
        suggestion: 'Fix it'
      }
    ]
  })

  describe('Correctness Agent', () => {
    it('parses valid JSON response', () => {
      const response = validResponse('correctness', 8.5)
      const result = correctnessAgent.parseResponse(response)

      expect(result.agent).toBe('correctness')
      expect(result.score).toBe(8.5)
      expect(result.summary).toContain('correctness')
      expect(result.findings).toHaveLength(1)
      expect(result.findings[0].severity).toBe('critical')
      expect(result.findings[0].title).toBe('Test finding')
    })

    it('handles malformed JSON with fallback', () => {
      const response = 'This is not valid JSON at all'
      const result = correctnessAgent.parseResponse(response)

      expect(result.agent).toBe('correctness')
      expect(result.score).toBe(5.0) // Neutral fallback score
      expect(result.findings).toHaveLength(1)
      expect(result.findings[0].severity).toBe('warning')
      expect(result.summary).toContain('invalid')
    })

    it('handles JSON without curly braces', () => {
      const response = 'Some text before'
      const result = correctnessAgent.parseResponse(response)

      expect(result.score).toBe(5.0)
      expect(result.findings[0].title).toContain('parsing failed')
    })

    it('validates score range (too high)', () => {
      const response = JSON.stringify({
        score: 15, // Invalid: > 10
        summary: 'Test',
        findings: []
      })
      const result = correctnessAgent.parseResponse(response)

      // Should fallback because score validation fails
      expect(result.score).toBe(5.0)
    })

    it('validates score range (negative)', () => {
      const response = JSON.stringify({
        score: -5, // Invalid: < 0
        summary: 'Test',
        findings: []
      })
      const result = correctnessAgent.parseResponse(response)

      expect(result.score).toBe(5.0)
    })

    it('handles missing summary field', () => {
      const response = JSON.stringify({
        score: 7,
        findings: []
        // Missing summary
      })
      const result = correctnessAgent.parseResponse(response)

      // Should fallback
      expect(result.score).toBe(5.0)
    })

    it('handles missing findings array', () => {
      const response = JSON.stringify({
        score: 7,
        summary: 'Test'
        // Missing findings
      })
      const result = correctnessAgent.parseResponse(response)

      expect(result.score).toBe(5.0)
    })

    it('handles findings with missing fields', () => {
      const response = JSON.stringify({
        score: 8,
        summary: 'Test',
        findings: [
          {
            // Missing most fields
            title: 'Partial finding'
          }
        ]
      })
      const result = correctnessAgent.parseResponse(response)

      expect(result.score).toBe(8)
      expect(result.findings[0].title).toBe('Partial finding')
      expect(result.findings[0].severity).toBe('info') // Default
      expect(result.findings[0].file).toBe('unknown') // Default
    })

    it('extracts JSON embedded in markdown', () => {
      const response = `Here's my analysis:

\`\`\`json
${validResponse('correctness', 9.0)}
\`\`\`

Hope this helps!`

      const result = correctnessAgent.parseResponse(response)
      expect(result.score).toBe(9.0)
    })
  })

  describe('Security Agent', () => {
    it('parses valid JSON response', () => {
      const response = validResponse('security', 6.5)
      const result = securityAgent.parseResponse(response)

      expect(result.agent).toBe('security')
      expect(result.score).toBe(6.5)
    })

    it('handles malformed JSON with fallback', () => {
      const result = securityAgent.parseResponse('invalid')

      expect(result.agent).toBe('security')
      expect(result.score).toBe(5.0)
      expect(result.findings.length).toBeGreaterThan(0)
    })
  })

  describe('Performance Agent', () => {
    it('parses valid JSON response', () => {
      const response = validResponse('performance', 7.5)
      const result = performanceAgent.parseResponse(response)

      expect(result.agent).toBe('performance')
      expect(result.score).toBe(7.5)
    })

    it('handles malformed JSON with fallback', () => {
      const result = performanceAgent.parseResponse('invalid')

      expect(result.agent).toBe('performance')
      expect(result.score).toBe(5.0)
    })
  })

  describe('Maintainability Agent', () => {
    it('parses valid JSON response', () => {
      const response = validResponse('maintainability', 8.0)
      const result = maintainabilityAgent.parseResponse(response)

      expect(result.agent).toBe('maintainability')
      expect(result.score).toBe(8.0)
    })

    it('handles malformed JSON with fallback', () => {
      const result = maintainabilityAgent.parseResponse('invalid')

      expect(result.agent).toBe('maintainability')
      expect(result.score).toBe(5.0)
    })
  })

  describe('Edge Cases Agent', () => {
    it('parses valid JSON response', () => {
      const response = validResponse('edge-cases', 6.0)
      const result = edgeCasesAgent.parseResponse(response)

      expect(result.agent).toBe('edge-cases')
      expect(result.score).toBe(6.0)
    })

    it('handles malformed JSON with fallback', () => {
      const result = edgeCasesAgent.parseResponse('invalid')

      expect(result.agent).toBe('edge-cases')
      expect(result.score).toBe(5.0)
    })
  })

  describe('Accessibility Agent', () => {
    it('parses valid JSON response', () => {
      const response = validResponse('accessibility', 7.5)
      const result = accessibilityAgent.parseResponse(response)

      expect(result.agent).toBe('accessibility')
      expect(result.score).toBe(7.5)
    })

    it('handles malformed JSON with fallback', () => {
      const result = accessibilityAgent.parseResponse('invalid')

      expect(result.agent).toBe('accessibility')
      expect(result.score).toBe(5.0)
    })
  })

  describe('Documentation Agent', () => {
    it('parses valid JSON response', () => {
      const response = validResponse('documentation', 8.0)
      const result = documentationAgent.parseResponse(response)

      expect(result.agent).toBe('documentation')
      expect(result.score).toBe(8.0)
    })

    it('handles malformed JSON with fallback', () => {
      const result = documentationAgent.parseResponse('invalid')

      expect(result.agent).toBe('documentation')
      expect(result.score).toBe(5.0)
    })
  })

  describe('Weight Validation', () => {
    it('all agent weights sum to 1.0', () => {
      const totalWeight = agents.reduce((sum, agent) => sum + agent.weight, 0)
      expect(totalWeight).toBeCloseTo(1.0, 4)
    })

    it('all agents have positive weights', () => {
      agents.forEach(agent => {
        expect(agent.weight).toBeGreaterThan(0)
        expect(agent.weight).toBeLessThanOrEqual(1.0)
      })
    })

    it('has exactly 7 agents', () => {
      expect(agents).toHaveLength(7)
    })

    it('all agents have unique names', () => {
      const names = agents.map(a => a.name)
      const uniqueNames = new Set(names)
      expect(uniqueNames.size).toBe(agents.length)
    })
  })

  describe('User Prompt Generation', () => {
    const mockFiles: FileContent[] = [
      {
        path: '/test/file.ts',
        relativePath: 'file.ts',
        content: 'const x = 1;\nconst y = 2;',
        language: 'typescript'
      }
    ]

    it('correctness agent generates prompt', () => {
      const prompt = correctnessAgent.userPromptTemplate(mockFiles)
      expect(prompt).toContain('file.ts')
      expect(prompt).toContain('typescript')
      expect(prompt).toContain('const x = 1')
    })

    it('security agent generates prompt', () => {
      const prompt = securityAgent.userPromptTemplate(mockFiles)
      expect(prompt).toContain('file.ts')
      expect(prompt).toContain('security')
    })

    it('includes line numbers in prompts', () => {
      const prompt = correctnessAgent.userPromptTemplate(mockFiles)
      expect(prompt).toMatch(/1→/)
      expect(prompt).toMatch(/2→/)
    })

    it('handles multiple files', () => {
      const multiFiles: FileContent[] = [
        {
          path: '/test/file1.ts',
          relativePath: 'file1.ts',
          content: 'code1',
          language: 'typescript'
        },
        {
          path: '/test/file2.ts',
          relativePath: 'file2.ts',
          content: 'code2',
          language: 'typescript'
        }
      ]

      const prompt = correctnessAgent.userPromptTemplate(multiFiles)
      expect(prompt).toContain('file1.ts')
      expect(prompt).toContain('file2.ts')
      expect(prompt).toContain('---') // File separator
    })
  })

  describe('AgentResult Structure', () => {
    it('all agents return correct structure', () => {
      const response = validResponse('test', 7.5)

      agents.forEach(agent => {
        const result = agent.parseResponse(response)

        expect(result).toHaveProperty('agent')
        expect(result).toHaveProperty('score')
        expect(result).toHaveProperty('findings')
        expect(result).toHaveProperty('summary')
        expect(result).toHaveProperty('durationMs')

        expect(typeof result.agent).toBe('string')
        expect(typeof result.score).toBe('number')
        expect(Array.isArray(result.findings)).toBe(true)
        expect(typeof result.summary).toBe('string')
        expect(typeof result.durationMs).toBe('number')
      })
    })
  })
})
