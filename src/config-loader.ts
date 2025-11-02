import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expand } from 'dotenv-expand';
import { config } from 'dotenv';
import type { AilintConfig, ApiConfig } from './interfaces/ailintconfig.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class ConfigLoader {
  private configCache = new Map<string, AilintConfig>();
  private directoryConfigCache = new Map<string, { config: AilintConfig; filePath: string } | null>();
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
      
      // Default to 'parent' if baseConfig is not specified
      if (!config.baseConfig) {
        config.baseConfig = 'parent';
      }

      // Validate baseConfig
      if (config.baseConfig !== 'empty' && config.baseConfig !== 'default' && config.baseConfig !== 'parent') {
        throw new Error(`Invalid baseConfig value: ${config.baseConfig}. Must be 'empty', 'default', or 'parent'.`);
      }

      // Validate apiConfigRuleOverrides patterns
      if (config.apiConfigRuleOverrides) {
        this.validateRulePatterns(config.apiConfigRuleOverrides, configPath);
      }

      const mergedConfig = await this.mergeWithBase(config, dirname(configPath));
      this.configCache.set(configPath, mergedConfig);
      return mergedConfig;
    } catch (error) {
      throw new Error(`Failed to load config from ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private validateRulePatterns(overrides: { [rulePattern: string]: Partial<ApiConfig> }, configPath: string): void {
    const patterns = Object.keys(overrides);
    const seen = new Set<string>();

    for (const pattern of patterns) {
      // Check for duplicates
      if (seen.has(pattern)) {
        throw new Error(
          `Duplicate rule pattern "${pattern}" found in apiConfigRuleOverrides in ${configPath}`
        );
      }
      seen.add(pattern);

      // Validate pattern format
      if (!this.isValidRulePattern(pattern)) {
        throw new Error(
          `Invalid rule pattern "${pattern}" in ${configPath}. ` +
          `Pattern must be either an exact rule name or a prefix followed by a single asterisk (e.g., "prefix_*"). ` +
          `Patterns like "prefix_*_suffix" are not allowed.`
        );
      }
    }
  }

  private isValidRulePattern(pattern: string): boolean {
    // Pattern is valid if:
    // 1. It contains no asterisks (exact match)
    // 2. It ends with a single asterisk and has a prefix (prefix_*)
    
    const asteriskCount = (pattern.match(/\*/g) || []).length;
    
    if (asteriskCount === 0) {
      // Exact match pattern - valid
      return true;
    }
    
    if (asteriskCount === 1 && pattern.endsWith('*') && pattern.length > 1) {
      // Prefix pattern - valid
      return true;
    }
    
    // Any other pattern is invalid
    return false;
  }

  async loadBaseConfig(): Promise<AilintConfig> {
    try {
      const content = await readFile(this.baseConfigPath, 'utf-8');
      return JSON.parse(content) as AilintConfig;
    } catch (error) {
      throw new Error(`Failed to load base config from ${this.baseConfigPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async mergeWithBase(config: AilintConfig, configDir: string): Promise<AilintConfig> {
    if (config.baseConfig === 'empty') {
      // Return config as-is, with empty arrays for undefined fields
      return {
        baseConfig: 'empty',
        includeExtensions: config.includeExtensions || [],
        includeMimeTypes: config.includeMimeTypes || [],
        ignore: config.ignore || [],
        useGitIgnore: config.useGitIgnore,
        apiConfig: config.apiConfig,
        apiConfigRuleOverrides: config.apiConfigRuleOverrides,
      };
    }

    if (config.baseConfig === 'parent') {
      // Load parent directory's config and merge with it
      const parentConfig = await this.findParentConfig(configDir);
      if (!parentConfig) {
        throw new Error(
          `No parent configuration found for directory "${configDir}". ` +
          `When using baseConfig: "parent", there must be a parent ailintconfig.json ` +
          `with baseConfig set to "empty" or "default" somewhere in the directory hierarchy.`
        );
      }

      // Merge current config with parent config
      return {
        baseConfig: parentConfig.baseConfig,
        includeExtensions: [
          ...(parentConfig.includeExtensions || []),
          ...(config.includeExtensions || []),
        ],
        includeMimeTypes: [
          ...(parentConfig.includeMimeTypes || []),
          ...(config.includeMimeTypes || []),
        ],
        ignore: [
          ...(parentConfig.ignore || []),
          ...(config.ignore || []),
        ],
        useGitIgnore: config.useGitIgnore ?? parentConfig.useGitIgnore,
        apiConfig: config.apiConfig || parentConfig.apiConfig,
        apiConfigRuleOverrides: config.apiConfigRuleOverrides || parentConfig.apiConfigRuleOverrides,
      };
    }

    // baseConfig === 'default'
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
      apiConfig: config.apiConfig || baseConfig.apiConfig,
      apiConfigRuleOverrides: config.apiConfigRuleOverrides || baseConfig.apiConfigRuleOverrides,
    };
  }

  private async findParentConfig(startDir: string): Promise<AilintConfig | null> {
    // Check cache first
    if (this.directoryConfigCache.has(startDir)) {
      const cached = this.directoryConfigCache.get(startDir);
      return cached ? cached.config : null;
    }

    let currentDir = dirname(startDir);

    while (true) {
      // Check cache for this directory
      if (this.directoryConfigCache.has(currentDir)) {
        const cached = this.directoryConfigCache.get(currentDir);
        const result = cached ? cached.config : null;
        // Cache the result for the original start directory too
        this.directoryConfigCache.set(startDir, cached);
        return result;
      }

      const configPath = join(currentDir, 'ailintconfig.json');

      try {
        // Try to load config from this directory
        const content = await readFile(configPath, 'utf-8');
        const config = JSON.parse(content) as AilintConfig;

        // Default to 'parent' if not specified
        if (!config.baseConfig) {
          config.baseConfig = 'parent';
        }

        // Validate baseConfig
        if (config.baseConfig !== 'empty' && config.baseConfig !== 'default' && config.baseConfig !== 'parent') {
          throw new Error(`Invalid baseConfig value: ${config.baseConfig}. Must be 'empty', 'default', or 'parent'.`);
        }

        // Validate apiConfigRuleOverrides patterns
        if (config.apiConfigRuleOverrides) {
          this.validateRulePatterns(config.apiConfigRuleOverrides, configPath);
        }

        // Recursively merge if this config also uses 'parent'
        let resolvedConfig: AilintConfig;
        if (config.baseConfig === 'parent') {
          resolvedConfig = await this.mergeWithBase(config, currentDir);
        } else {
          resolvedConfig = await this.mergeWithBase(config, currentDir);
        }

        // Cache the result
        this.directoryConfigCache.set(currentDir, { config: resolvedConfig, filePath: configPath });
        this.directoryConfigCache.set(startDir, { config: resolvedConfig, filePath: configPath });
        return resolvedConfig;
      } catch (error) {
        // Config doesn't exist in this directory, continue to parent
        if (!(error instanceof Error) || !error.message.includes('ENOENT')) {
          // If it's not a "file not found" error, it might be a validation error - throw it
          if (error instanceof Error && error.message.includes('Invalid baseConfig')) {
            throw error;
          }
        }
      }

      // Move to parent directory
      const parentDir = dirname(currentDir);

      // If we've reached the root, stop and return null
      if (parentDir === currentDir) {
        // Cache null result to avoid repeated walks
        this.directoryConfigCache.set(startDir, null);
        return null;
      }

      currentDir = parentDir;
    }
  }

  private expandApiConfig(apiConfig: any): any {
    if (!apiConfig) return apiConfig;

    // Load environment variables
    const envResult = config({ path: ['.env', '.local.env'], override: true, quiet: true });
    const expanded = expand(envResult);

    const expandedConfig: any = {};
    for (const [key, value] of Object.entries(apiConfig)) {
      if (typeof value === 'string' && value.includes('${')) {
        // Simple template variable expansion
        const expandedValue = value.replace(/\$\{([^}]+)\}/g, (match, varExpression) => {
          // Handle default values: ${VAR:-default}
          const [varName, ...defaultParts] = varExpression.split(':-');
          const defaultValue = defaultParts.join(':-');
          return expanded.parsed?.[varName] || process.env[varName] || defaultValue;
        });
        expandedConfig[key] = expandedValue;
      } else {
        expandedConfig[key] = value;
      }
    }

    return expandedConfig;
  }

  async loadConfigWithExpandedApiConfig(configPath: string): Promise<AilintConfig> {
    const config = await this.loadConfig(configPath);
    
    if (config.apiConfig) {
      config.apiConfig = this.expandApiConfig(config.apiConfig);
    }
    
    return config;
  }

  clearCache(): void {
    this.configCache.clear();
    this.directoryConfigCache.clear();
  }
}
