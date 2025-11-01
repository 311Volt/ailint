import OpenAI from 'openai';
import { z } from 'zod';
import { XMLBuilder } from 'fast-xml-parser';
import type { AISpecRule, AISpecValidationResult } from './interfaces/ai-spec-rule.js';
import type { ApiConfig } from './interfaces/ailintconfig.js';
import type { ChatCompletionTool } from 'openai/resources.mjs';
import type { DirectoryScanner } from './directory-scanner.js';

export interface AIServiceConfig {
  apiConfig?: ApiConfig;
  baseUrl?: string;
  apiKey?: string;
  modelName?: string;
  temperature?: number;
  maxChunkSize?: number;
  onProgress?: (current: number, total: number) => void;
  directoryScanner?: DirectoryScanner;
}

export class SendRulesToAI {
  private readonly maxChunkSize: number;
  private readonly systemPrompt: string;
  private readonly directoryScanner: DirectoryScanner | undefined;
  private readonly fallbackApiConfig: ApiConfig | undefined;

  constructor(config: AIServiceConfig = {}) {
    this.maxChunkSize = config.maxChunkSize || 150000;
    this.directoryScanner = config.directoryScanner;
    this.fallbackApiConfig = config.apiConfig;

    this.systemPrompt = `You are a code verification assistant. You will receive AISpecRule objects in XML format.

Each AISpecRule contains:
- name: The rule identifier
- blocks: Multiple blocks, each containing:
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
    console.log('[DEBUG] validateRules called with', rules.length, 'rules');
    const results: AISpecValidationResult = {};

    // First, validate that all blocks in each rule use the same API config
    await this.validateRuleConfigurations(rules);

    // Group rules by their resolved API configuration
    const rulesByConfig = await this.groupRulesByApiConfig(rules);
    console.log('[DEBUG] Rules grouped into', rulesByConfig.size, 'config groups');

    let processedRules = 0;
    const totalRules = rules.length;

    // Process each group with its corresponding API config
    for (const [configKey, configRules] of rulesByConfig.entries()) {
      console.log('[DEBUG] Processing config group:', configKey, 'with', configRules.length, 'rules');
      const apiConfig = this.parseConfigKey(configKey);
      
      // Split rules into chunks based on character limit
      const chunks = this.chunkRules(configRules);
      console.log('[DEBUG] Split into', chunks.length, 'chunks');

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]!;
        console.log('[DEBUG] Processing chunk', i + 1, 'of', chunks.length, 'with', chunk.length, 'rules');

        const chunkResults = await this.processChunk(chunk, apiConfig);
        console.log('[DEBUG] Chunk results:', chunkResults);
        Object.assign(results, chunkResults);

        processedRules += chunk.length;
        console.log('[DEBUG] Processed', processedRules, 'of', totalRules, 'rules');
        
        // Report progress if callback provided
        if (onProgress) {
          onProgress(processedRules, totalRules);
        }
      }
    }

    console.log('[DEBUG] Final validation results:', results);
    return results;
  }

  formatRulesToXML(rules: AISpecRule[]): string {
    const xmlData = {
      AISpecRules: {
        Rule: rules.map(rule => ({
          '@_name': rule.name,
          Block: rule.blocks.map(block => ({
            specification: block.specification,
            filePath: block.filePath,
            source: {
              '@_startLine': block.startLine,
              '@_endLine': block.endLine,
              __cdata: `\n${block.source}\n`
            }
          }))
        }))
      }
    };

    const builder = new XMLBuilder({
      ignoreAttributes: false,
      format: true,
      indentBy: '  ',
      suppressEmptyNode: true,
      cdataPropName: '__cdata',
      processEntities: true
    });

    const xmlContent = builder.build(xmlData);
    return `<?xml version="1.0" encoding="UTF-8"?>\n${xmlContent}`;
  }

  private async validateRuleConfigurations(rules: AISpecRule[]): Promise<void> {
    if (!this.directoryScanner) {
      console.log('[DEBUG] No directory scanner provided, skipping configuration validation');
      // If no directory scanner provided, skip validation
      return;
    }

    for (const rule of rules) {
      console.log('[DEBUG] Validating configuration for rule:', rule.name);
      const configs = new Map<string, ApiConfig | null>();
      const blockPaths: string[] = [];

      for (const block of rule.blocks) {
        const config = await this.directoryScanner.resolveApiConfigForFile(block.filePath, rule.name);
        const configKey = this.serializeConfig(config);
        
        if (!configs.has(configKey)) {
          configs.set(configKey, config);
        }
        
        blockPaths.push(block.filePath);
      }

      if (configs.size > 1) {
        const configDetails = Array.from(configs.entries()).map(([key, config]) => {
          if (!config) return 'null (no config)';
          return `{baseUrl: ${config.baseUrl}, modelName: ${config.modelName}}`;
        }).join(' vs ');
        
        throw new Error(
          `Configuration conflict detected for rule "${rule.name}": ` +
          `Blocks within this rule resolve to different API configurations.\n` +
          `This is invalid because a rule must be contained within a single AI API request.\n` +
          `Conflicting configurations: ${configDetails}\n` +
          `Blocks are located in:\n${blockPaths.map(p => `  - ${p}`).join('\n')}\n` +
          `Please ensure all blocks in rule "${rule.name}" use the same API configuration.\n` +
          `Check your ailintconfig.json files and apiConfigRuleOverrides settings.`
        );
      }
    }
  }

  private async groupRulesByApiConfig(rules: AISpecRule[]): Promise<Map<string, AISpecRule[]>> {
    const groups = new Map<string, AISpecRule[]>();

    for (const rule of rules) {
      let config: ApiConfig | null = null;
      
      if (this.directoryScanner && rule.blocks.length > 0) {
        // Use the config from the first block (validation ensures all blocks have same config)
        config = await this.directoryScanner.resolveApiConfigForFile(rule.blocks[0]!.filePath, rule.name);
      }
      
      // Fall back to provided apiConfig if no per-rule config found
      if (!config) {
        config = this.fallbackApiConfig || null;
      }

      const configKey = this.serializeConfig(config);
      
      if (!groups.has(configKey)) {
        groups.set(configKey, []);
      }
      
      groups.get(configKey)!.push(rule);
    }

    return groups;
  }

  private serializeConfig(config: ApiConfig | null): string {
    if (!config) {
      return 'null';
    }
    return JSON.stringify({
      baseUrl: config.baseUrl,
      modelName: config.modelName,
      apiKey: config.apiKey,
      temperature: config.temperature,
    });
  }

  private parseConfigKey(configKey: string): ApiConfig {
    if (configKey === 'null') {
      // Return fallback or throw error
      if (this.fallbackApiConfig) {
        return this.fallbackApiConfig;
      }
      throw new Error('No API configuration available');
    }
    return JSON.parse(configKey) as ApiConfig;
  }

  private chunkRules(rules: AISpecRule[]): AISpecRule[][] {
    const chunks: AISpecRule[][] = [];
    let currentChunk: AISpecRule[] = [];
    let currentSize = 0;

    for (const rule of rules) {
      const ruleSize = this.formatRulesToXML([rule]).length;

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

  private async processChunk(rules: AISpecRule[], apiConfig: ApiConfig): Promise<AISpecValidationResult> {
    console.log('[DEBUG] Starting processChunk with rules:', rules.map(r => r.name));
    console.log('[DEBUG] API config:', {
      baseUrl: apiConfig.baseUrl,
      modelName: apiConfig.modelName,
      temperature: apiConfig.temperature,
      hasApiKey: !!apiConfig.apiKey
    });

    // Create OpenAI client with the provided config
    const openai = new OpenAI({
      apiKey: apiConfig.apiKey,
      baseURL: apiConfig.baseUrl,
    });

    const modelName = apiConfig.modelName;
    const temperatureValue = parseFloat(apiConfig.temperature);
    // Special case: if model name contains "gpt-5", don't include temperature
    const temperature = modelName.includes('gpt-5') ? undefined : temperatureValue;

    console.log('[DEBUG] Model name:', modelName);
    console.log('[DEBUG] Temperature:', temperature);

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

    const xmlContent = this.formatRulesToXML(rules);
    console.log('[DEBUG] Generated XML content length:', xmlContent.length);
    console.log('[DEBUG] XML content preview:', xmlContent.substring(0, 500) + '...');

    const humanPrompt = `Analyze these AISpecRules and return validation results using the 'return_validation_results' tool.

${xmlContent}`;

    console.log('[DEBUG] Human prompt length:', humanPrompt.length);

    const completionParams: any = {
      model: modelName,
      messages: [
        { role: 'system', content: this.systemPrompt },
        { role: 'user', content: humanPrompt },
      ],
      tools: [toolSchema],
      tool_choice: {
        type: 'function',
        function: { name: 'return_validation_results' },
      },
    };

    // Only include temperature if it's defined (not undefined for GPT-5 models)
    if (temperature !== undefined) {
      completionParams.temperature = temperature;
    }

    console.log('[DEBUG] Completion params:', JSON.stringify(completionParams, null, 2));

    console.log('[DEBUG] Calling OpenAI API...');
    const completion = await openai.chat.completions.create(completionParams);
    console.log('[DEBUG] Received completion response');

    console.log('[DEBUG] Completion choices length:', completion.choices.length);
    console.log('[DEBUG] First choice:', {
      finishReason: completion.choices[0]?.finish_reason,
      message: completion.choices[0]?.message ? {
        role: completion.choices[0].message.role,
        content: completion.choices[0].message.content,
        toolCalls: completion.choices[0].message.tool_calls?.map(tc => ({
          id: tc.id,
          type: tc.type,
          functionName: tc.function.name,
          functionArgs: tc.function.arguments
        }))
      } : null
    });

    const toolCall = completion.choices[0]?.message?.tool_calls?.[0];

    if (!toolCall) {
      console.log('[DEBUG] No tool call found in completion');
      throw new Error("No tool call found or unexpected tool called from AI.");
    }

    console.log('[DEBUG] Tool call details:', {
      id: toolCall.id,
      type: toolCall.type,
      functionName: toolCall.function.name,
      functionArgs: toolCall.function.arguments
    });

    if (toolCall.function.name !== 'return_validation_results') {
      console.log('[DEBUG] Unexpected tool function name:', toolCall.function.name);
      throw new Error("No tool call found or unexpected tool called from AI.");
    }

    const rawResponse = toolCall.function.arguments;
    console.log('[DEBUG] Raw response from AI:', rawResponse);
    
    if (!rawResponse) {
      console.log('[DEBUG] No response content from AI');
      throw new Error("No response content from AI.");
    }

    let parsedResponse;
    try {
      parsedResponse = JSON.parse(rawResponse);
      console.log('[DEBUG] Parsed JSON response:', JSON.stringify(parsedResponse, null, 2));
    } catch (error) {
      console.log('[DEBUG] Failed to parse JSON response:', error);
      throw new Error(`Failed to parse AI response as JSON: ${error}`);
    }

    console.log('[DEBUG] Results object from parsed response:', parsedResponse.results);
    console.log('[DEBUG] Results object type:', typeof parsedResponse.results);
    console.log('[DEBUG] Results object keys:', parsedResponse.results ? Object.keys(parsedResponse.results) : 'undefined');

    let validationResult;
    try {
      validationResult = outputSchema.parse(parsedResponse.results) as AISpecValidationResult;
      console.log('[DEBUG] Schema validation successful:', validationResult);
    } catch (error) {
      console.log('[DEBUG] Schema validation failed:', error);
      console.log('[DEBUG] Error details:', JSON.stringify(error, null, 2));
      throw error;
    }

    return validationResult;
  }
}
