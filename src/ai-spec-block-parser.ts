import { readFile } from 'node:fs/promises';
import type { AISpecRule, AISpecBlock } from './interfaces/ai-spec-rule.js';

export class AISpecBlockParser {
  private readonly beginRegex = /AI_SPEC_BEGIN\(([^)]+)\):\s*"([^"]*)"/;
  private readonly endRegex = /AI_SPEC_END\(([^)]+)\)/;

  async parseFile(filePath: string): Promise<AISpecRule[]> {
    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    
    const rules = new Map<string, AISpecRule>();
    let currentRuleNames: string[] | null = null;
    let currentBlock: AISpecBlock | null = null;
    let blockStartLine = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      
      // Check for AI_SPEC_BEGIN
      const beginMatch = line.match(this.beginRegex);
      if (beginMatch) {
        const ruleNamesStr = beginMatch[1]!;
        const specification = beginMatch[2]!;
        // Split rule names by comma and trim whitespace
        currentRuleNames = ruleNamesStr.split(',').map(name => name.trim());
        blockStartLine = i + 1; // +1 for 1-based line numbers
        
        // Initialize rules if they don't exist
        for (const ruleName of currentRuleNames) {
          if (!rules.has(ruleName)) {
            rules.set(ruleName, {
              name: ruleName,
              blocks: []
            });
          }
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
        const ruleNamesStr = endMatch[1]!;
        // Split rule names by comma and trim whitespace
        const endRuleNames = ruleNamesStr.split(',').map(name => name.trim());
        
        if (currentRuleNames && currentBlock && 
            currentRuleNames.length === endRuleNames.length &&
            currentRuleNames.every((name, index) => name === endRuleNames[index])) {
          currentBlock.endLine = i + 1; // +1 for 1-based line numbers
          currentBlock.source = currentBlock.source.trim();
          
          // Add the block to all rules
          for (const ruleName of currentRuleNames) {
            const rule = rules.get(ruleName);
            if (rule) {
              rule.blocks.push(currentBlock);
            }
          }
        }
        
        currentRuleNames = null;
        currentBlock = null;
        continue;
      }
      
      // If we're inside a block, collect the source code
      if (currentBlock && currentRuleNames) {
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
