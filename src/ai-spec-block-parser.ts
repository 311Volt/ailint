import { readFile } from 'node:fs/promises';
import type { AISpecRule, AISpecBlock } from './interfaces/ai-spec-rule.js';

export class AISpecBlockParser {
  private readonly beginRegex = /AI_SPEC_BEGIN\(([^)]+)\):\s*"([^"]*)"/;
  private readonly endRegex = /AI_SPEC_END\(([^)]+)\)/;

  async parseFile(filePath: string): Promise<AISpecRule[]> {
    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    
    const rules = new Map<string, AISpecRule>();
    let currentRule: string | null = null;
    let currentBlock: AISpecBlock | null = null;
    let blockStartLine = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      
      // Check for AI_SPEC_BEGIN
      const beginMatch = line.match(this.beginRegex);
      if (beginMatch) {
        const ruleName = beginMatch[1]!;
        const specification = beginMatch[2]!;
        currentRule = ruleName;
        blockStartLine = i + 1; // +1 for 1-based line numbers
        
        if (!rules.has(ruleName)) {
          rules.set(ruleName, {
            name: ruleName,
            blocks: []
          });
        }
        
        currentBlock = {
          specification: specification.trim(),
          source: '',
          filePath,
          startLine: blockStartLine,
          endLine: 0
        };
        
        continue;
      }
      
      // Check for AI_SPEC_END
      const endMatch = line.match(this.endRegex);
      if (endMatch) {
        const ruleName = endMatch[1]!;
        
        if (currentRule === ruleName && currentBlock) {
          currentBlock.endLine = i + 1; // +1 for 1-based line numbers
          currentBlock.source = currentBlock.source.trim();
          
          const rule = rules.get(ruleName);
          if (rule) {
            rule.blocks.push(currentBlock);
          }
        }
        
        currentRule = null;
        currentBlock = null;
        continue;
      }
      
      // If we're inside a block, collect the source code
      if (currentBlock && currentRule) {
        currentBlock.source += line + '\n';
      }
    }
    
    // Filter out rules with no blocks (incomplete/invalid)
    return Array.from(rules.values()).filter(rule => rule.blocks.length > 0);
  }

  async parseFiles(filePaths: string[]): Promise<AISpecRule[]> {
    const allRules: AISpecRule[] = [];
    const rulesMap = new Map<string, AISpecRule>();
    
    for (const filePath of filePaths) {
      try {
        const fileRules = await this.parseFile(filePath);
        
        for (const rule of fileRules) {
          if (rulesMap.has(rule.name)) {
            // Merge blocks from the same rule
            const existingRule = rulesMap.get(rule.name)!;
            existingRule.blocks.push(...rule.blocks);
          } else {
            rulesMap.set(rule.name, rule);
          }
        }
      } catch (error) {
        console.warn(`Warning: Could not parse file ${filePath}: ${error}`);
      }
    }
    
    return Array.from(rulesMap.values());
  }
}
