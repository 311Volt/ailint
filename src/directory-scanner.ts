import { readdir, stat, access, readFile } from 'node:fs/promises';
import { join, extname, relative, dirname } from 'node:path';
import { lookup } from 'mime-types';
import ignore from 'ignore';
import { ConfigLoader } from './config-loader.js';
import type { AilintConfig } from './interfaces/ailintconfig.js';

export class DirectoryScanner {
  private configLoader: ConfigLoader;
  private configCache = new Map<string, AilintConfig | null>();

  constructor() {
    this.configLoader = new ConfigLoader();
  }

  async scanDirectory(dirPath: string): Promise<string[]> {
    const textFiles: string[] = [];
    await this._scanRecursive(dirPath, dirPath, textFiles);
    return textFiles;
  }

  private async _scanRecursive(
    rootPath: string,
    currentPath: string,
    textFiles: string[]
  ): Promise<void> {
    try {
      // Load config for current directory
      let config = await this.loadConfigForDirectory(currentPath);
      
      // If no config found, use default base config
      if (!config) {
        config = await this.configLoader.loadBaseConfig();
      }
      
      // Create ignore instance
      const ig = ignore();
      if (config.ignore && config.ignore.length > 0) {
        ig.add(config.ignore);
      }

      // Load and add .gitignore patterns if enabled
      if (config.useGitIgnore) {
        const gitignorePatterns = await this.loadGitIgnorePatterns(currentPath, rootPath);
        if (gitignorePatterns.length > 0) {
          ig.add(gitignorePatterns);
        }
      }

      const entries = await readdir(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(currentPath, entry.name);
        const relativePath = relative(rootPath, fullPath);

        // Check if path should be ignored
        if (this.shouldIgnore(ig, relativePath, entry.isDirectory())) {
          continue;
        }

        if (entry.isDirectory()) {
          await this._scanRecursive(rootPath, fullPath, textFiles);
        } else if (entry.isFile()) {
          if (this.isIncludedFile(fullPath, config)) {
            textFiles.push(fullPath);
          }
        }
      }
    } catch (error) {
      console.warn(`Warning: Could not read directory ${currentPath}: ${error}`);
    }
  }

  private async loadConfigForDirectory(dirPath: string): Promise<AilintConfig | null> {
    // Check cache first
    if (this.configCache.has(dirPath)) {
      return this.configCache.get(dirPath)!;
    }

    // Look for ailintconfig.json in current directory
    const configPath = join(dirPath, 'ailintconfig.json');
    
    try {
      await access(configPath);
      const config = await this.configLoader.loadConfigWithExpandedApiConfig(configPath);
      this.configCache.set(dirPath, config);
      return config;
    } catch {
      // No config found, check parent directory
      const parentDir = dirname(dirPath);
      
      // If we've reached the root, return null
      if (parentDir === dirPath) {
        this.configCache.set(dirPath, null);
        return null;
      }

      // Recursively check parent
      const parentConfig = await this.loadConfigForDirectory(parentDir);
      this.configCache.set(dirPath, parentConfig);
      return parentConfig;
    }
  }

  async loadApiConfigForDirectory(dirPath: string): Promise<AilintConfig['apiConfig'] | null> {
    const config = await this.loadConfigForDirectory(dirPath);
    
    if (!config) {
      // If no config found, load and expand base config
      const baseConfig = await this.configLoader.loadBaseConfig();
      const expandedBaseConfig = await this.configLoader.loadConfigWithExpandedApiConfig(
        join(__dirname, '..', 'static', 'ailintconfig.base.json')
      );
      return expandedBaseConfig.apiConfig || null;
    }
    
    return config.apiConfig || null;
  }

  async loadFullConfigForDirectory(dirPath: string): Promise<AilintConfig | null> {
    const config = await this.loadConfigForDirectory(dirPath);
    
    if (!config) {
      // If no config found, load and expand base config
      const expandedBaseConfig = await this.configLoader.loadConfigWithExpandedApiConfig(
        join(__dirname, '..', 'static', 'ailintconfig.base.json')
      );
      return expandedBaseConfig;
    }
    
    return config;
  }

  async resolveApiConfigForFile(filePath: string, ruleName: string): Promise<AilintConfig['apiConfig'] | null> {
    const dirPath = dirname(filePath);
    
    // Collect all configs from this directory up to root, with their paths
    const configsWithPaths = await this.collectConfigsWithPaths(dirPath);
    
    if (configsWithPaths.length === 0) {
      return null;
    }

    // Find the best matching override across all configs
    const bestMatch = this.findBestMatchingOverride(ruleName, configsWithPaths);
    
    if (bestMatch) {
      const { override, baseConfig } = bestMatch;
      
      if (!baseConfig) {
        throw new Error(`Rule override specified for "${ruleName}" but no base apiConfig found in configuration`);
      }

      // Merge override with base config
      return {
        baseUrl: override.baseUrl ?? baseConfig.baseUrl,
        modelName: override.modelName ?? baseConfig.modelName,
        apiKey: override.apiKey ?? baseConfig.apiKey,
        temperature: override.temperature ?? baseConfig.temperature,
      };
    }

    // No override found, return the base config from the most specific directory
    return configsWithPaths[configsWithPaths.length - 1]!.config.apiConfig || null;
  }

