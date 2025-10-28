import type { AISpecBlock } from './ai-spec-block.js';

export type { AISpecBlock };

export interface AISpecRule {
  name: string;
  blocks: AISpecBlock[];
}

export interface AISpecValidationResult {
  [ruleName: string]: {
    result: 'PASS' | 'FAIL';
    reason?: string;
  };
}
