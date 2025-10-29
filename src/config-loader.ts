import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AilintConfig } from './interfaces/ailintconfig.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class ConfigLoader {
  private configCache = new Map<string, AilintConfig>();
  private baseConfigPath: string;

  constructor(baseConfigPath?: string) {
    this.baseConfigPath = baseConfigPath || join(__dirname, '..', 'static', 'ailintconfig.base.json');
  }

  async loadConfig(configPath: string): Promise<AilintConfig> {
    // Check cache first
    if (this.configCache.has(configPath)) {
      return this.configCache.get(configPath)!;
    }

    try {
      const content = await readFile(configPath, 'utf-8');
      const config = JSON.parse(content) as AilintConfig;
      
      // Validate baseConfig
      if (config.baseConfig !== 'empty' && config.baseConfig !== 'default') {
        throw new Error(`Invalid baseConfig value: ${config.baseConfig}. Must be 'empty' or 'default'.`);
      }

      const mergedConfig = await this.mergeWithBase(config);
      this.configCache.set(configPath, mergedConfig);
      return mergedConfig;
    } catch (error) {
      throw new Error(`Failed to load config from ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async loadBaseConfig(): Promise<AilintConfig> {
    try {
      const content = await readFile(this.baseConfigPath, 'utf-8');
      return JSON.parse(content) as AilintConfig;
    } catch (error) {
      throw new Error(`Failed to load base config from ${this.baseConfigPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async mergeWithBase(config: AilintConfig): Promise<AilintConfig> {
    if (config.baseConfig === 'empty') {
      // Return config as-is, with empty arrays for undefined fields
      return {
        baseConfig: 'empty',
        includeExtensions: config.includeExtensions || [],
        includeMimeTypes: config.includeMimeTypes || [],
        ignore: config.ignore || [],
        useGitIgnore: config.useGitIgnore,
      };
    }

    // Load base config and merge
    const baseConfig = await this.loadBaseConfig();
    
    return {
      baseConfig: 'default',
      includeExtensions: [
        ...(baseConfig.includeExtensions || []),
        ...(config.includeExtensions || []),
      ],
      includeMimeTypes: [
        ...(baseConfig.includeMimeTypes || []),
        ...(config.includeMimeTypes || []),
      ],
      ignore: [
        ...(baseConfig.ignore || []),
        ...(config.ignore || []),
      ],
      useGitIgnore: config.useGitIgnore ?? baseConfig.useGitIgnore,
    };
  }

  clearCache(): void {
    this.configCache.clear();
  }
}
