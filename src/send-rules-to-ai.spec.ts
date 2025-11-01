import { expect, test, describe, beforeEach, mock } from "bun:test";
import { SendRulesToAI } from "./send-rules-to-ai.js";
import type { AISpecRule } from "./interfaces/ai-spec-rule.js";
import type { ApiConfig } from "./interfaces/ailintconfig.js";

// Mock OpenAI
const mockCreate = mock(() => Promise.resolve({
  choices: [{
    message: {
      tool_calls: [{
        function: {
          name: "return_validation_results",
          arguments: JSON.stringify({
            results: {
              test_rule: { result: "PASS" }
            }
          })
        }
      }]
    }
  }]
}));

const mockOpenAI = mock(function(config: any) {
  return {
    chat: {
      completions: {
        create: mockCreate
      }
    },
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  };
});

mock.module("openai", () => ({
  default: mockOpenAI,
}));

// Mock DirectoryScanner
const mockDirectoryScanner = {
  resolveApiConfigForFile: mock(() => Promise.resolve(null)),
};

describe("SendRulesToAI", () => {
  let service: SendRulesToAI;

  const testApiConfig: ApiConfig = {
    baseUrl: "https://api.test.com/v1",
    modelName: "test-model",
    apiKey: "test-key",
    temperature: "0.0",
  };

  beforeEach(() => {
    mockCreate.mockClear();
    mockOpenAI.mockClear();
    mockDirectoryScanner.resolveApiConfigForFile.mockClear();
    
    service = new SendRulesToAI({
      apiConfig: testApiConfig,
      maxChunkSize: 150000,
    });
  });

  describe("formatRulesToXML", () => {
    test("formats a single rule to XML", () => {
      const rules: AISpecRule[] = [{
        name: "test_rule",
        blocks: [{
          specification: "test specification",
          source: "const x = 1;",
          filePath: "/test/file.ts",
          startLine: 10,
          endLine: 15,
        }]
      }];

      const xml = service.formatRulesToXML(rules);

      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain('<AISpecRules>');
      expect(xml).toContain('name="test_rule"');
      expect(xml).toContain('test specification');
      expect(xml).toContain('const x = 1;');
      expect(xml).toContain('/test/file.ts');
      expect(xml).toContain('startLine="10"');
      expect(xml).toContain('endLine="15"');
    });

    test("formats multiple rules to XML", () => {
      const rules: AISpecRule[] = [
        {
          name: "rule1",
          blocks: [{
            specification: "spec1",
            source: "code1",
            filePath: "/file1.ts",
            startLine: 1,
            endLine: 5,
          }]
        },
        {
          name: "rule2",
          blocks: [{
            specification: "spec2",
            source: "code2",
            filePath: "/file2.ts",
            startLine: 10,
            endLine: 15,
          }]
        }
      ];

      const xml = service.formatRulesToXML(rules);

      expect(xml).toContain('name="rule1"');
      expect(xml).toContain('name="rule2"');
      expect(xml).toContain('spec1');
      expect(xml).toContain('spec2');
    });

    test("handles rule with multiple blocks", () => {
      const rules: AISpecRule[] = [{
        name: "multi_block",
        blocks: [
          {
            specification: "block 1",
            source: "code1",
            filePath: "/file1.ts",
            startLine: 1,
            endLine: 5,
          },
          {
            specification: "block 2",
            source: "code2",
            filePath: "/file2.ts",
            startLine: 10,
            endLine: 15,
          }
        ]
      }];

      const xml = service.formatRulesToXML(rules);

      expect(xml).toContain('block 1');
      expect(xml).toContain('block 2');
      expect(xml).toContain('/file1.ts');
      expect(xml).toContain('/file2.ts');
    });

    test("properly escapes special characters in CDATA", () => {
      const rules: AISpecRule[] = [{
        name: "test_rule",
        blocks: [{
          specification: "test",
          source: "const x = '<tag>'; // special & chars",
          filePath: "/test.ts",
          startLine: 1,
          endLine: 2,
        }]
      }];

      const xml = service.formatRulesToXML(rules);

      expect(xml).toContain("<tag>");
      expect(xml).toContain("&");
    });
  });

  describe("validateRules - single chunk", () => {
    test("correctly sends a rule to AI and receives PASS", async () => {
      const rules: AISpecRule[] = [{
        name: "test_rule",
        blocks: [{
          specification: "returns 42",
          source: "function test() { return 42; }",
          filePath: "/test.ts",
          startLine: 1,
          endLine: 3,
        }]
      }];

      mockCreate.mockResolvedValue({
        choices: [{
          message: {
            tool_calls: [{
              function: {
                name: "return_validation_results",
                arguments: JSON.stringify({
                  results: {
                    test_rule: { result: "PASS" }
                  }
                })
              }
            }]
          }
        }]
      });

      const results = await service.validateRules(rules);

      expect(results.test_rule).toBeDefined();
      expect(results.test_rule!.result).toBe("PASS");
      expect(mockCreate).toHaveBeenCalled();
    });

    test("correctly handles FAIL response with reason", async () => {
      const rules: AISpecRule[] = [{
        name: "failing_rule",
        blocks: [{
          specification: "returns 42",
          source: "function test() { return 43; }",
          filePath: "/test.ts",
          startLine: 1,
          endLine: 3,
        }]
      }];

      mockCreate.mockResolvedValue({
        choices: [{
          message: {
            tool_calls: [{
              function: {
                name: "return_validation_results",
                arguments: JSON.stringify({
                  results: {
                    failing_rule: {
                      result: "FAIL",
                      reason: "Function returns 43, not 42 as specified"
                    }
                  }
                })
              }
            }]
          }
        }]
      });

      const results = await service.validateRules(rules);

      expect(results.failing_rule).toBeDefined();
      expect(results.failing_rule!.result).toBe("FAIL");
      expect(results.failing_rule!.reason).toContain("43");
    });

    test("uses correct API configuration", async () => {
      const rules: AISpecRule[] = [{
        name: "test_rule",
        blocks: [{
          specification: "test",
          source: "code",
          filePath: "/test.ts",
          startLine: 1,
          endLine: 2,
        }]
      }];

      mockCreate.mockResolvedValue({
        choices: [{
          message: {
            tool_calls: [{
              function: {
                name: "return_validation_results",
                arguments: JSON.stringify({
                  results: { test_rule: { result: "PASS" } }
                })
              }
            }]
          }
        }]
      });

      await service.validateRules(rules);

      expect(mockOpenAI).toHaveBeenCalledWith({
        apiKey: "test-key",
        baseURL: "https://api.test.com/v1",
      });

      expect(mockCreate).toHaveBeenCalled();
      const callArgs = (mockCreate.mock.calls as any)[0][0] as any;
      expect(callArgs.model).toBe("test-model");
      expect(callArgs.temperature).toBe(0.0);
    });

    test("excludes temperature parameter for gpt-5 models", async () => {
      const gpt5Service = new SendRulesToAI({
        apiConfig: {
          ...testApiConfig,
          modelName: "gpt-5-mini",
        },
        maxChunkSize: 150000,
      });

      const rules: AISpecRule[] = [{
        name: "test_rule",
        blocks: [{
          specification: "test",
          source: "code",
          filePath: "/test.ts",
          startLine: 1,
          endLine: 2,
        }]
      }];

      mockCreate.mockResolvedValue({
        choices: [{
          message: {
            tool_calls: [{
              function: {
                name: "return_validation_results",
                arguments: JSON.stringify({
                  results: { test_rule: { result: "PASS" } }
                })
              }
            }]
          }
        }]
      });

      await gpt5Service.validateRules(rules);

      expect(mockCreate).toHaveBeenCalled();
      const callArgs = (mockCreate.mock.calls as any)[0][0] as any;
      expect(callArgs.model).toBe("gpt-5-mini");
      expect(callArgs.temperature).toBeUndefined();
    });
  });

  describe("validateRules - chunking", () => {
    test("breaks up large rules into chunks", async () => {
      const smallChunkService = new SendRulesToAI({
        apiConfig: testApiConfig,
        maxChunkSize: 500, // Very small chunk size
      });

      const largeRules: AISpecRule[] = [
        {
          name: "rule1",
          blocks: [{
            specification: "a".repeat(200),
            source: "b".repeat(200),
            filePath: "/file1.ts",
            startLine: 1,
            endLine: 100,
          }]
        },
        {
          name: "rule2",
          blocks: [{
            specification: "c".repeat(200),
            source: "d".repeat(200),
            filePath: "/file2.ts",
            startLine: 1,
            endLine: 100,
          }]
        }
      ];

      mockCreate.mockResolvedValue({
        choices: [{
          message: {
            tool_calls: [{
              function: {
                name: "return_validation_results",
                arguments: JSON.stringify({
                  results: {
                    rule1: { result: "PASS" },
                    rule2: { result: "PASS" }
                  }
                })
              }
            }]
          }
        }]
      });

      const results = await smallChunkService.validateRules(largeRules);

      // Should make multiple API calls due to chunking
      expect(mockCreate.mock.calls.length).toBeGreaterThan(1);
      expect(results.rule1).toBeDefined();
      expect(results.rule2).toBeDefined();
    });

    test("calls progress callback for each chunk", async () => {
      const progressCallback = mock(() => {});
      const smallChunkService = new SendRulesToAI({
        apiConfig: testApiConfig,
        maxChunkSize: 500,
      });

      const largeRules: AISpecRule[] = [
        {
          name: "rule1",
          blocks: [{
            specification: "a".repeat(200),
            source: "b".repeat(200),
            filePath: "/file1.ts",
            startLine: 1,
            endLine: 100,
          }]
        },
        {
          name: "rule2",
          blocks: [{
            specification: "c".repeat(200),
            source: "d".repeat(200),
            filePath: "/file2.ts",
            startLine: 1,
            endLine: 100,
          }]
        }
      ];

      mockCreate.mockResolvedValue({
        choices: [{
          message: {
            tool_calls: [{
              function: {
                name: "return_validation_results",
                arguments: JSON.stringify({
                  results: {
                    rule1: { result: "PASS" },
                    rule2: { result: "PASS" }
                  }
                })
              }
            }]
          }
        }]
      });

      await smallChunkService.validateRules(largeRules, progressCallback);

      expect(progressCallback).toHaveBeenCalled();
      expect(progressCallback.mock.calls.length).toBeGreaterThan(1);
    });

    test("processes all rules when chunking is needed", async () => {
      const smallChunkService = new SendRulesToAI({
        apiConfig: testApiConfig,
        maxChunkSize: 500,
      });

      const rules: AISpecRule[] = [];
      for (let i = 0; i < 5; i++) {
        rules.push({
          name: `rule${i}`,
          blocks: [{
            specification: "x".repeat(100),
            source: "y".repeat(100),
            filePath: `/file${i}.ts`,
            startLine: 1,
            endLine: 50,
          }]
        });
      }

      mockCreate.mockResolvedValue({
        choices: [{
          message: {
            tool_calls: [{
              function: {
                name: "return_validation_results",
                arguments: JSON.stringify({
                  results: Object.fromEntries(
                    rules.map(r => [r.name, { result: "PASS" }])
                  )
                })
              }
            }]
          }
        }]
      });

      const results = await smallChunkService.validateRules(rules);

      expect(Object.keys(results)).toHaveLength(5);
      for (let i = 0; i < 5; i++) {
        expect(results[`rule${i}`]).toBeDefined();
        expect(results[`rule${i}`]!.result).toBe("PASS");
      }
    });
  });

  describe("validateRules - per-file API config", () => {
    test("uses per-file API config when directory scanner is provided", async () => {
      const fileApiConfig: ApiConfig = {
        baseUrl: "https://file-api.com/v1",
        modelName: "file-model",
        apiKey: "file-key",
        temperature: "0.2",
      };

      mockDirectoryScanner.resolveApiConfigForFile.mockResolvedValue(fileApiConfig);

      const serviceWithScanner = new SendRulesToAI({
        apiConfig: testApiConfig,
        directoryScanner: mockDirectoryScanner as any,
      });

      const rules: AISpecRule[] = [{
        name: "test_rule",
        blocks: [{
          specification: "test",
          source: "code",
          filePath: "/custom/path/file.ts",
          startLine: 1,
          endLine: 2,
        }]
      }];

      mockCreate.mockResolvedValue({
        choices: [{
          message: {
            tool_calls: [{
              function: {
                name: "return_validation_results",
                arguments: JSON.stringify({
                  results: { test_rule: { result: "PASS" } }
                })
              }
            }]
          }
        }]
      });

      await serviceWithScanner.validateRules(rules);

      expect(mockDirectoryScanner.resolveApiConfigForFile).toHaveBeenCalledWith(
        "/custom/path/file.ts",
        "test_rule"
      );

      expect(mockOpenAI).toHaveBeenCalledWith({
        apiKey: "file-key",
        baseURL: "https://file-api.com/v1",
      });
    });

    test("throws error if blocks in same rule have different configs", async () => {
      const config1: ApiConfig = {
        baseUrl: "https://api1.com/v1",
        modelName: "model1",
        apiKey: "key1",
        temperature: "0.0",
      };

      const config2: ApiConfig = {
        baseUrl: "https://api2.com/v1",
        modelName: "model2",
        apiKey: "key2",
        temperature: "0.0",
      };

      mockDirectoryScanner.resolveApiConfigForFile
        .mockResolvedValueOnce(config1)
        .mockResolvedValueOnce(config2);

      const serviceWithScanner = new SendRulesToAI({
        apiConfig: testApiConfig,
        directoryScanner: mockDirectoryScanner as any,
      });

      const rules: AISpecRule[] = [{
        name: "conflicting_rule",
        blocks: [
          {
            specification: "test1",
            source: "code1",
            filePath: "/path1/file1.ts",
            startLine: 1,
            endLine: 2,
          },
          {
            specification: "test2",
            source: "code2",
            filePath: "/path2/file2.ts",
            startLine: 1,
            endLine: 2,
          }
        ]
      }];

      await expect(serviceWithScanner.validateRules(rules)).rejects.toThrow(
        /Configuration conflict detected for rule "conflicting_rule"/
      );
    });
  });

  describe("error handling", () => {
    test("throws error when AI doesn't call the tool", async () => {
      const rules: AISpecRule[] = [{
        name: "test_rule",
        blocks: [{
          specification: "test",
          source: "code",
          filePath: "/test.ts",
          startLine: 1,
          endLine: 2,
        }]
      }];

      mockCreate.mockResolvedValue({
        choices: [{
          message: {
            tool_calls: []
          }
        }]
      });

      await expect(service.validateRules(rules)).rejects.toThrow(
        "No tool call found"
      );
    });

    test("throws error when AI calls wrong tool", async () => {
      const rules: AISpecRule[] = [{
        name: "test_rule",
        blocks: [{
          specification: "test",
          source: "code",
          filePath: "/test.ts",
          startLine: 1,
          endLine: 2,
        }]
      }];

      mockCreate.mockResolvedValue({
        choices: [{
          message: {
            tool_calls: [{
              function: {
                name: "wrong_tool",
                arguments: "{}"
              }
            }]
          }
        }]
      });

      await expect(service.validateRules(rules)).rejects.toThrow(
        "unexpected tool called"
      );
    });
  });
});
