import { describe, it, expect } from 'vitest';
import {
  buildJevPrompt,
  parseDecisionResponse
} from '../src/server/decisionModel';

describe('Jev-Style Decision Model Module', () => {
  describe('buildJevPrompt', () => {
    it('generates prompt adhering to Jev specification', () => {
      const state = 'Shares of the chipmaker jumped 8% after it raised revenue forecast.';
      const question = 'Which news section does this article belong to?';
      const options = ['World', 'Sports', 'Business', 'Science/Technology'];

      const prompt = buildJevPrompt(state, question, options);
      expect(prompt).toContain('You are a decision function. Read the state, then answer the question by choosing exactly one option.');
      expect(prompt).toContain('[State]\nShares of the chipmaker jumped 8% after it raised revenue forecast.');
      expect(prompt).toContain('[Question]\nWhich news section does this article belong to?');
      expect(prompt).toContain('[Options]\nA. World\nB. Sports\nC. Business\nD. Science/Technology');
      expect(prompt.endsWith('Answer:')).toBe(true);
    });

    it('throws error for empty options', () => {
      expect(() => buildJevPrompt('state', 'question', [])).toThrow();
    });

    it('throws error when options exceed 26', () => {
      const tooMany = Array.from({ length: 27 }, (_, i) => `Option ${i}`);
      expect(() => buildJevPrompt('state', 'question', tooMany)).toThrow();
    });
  });

  describe('parseDecisionResponse', () => {
    it('renormalizes logprobs into calibrated probabilities', () => {
      const options = ['World', 'Sports', 'Business', 'Science/Technology'];
      const mockResponse = {
        choices: [
          {
            message: { content: ' C' },
            logprobs: {
              content: [
                {
                  token: ' C',
                  top_logprobs: [
                    { token: ' C', logprob: Math.log(0.68) },
                    { token: ' D', logprob: Math.log(0.31) },
                    { token: ' A', logprob: Math.log(0.005) },
                    { token: ' B', logprob: Math.log(0.002) }
                  ]
                }
              ]
            }
          }
        ]
      };

      const result = parseDecisionResponse(mockResponse, options);
      expect(result.calibrated).toBe(true);
      expect(result.chosen.letter).toBe('C');
      expect(result.chosen.option).toBe('Business');
      expect(result.confidence).toBeGreaterThan(0.65);
      expect(result.confidence).toBeLessThan(0.70);
      expect(result.decisions[0].option).toBe('Business');
      expect(result.decisions[1].option).toBe('Science/Technology');
    });

    it('handles fallback single token without logprobs gracefully', () => {
      const options = ['Option 1', 'Option 2', 'Option 3'];
      const mockResponse = {
        choices: [
          {
            message: { content: 'B' }
          }
        ]
      };

      const result = parseDecisionResponse(mockResponse, options);
      expect(result.calibrated).toBe(false);
      expect(result.chosen.letter).toBe('B');
      expect(result.chosen.option).toBe('Option 2');
      expect(result.confidence).toBe(1.0);
    });

    it('throws error if choices are empty', () => {
      expect(() => parseDecisionResponse({ choices: [] }, ['A', 'B'])).toThrow();
    });
  });

  describe('Configurable Content Types & Taxonomy (C3)', () => {
    it('accepts configurable taxonomies and differentiates distinct genres (Poem vs Screenplay)', () => {
      const configurableCategories = [
        "Project",
        "Essay/Knowledge",
        "Dialogue/Transcript",
        "Poem",
        "Screenplay/Script",
        "Idea",
        "Journal/Diary",
        "Technical/Code"
      ];

      expect(configurableCategories).toHaveLength(8);
      expect(configurableCategories).toContain('Poem');
      expect(configurableCategories).toContain('Screenplay/Script');
      expect(configurableCategories).toContain('Idea');

      const poemPrompt = buildJevPrompt('Вечерний звон, как много дум наводит он...', 'Какая это категория?', configurableCategories);
      const scriptPrompt = buildJevPrompt('ИНТ. БУНКЕР - НОЧЬ\nСвет тускло мигает.', 'Какая это категория?', configurableCategories);

      expect(poemPrompt).toContain('D. Poem');
      expect(scriptPrompt).toContain('E. Screenplay/Script');
    });
  });
});