  private async collectConfigsWithPaths(startPath: string): Promise<Array<{ config: AilintConfig; configPath: string; depth: number }>> {
    const configs: Array<{ config: AilintConfig; configPath: string; depth: number }> = [];
    let currentPath = startPath;
    let depth = 0;

    while (true) {
      const configPath = join(currentPath, 'ailintconfig.json');
      
      try {
        await access(configPath);
        const config = await this.configLoader.loadConfigWithExpandedApiConfig(configPath);
        configs.push({ config, configPath, depth });
      } catch {
        // No config in this directory
      }

      // Move to parent directory
      const parentDir = dirname(currentPath);
      
      // If we've hit the root, stop
      if (parentDir === currentPath) {
        break;
      }

      currentPath = parentDir;
      depth++;
    }

    return configs;
  }

  private findBestMatchingOverride(
    ruleName: string,
    configsWithPaths: Array<{ config: AilintConfig; configPath: string; depth: number }>
  ): { override: Partial<AilintConfig['apiConfig']>; baseConfig: AilintConfig['apiConfig'] } | null {
    interface Match {
      override: Partial<AilintConfig['apiConfig']>;
      baseConfig: AilintConfig['apiConfig'];
      pattern: string;
      isExact: boolean;
      prefixLength: number;
      depth: number;
    }

    const matches: Match[] = [];

    // Collect all matching patterns from all configs
    for (const { config, configPath, depth } of configsWithPaths) {
      if (!config.apiConfigRuleOverrides) {
        continue;
      }

      for (const [pattern, override] of Object.entries(config.apiConfigRuleOverrides)) {
        if (this.patternMatches(pattern, ruleName)) {
          const isExact = !pattern.includes('*');
          const prefixLength = isExact ? ruleName.length : pattern.length - 1; // -1 for the asterisk

          matches.push({
            override,
            baseConfig: config.apiConfig || null,
            pattern,
            isExact,
            prefixLength,
            depth,
          });
        }
      }
    }

    if (matches.length === 0) {
      return null;
    }

    // Sort matches by priority:
    // 1. Exact matches first (isExact = true)
    // 2. Then by longest prefix
    // 3. Then by most nested directory (smallest depth)
    matches.sort((a, b) => {
      // Priority 1: Exact match wins
      if (a.isExact !== b.isExact) {
        return a.isExact ? -1 : 1;
      }
      
      // Priority 2: Longest prefix wins
      if (a.prefixLength !== b.prefixLength) {
        return b.prefixLength - a.prefixLength;
      }
      
      // Priority 3: Most nested directory wins (smaller depth = more nested)
      return a.depth - b.depth;
    });

    return matches[0]!;
  }

  private patternMatches(pattern: string, ruleName: string): boolean {
    if (!pattern.includes('*')) {
      // Exact match
      return pattern === ruleName;
    }

    // Prefix match (pattern ends with *)
    const prefix = pattern.slice(0, -1); // Remove the asterisk
    return ruleName.startsWith(prefix);
  }

  private shouldIgnore(ig: ReturnType<typeof ignore>, path: string, isDirectory: boolean): boolean {
    // Normalize path separators to forward slashes for ignore patterns
    const normalizedPath = path.replace(/\\/g, '/');
    
    // For directories, append trailing slash
    const checkPath = isDirectory ? `${normalizedPath}/` : normalizedPath;
    
    return ig.ignores(checkPath);
  }

  private isIncludedFile(filePath: string, config: AilintConfig): boolean {
    const ext = extname(filePath).toLowerCase();
    
    // Check extension
    if (config.includeExtensions && config.includeExtensions.length > 0) {
      if (config.includeExtensions.includes(ext)) {
        return true;
      }
    }

    // Check mime type
    if (config.includeMimeTypes && config.includeMimeTypes.length > 0) {
      const mimeType = lookup(filePath);
      if (mimeType) {
        for (const pattern of config.includeMimeTypes) {
          if (this.matchesMimePattern(mimeType, pattern)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  private matchesMimePattern(mimeType: string, pattern: string): boolean {
    // Handle wildcard patterns like "text/*"
    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, -2);
      return mimeType.startsWith(prefix + '/');
    }
    
    return mimeType === pattern;
  }

  private async loadGitIgnorePatterns(currentPath: string, rootPath: string): Promise<string[]> {
    const patterns: string[] = [];
    let dirPath = currentPath;

    // Walk up the directory tree from currentPath to rootPath
    while (true) {
      const gitignorePath = join(dirPath, '.gitignore');
      
      try {
        await access(gitignorePath);
        const content = await readFile(gitignorePath, 'utf-8');
        const lines = content.split('\n');
        
        for (const line of lines) {
          const trimmed = line.trim();
          // Skip empty lines and comments
          if (trimmed && !trimmed.startsWith('#')) {
            // Calculate the relative path prefix for patterns in this .gitignore
            const relativeToRoot = relative(rootPath, dirPath).replace(/\\/g, '/');
            
            if (relativeToRoot) {
              // If the .gitignore is in a subdirectory, prefix the pattern
              patterns.push(`${relativeToRoot}/${trimmed}`);
            } else {
              // If the .gitignore is at the root, use pattern as-is
              patterns.push(trimmed);
            }
          }
        }
      } catch {
        // .gitignore doesn't exist in this directory, continue
      }

      // Stop if we've reached the root path
      if (dirPath === rootPath) {
        break;
      }

      // Move to parent directory
      const parentDir = dirname(dirPath);
      
      // Safety check: if parent is same as current, we've hit the filesystem root
      if (parentDir === dirPath) {
        break;
      }

      dirPath = parentDir;
    }

    return patterns;
  }

  clearCache(): void {
    this.configCache.clear();
    this.configLoader.clearCache();
  }
}
