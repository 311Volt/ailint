import OpenAI from 'openai';
import { z } from 'zod';
import type { AISpecRule, AISpecValidationResult } from './interfaces/ai-spec-rule.js';
import type { ChatCompletionTool } from 'openai/resources.mjs';

export interface AIServiceConfig {
  baseUrl?: string;
  apiKey?: string;
  modelName?: string;
  temperature?: number;
  maxChunkSize?: number;
  onProgress?: (current: number, total: number) => void;
}

export class SendRulesToAI {
  private readonly openai: OpenAI;
  private readonly modelName: string;
  private readonly temperature: number;
  private readonly maxChunkSize: number;
  private readonly systemPrompt: string;

  constructor(config: AIServiceConfig = {}) {
    this.maxChunkSize = config.maxChunkSize || 150000;
    this.modelName = config.modelName || process.env.AI_MODEL_NAME || 'gemini-2.5-flash-lite';
    this.temperature = config.temperature || parseFloat(process.env.AI_TEMPERATURE || '0.1');

    this.openai = new OpenAI({
      apiKey: config.apiKey || process.env.AI_API_KEY,
      baseURL: config.baseUrl || process.env.AI_BASE_URL,
    });

    this.systemPrompt = `You are a code verification assistant. You will receive AISpecRule objects in JSON format.
 
 Each AISpecRule contains:
 - name: The rule identifier
 - blocks: An array of blocks, each containing:
   - specification: What the code should do
   - source: The actual source code
   - filePath: Where the code is located
   - startLine/endLine: Line numbers
 
 Your task is to check whether the source code in each block matches its specification, in the context of the entire rule.
 
 For each rule:
 - If ALL blocks' source code correctly implements their specifications, return "PASS"
 - If ANY block's source code does not match its specification, return "FAIL" with a concise reason (max 3 sentences)
 
 Consider the entire rule context when evaluating individual blocks.
 
 You MUST use the 'return_validation_results' tool to respond with the validation results.`;
  }

  async validateRules(rules: AISpecRule[], onProgress?: (current: number, total: number) => void): Promise<AISpecValidationResult> {
    const results: AISpecValidationResult = {};
    
    // Split rules into chunks based on character limit
    const chunks = this.chunkRules(rules);
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      
      // Report progress if callback provided
      if (onProgress) {
        onProgress(i + 1, chunks.length);
      }
      
      const chunkResults = await this.processChunk(chunk);
      Object.assign(results, chunkResults);
    }
    
    return results;
  }

  private chunkRules(rules: AISpecRule[]): AISpecRule[][] {
    const chunks: AISpecRule[][] = [];
    let currentChunk: AISpecRule[] = [];
    let currentSize = 0;

    for (const rule of rules) {
      const ruleSize = JSON.stringify(rule).length;
      
      if (currentSize + ruleSize > this.maxChunkSize && currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentSize = 0;
      }
      
      currentChunk.push(rule);
      currentSize += ruleSize;
    }
    
    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }
    
    return chunks;
  }

  private async processChunk(rules: AISpecRule[]): Promise<AISpecValidationResult> {
    const outputSchema = z.record(z.string(), z.object({
      result: z.enum(['PASS', 'FAIL']),
      reason: z.string().optional()
    }));

    const toolSchema: ChatCompletionTool = {
      type: 'function',
      function: {
        name: 'return_validation_results',
        description: 'Returns the validation results for the given AISpecRules.',
        parameters: {
          type: 'object',
          properties: {
            results: {
              type: 'object',
              description: 'An object where keys are rule names and values are objects with "result" (either "PASS" or "FAIL") and an optional "reason" string.',
              additionalProperties: {
                type: 'object',
                properties: {
                  result: {
                    type: 'string',
                    enum: ['PASS', 'FAIL'],
                  },
                  reason: {
                    type: 'string',
                  },
                },
                required: ['result'],
              },
            },
          },
          required: ['results'],
        },
      },
    };

    const humanPrompt = `Analyze these AISpecRules and return validation results using the 'return_validation_results' tool.
 
 {rules}`;

    const completion = await this.openai.chat.completions.create({
      model: this.modelName,
      temperature: this.temperature,
      messages: [
        { role: 'system', content: this.systemPrompt },
        { role: 'user', content: humanPrompt.replace('{rules}', JSON.stringify(rules, null, 2)) },
      ],
      tools: [toolSchema],
      tool_choice: {
        type: 'function',
        function: { name: 'return_validation_results' },
      },
    });

    const toolCall = completion.choices[0]?.message?.tool_calls?.[0];

    if (!toolCall || toolCall.function.name !== 'return_validation_results') {
      throw new Error("No tool call found or unexpected tool called from AI.");
    }

    const rawResponse = toolCall.function.arguments;
    if (!rawResponse) {
      throw new Error("No response content from AI.");
    }
    
    return outputSchema.parse(JSON.parse(rawResponse).results) as AISpecValidationResult;
  }
}
