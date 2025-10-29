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
      const config = await this.configLoader.loadConfig(configPath);
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
