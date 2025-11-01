import OpenAI from 'openai';
import { z } from 'zod';
import { XMLBuilder } from 'fast-xml-parser';
import type { AISpecRule, AISpecValidationResult } from './interfaces/ai-spec-rule.js';
import type { ApiConfig } from './interfaces/ailintconfig.js';
import type { DirectoryScanner } from './directory-scanner.js';

export interface AIServiceConfig {
  apiConfig?: ApiConfig;
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

For each rule, you must return a result with:
- result: Either "PASS" if ALL blocks' source code correctly implements their specifications, or "FAIL" if ANY block's source code does not match its specification
- reason: If result is "FAIL", provide a concise explanation (max 3 sentences). If result is "PASS", set reason to null.

Consider the entire rule context when evaluating individual blocks.

You must return a JSON object with results for each rule name specified in the schema.`;
  }

  async validateRules(rules: AISpecRule[], onProgress?: (current: number, total: number) => void): Promise<AISpecValidationResult> {
    const results: AISpecValidationResult = {};

    // First, validate that all blocks in each rule use the same API config
    await this.validateRuleConfigurations(rules);

    // Group rules by their resolved API configuration
    const rulesByConfig = await this.groupRulesByApiConfig(rules);

    let processedRules = 0;
    const totalRules = rules.length;

    // Process each group with its corresponding API config
    for (const [configKey, configRules] of rulesByConfig.entries()) {
      const apiConfig = this.parseConfigKey(configKey);
      
      // Split rules into chunks based on character limit
      const chunks = this.chunkRules(configRules);

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]!;

        const chunkResults = await this.processChunk(chunk, apiConfig);
        Object.assign(results, chunkResults);

        processedRules += chunk.length;
        
        // Report progress if callback provided
        if (onProgress) {
          onProgress(processedRules, totalRules);
        }
      }
    }

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

  /**
   * Creates a JSON Schema dynamically based on the rule names in the chunk
   */
  private createResponseSchema(rules: AISpecRule[]): any {
    const properties: any = {};
    const required: string[] = [];

    for (const rule of rules) {
      properties[rule.name] = {
        type: "object",
        properties: {
          result: {
            type: "string",
            enum: ["PASS", "FAIL"]
          },
          reason: {
            type: ["string", "null"],
            description: "Explanation if result is FAIL, null if PASS"
          }
        },
        required: ["result", "reason"],
        additionalProperties: false
      };
      required.push(rule.name);
    }

    return {
      type: "object",
      properties,
      required,
      additionalProperties: false
    };
  }

  private async validateRuleConfigurations(rules: AISpecRule[]): Promise<void> {
    if (!this.directoryScanner) {
      // If no directory scanner provided, skip validation
      return;
    }

    for (const rule of rules) {
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

    // Create OpenAI client with the provided config
    const openai = new OpenAI({
      apiKey: apiConfig.apiKey,
      baseURL: apiConfig.baseUrl,
    });

    const modelName = apiConfig.modelName;
    const temperatureValue = parseFloat(apiConfig.temperature);
    // Special case: if model name contains "gpt-5", don't include temperature
    const temperature = modelName.includes('gpt-5') ? undefined : temperatureValue;


    // Create dynamic schema based on rules
    const responseSchema = this.createResponseSchema(rules);

    // Create Zod schema for validation
    const ruleResultSchema = z.object({
      result: z.enum(['PASS', 'FAIL']),
      reason: z.string().nullable()
    });
    
    const outputSchemaProperties: Record<string, z.ZodObject<any>> = {};
    for (const rule of rules) {
      outputSchemaProperties[rule.name] = ruleResultSchema;
    }
    
    const outputSchema = z.object(outputSchemaProperties);

    const xmlContent = this.formatRulesToXML(rules);

    const humanPrompt = `Analyze these AISpecRules and return validation results.

${xmlContent}`;


    const completionParams: any = {
      model: modelName,
      messages: [
        { role: 'system', content: this.systemPrompt },
        { role: 'user', content: humanPrompt },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'validation_results',
          strict: true,
          schema: responseSchema
        }
      }
    };

    // Only include temperature if it's defined (not undefined for GPT-5 models)
    if (temperature !== undefined) {
      completionParams.temperature = temperature;
    }


    const completion = await openai.chat.completions.create(completionParams);


    const message = completion.choices[0]?.message;

    if (!message) {
      throw new Error("No message in AI response.");
    }

    // Check for refusal
    if (message.refusal) {
      throw new Error(`AI refused the request: ${message.refusal}`);
    }

    const content = message.content;
    
    if (!content) {
      throw new Error("No content in AI response.");
    }

    let parsedResponse;
    try {
      parsedResponse = JSON.parse(content);
    } catch (error) {
      throw new Error(`Failed to parse AI response as JSON: ${error}`);
    }

    let validationResult;
    try {
      validationResult = outputSchema.parse(parsedResponse) as AISpecValidationResult;
    } catch (error) {
      throw error;
    }

    return validationResult;
  }
}
