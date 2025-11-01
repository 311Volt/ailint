import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { AISpecRule } from './interfaces/ai-spec-rule.js';
import type { ApiConfig } from './interfaces/ailintconfig.js';

export interface CacheEntry {
  result: 'PASS' | 'FAIL';
  reason: string | null;
  timestamp: number;
}

export interface CacheOptions {
  enabled: boolean;
  cacheDir: string;
}

export class Cache {
  private readonly options: CacheOptions;
  private readonly packageVersion: string;

  constructor(options: CacheOptions, packageVersion: string) {
    this.options = options;
    this.packageVersion = packageVersion;
  }

  /**
   * Generate a cache key for a rule based on API config, package version, and rule content
   */
  generateCacheKey(apiConfig: ApiConfig, rule: AISpecRule): string {
    const cacheData = {
      apiConfiguration: apiConfig,
      aiLintPackageVersion: this.packageVersion,
      fullParsedRule: rule,
    };

    const jsonString = JSON.stringify(cacheData);
    const hash = createHash('sha256');
    hash.update(jsonString);
    return hash.digest('hex');
  }

  /**
   * Get the full path for a cache file
   */
  private getCacheFilePath(cacheKey: string): string {
    return join(this.options.cacheDir, `${cacheKey}.json`);
  }

  /**
   * Ensure the cache directory exists and has a .gitignore file
   */
  private async ensureCacheDir(): Promise<void> {
    try {
      await access(this.options.cacheDir);
    } catch {
      // Directory doesn't exist, create it
      await mkdir(this.options.cacheDir, { recursive: true });
    }

    // Ensure .gitignore exists
    const gitignorePath = join(this.options.cacheDir, '.gitignore');
    try {
      await access(gitignorePath);
    } catch {
      // .gitignore doesn't exist, create it
      await writeFile(gitignorePath, '*\n', 'utf-8');
    }
  }

  /**
   * Get a cached result for a rule
   */
  async get(apiConfig: ApiConfig, rule: AISpecRule): Promise<CacheEntry | null> {
    if (!this.options.enabled) {
      return null;
    }

    const cacheKey = this.generateCacheKey(apiConfig, rule);
    const filePath = this.getCacheFilePath(cacheKey);

    try {
      const content = await readFile(filePath, 'utf-8');
      const entry = JSON.parse(content) as CacheEntry;
      return entry;
    } catch {
      // Cache miss or error reading file
      return null;
    }
  }

  /**
   * Set a cached result for a rule
   */
  async set(apiConfig: ApiConfig, rule: AISpecRule, result: 'PASS' | 'FAIL', reason: string | null): Promise<void> {
    if (!this.options.enabled) {
      return;
    }

    await this.ensureCacheDir();

    const cacheKey = this.generateCacheKey(apiConfig, rule);
    const filePath = this.getCacheFilePath(cacheKey);

    const entry: CacheEntry = {
      result,
      reason,
      timestamp: Date.now(),
    };

    await writeFile(filePath, JSON.stringify(entry, null, 2), 'utf-8');
  }

  /**
   * Check if a result is cached for a rule
   */
  async has(apiConfig: ApiConfig, rule: AISpecRule): Promise<boolean> {
    if (!this.options.enabled) {
      return false;
    }

    const cacheKey = this.generateCacheKey(apiConfig, rule);
    const filePath = this.getCacheFilePath(cacheKey);

    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
