import { expect, test, describe, beforeEach, mock } from "bun:test";
import { ConfigLoader } from "./config-loader.js";
import type { AilintConfig } from "./interfaces/ailintconfig.js";

// Mock the readFile function
const mockReadFile = mock(() => Promise.resolve(""));

// Mock dotenv functions
const mockConfig = mock(() => ({ parsed: {} }));
const mockExpand = mock((result: any) => result);

mock.module("node:fs/promises", () => ({
  readFile: mockReadFile,
}));

mock.module("dotenv", () => ({
  config: mockConfig,
}));

mock.module("dotenv-expand", () => ({
  expand: mockExpand,
}));

describe("ConfigLoader", () => {
  let loader: ConfigLoader;

  const baseConfig: AilintConfig = {
    baseConfig: "empty",
    includeExtensions: [".ts", ".js", ".py"],
    includeMimeTypes: ["text/*"],
    ignore: ["**/node_modules", "**/.git"],
    useGitIgnore: true,
    apiConfig: {
      baseUrl: "https://api.openai.com/v1",
      modelName: "gpt-5-nano",
      apiKey: "test-key",
      temperature: "0.0",
    },
  };

  beforeEach(() => {
    loader = new ConfigLoader("test-base-config.json");
    mockReadFile.mockClear();
    mockConfig.mockClear();
    mockExpand.mockClear();
    loader.clearCache();
  });

  describe("loadConfig", () => {
    test("loads a valid config file", async () => {
      const customConfig: AilintConfig = {
        baseConfig: "empty",
        includeExtensions: [".ts"],
        ignore: ["**/dist"],
        useGitIgnore: false,
      };

      mockReadFile.mockResolvedValue(JSON.stringify(customConfig));

      const config = await loader.loadConfig("custom-config.json");

      expect(config.baseConfig).toBe("empty");
      expect(config.includeExtensions).toEqual([".ts"]);
      expect(config.ignore).toEqual(["**/dist"]);
      expect(config.useGitIgnore).toBe(false);
    });

    test("caches loaded configs", async () => {
      const customConfig: AilintConfig = {
        baseConfig: "empty",
        includeExtensions: [".ts"],
      };

      mockReadFile.mockResolvedValue(JSON.stringify(customConfig));

      await loader.loadConfig("test.json");
      await loader.loadConfig("test.json");

      // Should only read file once due to caching
      expect(mockReadFile).toHaveBeenCalledTimes(1);
    });

    test("throws error for invalid baseConfig value", async () => {
      const invalidConfig = {
        baseConfig: "invalid",
        includeExtensions: [".ts"],
      };

      mockReadFile.mockResolvedValue(JSON.stringify(invalidConfig));

      await expect(loader.loadConfig("invalid.json")).rejects.toThrow(
        "Invalid baseConfig value: invalid"
      );
    });

    test("defaults to 'parent' when baseConfig is omitted", async () => {
      const customConfig: AilintConfig = {
        includeExtensions: [".ts"],
      };

      // First call loads custom config, then subsequent calls should reject to simulate no parent
      mockReadFile
        .mockResolvedValueOnce(JSON.stringify(customConfig))
        .mockRejectedValue(new Error("ENOENT: no such file or directory"));

      // This will fail because it tries to find a parent config
      // We'll just verify the error message indicates 'parent' was used
      await expect(loader.loadConfig("test.json")).rejects.toThrow(
        "No parent configuration found"
      );
    });

    test("throws error for malformed JSON", async () => {
      mockReadFile.mockResolvedValue("{ invalid json }");

      await expect(loader.loadConfig("bad.json")).rejects.toThrow();
    });
  });

  describe("mergeWithBase - empty baseConfig", () => {
    test("returns config as-is when baseConfig is 'empty'", async () => {
      const customConfig: AilintConfig = {
        baseConfig: "empty",
        includeExtensions: [".ts"],
        ignore: ["**/dist"],
      };

      mockReadFile.mockResolvedValue(JSON.stringify(customConfig));

      const config = await loader.loadConfig("test.json");

      expect(config.baseConfig).toBe("empty");
      expect(config.includeExtensions).toEqual([".ts"]);
      expect(config.ignore).toEqual(["**/dist"]);
      expect(config.includeMimeTypes).toEqual([]);
    });

    test("fills in empty arrays for undefined fields with 'empty' baseConfig", async () => {
      const customConfig: AilintConfig = {
        baseConfig: "empty",
      };

      mockReadFile.mockResolvedValue(JSON.stringify(customConfig));

      const config = await loader.loadConfig("test.json");

      expect(config.includeExtensions).toEqual([]);
      expect(config.includeMimeTypes).toEqual([]);
      expect(config.ignore).toEqual([]);
    });
  });

  describe("mergeWithBase - default baseConfig", () => {
    test("merges with base config when baseConfig is 'default'", async () => {
      const customConfig: AilintConfig = {
        baseConfig: "default",
        includeExtensions: [".vue"],
        ignore: ["**/dist"],
      };

      // First call loads custom config, second call loads base config
      mockReadFile
        .mockResolvedValueOnce(JSON.stringify(customConfig))
        .mockResolvedValueOnce(JSON.stringify(baseConfig));

      const config = await loader.loadConfig("test.json");

      expect(config.baseConfig).toBe("default");
      // Should include both base and custom extensions
      expect(config.includeExtensions).toEqual([".ts", ".js", ".py", ".vue"]);
      // Should include both base and custom ignore patterns
      expect(config.ignore).toEqual(["**/node_modules", "**/.git", "**/dist"]);
      // Should include base mime types
      expect(config.includeMimeTypes).toEqual(["text/*"]);
    });

    test("uses custom apiConfig over base config", async () => {
      const customConfig: AilintConfig = {
        baseConfig: "default",
        apiConfig: {
          baseUrl: "https://custom.api.com",
          modelName: "custom-model",
          apiKey: "custom-key",
          temperature: "0.5",
        },
      };

      mockReadFile
        .mockResolvedValueOnce(JSON.stringify(customConfig))
        .mockResolvedValueOnce(JSON.stringify(baseConfig));

      const config = await loader.loadConfig("test.json");

      expect(config.apiConfig?.modelName).toBe("custom-model");
      expect(config.apiConfig?.baseUrl).toBe("https://custom.api.com");
    });

    test("falls back to base apiConfig when not provided", async () => {
      const customConfig: AilintConfig = {
        baseConfig: "default",
        includeExtensions: [".vue"],
      };

      mockReadFile
        .mockResolvedValueOnce(JSON.stringify(customConfig))
        .mockResolvedValueOnce(JSON.stringify(baseConfig));

      const config = await loader.loadConfig("test.json");

      expect(config.apiConfig).toEqual(baseConfig.apiConfig);
    });

    test("custom useGitIgnore overrides base", async () => {
      const customConfig: AilintConfig = {
        baseConfig: "default",
        useGitIgnore: false,
      };

      mockReadFile
        .mockResolvedValueOnce(JSON.stringify(customConfig))
        .mockResolvedValueOnce(JSON.stringify(baseConfig));

      const config = await loader.loadConfig("test.json");

      expect(config.useGitIgnore).toBe(false);
    });
  });

  describe("apiConfigRuleOverrides validation", () => {
    test("accepts valid exact match patterns", async () => {
      const customConfig: AilintConfig = {
        baseConfig: "empty",
        apiConfigRuleOverrides: {
          "exact_rule_name": { modelName: "gpt-5" },
          "another_rule": { temperature: "0.5" },
        },
      };

      mockReadFile.mockResolvedValue(JSON.stringify(customConfig));

      const config = await loader.loadConfig("test.json");

      expect(config.apiConfigRuleOverrides).toBeDefined();
      expect(Object.keys(config.apiConfigRuleOverrides!)).toHaveLength(2);
    });

    test("accepts valid prefix patterns", async () => {
      const customConfig: AilintConfig = {
        baseConfig: "empty",
        apiConfigRuleOverrides: {
          "test_*": { modelName: "gpt-5" },
          "security_*": { temperature: "0.0" },
        },
      };

      mockReadFile.mockResolvedValue(JSON.stringify(customConfig));

      const config = await loader.loadConfig("test.json");

      expect(config.apiConfigRuleOverrides).toBeDefined();
      expect(Object.keys(config.apiConfigRuleOverrides!)).toHaveLength(2);
    });

    test("rejects patterns with asterisk in the middle", async () => {
      const customConfig = {
        baseConfig: "empty",
        apiConfigRuleOverrides: {
          "prefix_*_suffix": { modelName: "gpt-5" },
        },
      };

      mockReadFile.mockResolvedValue(JSON.stringify(customConfig));

      await expect(loader.loadConfig("test.json")).rejects.toThrow(
        'Invalid rule pattern "prefix_*_suffix"'
      );
    });

    test("rejects patterns with multiple asterisks", async () => {
      const customConfig = {
        baseConfig: "empty",
        apiConfigRuleOverrides: {
          "**": { modelName: "gpt-5" },
        },
      };

      mockReadFile.mockResolvedValue(JSON.stringify(customConfig));

      await expect(loader.loadConfig("test.json")).rejects.toThrow(
        'Invalid rule pattern "**"'
      );
    });

    test("accepts pattern with just asterisk at the end after prefix", async () => {
      const customConfig: AilintConfig = {
        baseConfig: "empty",
        apiConfigRuleOverrides: {
          "a*": { modelName: "gpt-5" },
        },
      };

      mockReadFile.mockResolvedValue(JSON.stringify(customConfig));

      const config = await loader.loadConfig("test.json");

      expect(config.apiConfigRuleOverrides).toBeDefined();
    });

    test("rejects pattern with only asterisk", async () => {
      const customConfig = {
        baseConfig: "empty",
        apiConfigRuleOverrides: {
          "*": { modelName: "gpt-5" },
        },
      };

      mockReadFile.mockResolvedValue(JSON.stringify(customConfig));

      await expect(loader.loadConfig("test.json")).rejects.toThrow(
        'Invalid rule pattern "*"'
      );
    });
  });

  describe("loadBaseConfig", () => {
    test("loads base config from specified path", async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(baseConfig));

      const config = await loader.loadBaseConfig();

      expect(config.baseConfig).toBe("empty");
      expect(mockReadFile).toHaveBeenCalledWith("test-base-config.json", "utf-8");
    });

    test("throws error if base config cannot be loaded", async () => {
      mockReadFile.mockRejectedValue(new Error("File not found"));

      await expect(loader.loadBaseConfig()).rejects.toThrow(
        "Failed to load base config"
      );
    });
  });

  describe("clearCache", () => {
    test("clears the config cache", async () => {
      const customConfig: AilintConfig = {
        baseConfig: "empty",
        includeExtensions: [".ts"],
      };

      mockReadFile.mockResolvedValue(JSON.stringify(customConfig));

      await loader.loadConfig("test.json");
      loader.clearCache();
      await loader.loadConfig("test.json");

      // Should read file twice after cache clear
      expect(mockReadFile).toHaveBeenCalledTimes(2);
    });
  });

  describe("environment variable expansion", () => {
    test("expands environment variables in apiConfig", async () => {
      const customConfig: AilintConfig = {
        baseConfig: "empty",
        apiConfig: {
          baseUrl: "${API_URL}",
          modelName: "${MODEL_NAME:-gpt-5-nano}",
          apiKey: "${API_KEY}",
          temperature: "0.0",
        },
      };

      mockReadFile.mockResolvedValue(JSON.stringify(customConfig));
      mockConfig.mockReturnValue({
        parsed: {
          API_URL: "https://test.api.com",
          API_KEY: "test-key-123",
        },
      });
      mockExpand.mockReturnValue({
        parsed: {
          API_URL: "https://test.api.com",
          API_KEY: "test-key-123",
        },
      });

      // Set process.env for fallback
      process.env.API_URL = "https://test.api.com";
      process.env.API_KEY = "test-key-123";

      const config = await loader.loadConfigWithExpandedApiConfig("test.json");

      expect(config.apiConfig?.baseUrl).toBe("https://test.api.com");
      expect(config.apiConfig?.apiKey).toBe("test-key-123");
      expect(config.apiConfig?.modelName).toBe("gpt-5-nano"); // Uses default

      // Cleanup
      delete process.env.API_URL;
      delete process.env.API_KEY;
    });
  });
});
