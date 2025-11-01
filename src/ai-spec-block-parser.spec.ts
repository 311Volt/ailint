import { expect, test, describe, beforeEach, mock } from "bun:test";
import { AISpecBlockParser } from "./ai-spec-block-parser.js";
import type { AISpecRule } from "./interfaces/ai-spec-rule.js";

// Mock the readFile function
const mockReadFile = mock(() => Promise.resolve(""));

// We'll mock the fs/promises module
mock.module("node:fs/promises", () => ({
  readFile: mockReadFile,
}));

describe("AISpecBlockParser", () => {
  let parser: AISpecBlockParser;

  beforeEach(() => {
    parser = new AISpecBlockParser();
    mockReadFile.mockClear();
  });

  describe("parseFile - correct block recognition", () => {
    test("recognizes a correct AI_SPEC block", async () => {
      const fileContent = `
// AI_SPEC_BEGIN(test_rule): "this is a test specification"
function testCode() {
  return 42;
}
// AI_SPEC_END(test_rule)
`;
      mockReadFile.mockResolvedValue(fileContent);

      const rules = await parser.parseFile("test.ts");

      expect(rules).toHaveLength(1);
      expect(rules[0]!.name).toBe("test_rule");
      expect(rules[0]!.blocks).toHaveLength(1);
      expect(rules[0]!.blocks[0]!.specification).toBe("this is a test specification");
      expect(rules[0]!.blocks[0]!.source).toContain("function testCode()");
      expect(rules[0]!.blocks[0]!.filePath).toBe("test.ts");
      expect(rules[0]!.blocks[0]!.startLine).toBe(2);
      expect(rules[0]!.blocks[0]!.endLine).toBe(6);
    });

    test("recognizes multiple blocks for the same rule", async () => {
      const fileContent = `
// AI_SPEC_BEGIN(shared_rule): "first block"
const a = 1;
// AI_SPEC_END(shared_rule)

// AI_SPEC_BEGIN(shared_rule): "second block"
const b = 2;
// AI_SPEC_END(shared_rule)
`;
      mockReadFile.mockResolvedValue(fileContent);

      const rules = await parser.parseFile("test.ts");

      expect(rules).toHaveLength(1);
      expect(rules[0]!.name).toBe("shared_rule");
      expect(rules[0]!.blocks).toHaveLength(2);
      expect(rules[0]!.blocks[0]!.specification).toBe("first block");
      expect(rules[0]!.blocks[1]!.specification).toBe("second block");
    });

    test("recognizes multiple different rules", async () => {
      const fileContent = `
// AI_SPEC_BEGIN(rule1): "first rule"
const a = 1;
// AI_SPEC_END(rule1)

// AI_SPEC_BEGIN(rule2): "second rule"
const b = 2;
// AI_SPEC_END(rule2)
`;
      mockReadFile.mockResolvedValue(fileContent);

      const rules = await parser.parseFile("test.ts");

      expect(rules).toHaveLength(2);
      expect(rules.map(r => r.name).sort()).toEqual(["rule1", "rule2"]);
    });
  });

  describe("parseFile - error cases", () => {
    test("handles incorrect AI_SPEC_BEGIN syntax gracefully", async () => {
      const fileContent = `
// AI_SPEC_BEGIN(test_rule) "missing colon"
const a = 1;
// AI_SPEC_END(test_rule)
`;
      mockReadFile.mockResolvedValue(fileContent);

      const rules = await parser.parseFile("test.ts");

      // Should not recognize the malformed block
      expect(rules).toHaveLength(0);
    });

    test("handles missing AI_SPEC_END", async () => {
      const fileContent = `
// AI_SPEC_BEGIN(test_rule): "incomplete block"
const a = 1;
const b = 2;
`;
      mockReadFile.mockResolvedValue(fileContent);

      const rules = await parser.parseFile("test.ts");

      // Should not create a block without proper END
      expect(rules).toHaveLength(0);
    });

    test("handles AI_SPEC_END without prior matching BEGIN", async () => {
      const fileContent = `
const a = 1;
// AI_SPEC_END(test_rule)
const b = 2;
`;
      mockReadFile.mockResolvedValue(fileContent);

      const rules = await parser.parseFile("test.ts");

      // Should ignore orphaned END markers
      expect(rules).toHaveLength(0);
    });

    test("handles mismatched rule names in BEGIN and END", async () => {
      const fileContent = `
// AI_SPEC_BEGIN(rule1): "test"
const a = 1;
// AI_SPEC_END(rule2)
`;
      mockReadFile.mockResolvedValue(fileContent);

      const rules = await parser.parseFile("test.ts");

      // Should not create a block with mismatched names
      expect(rules).toHaveLength(0);
    });
  });

  describe("parseFiles - multiple file handling", () => {
    test("merges blocks from different files with same rule name", async () => {
      mockReadFile
        .mockResolvedValueOnce(`
// AI_SPEC_BEGIN(shared): "first file"
const a = 1;
// AI_SPEC_END(shared)
`)
        .mockResolvedValueOnce(`
// AI_SPEC_BEGIN(shared): "second file"
const b = 2;
// AI_SPEC_END(shared)
`);

      const rules = await parser.parseFiles(["file1.ts", "file2.ts"]);

      expect(rules).toHaveLength(1);
      expect(rules[0]!.name).toBe("shared");
      expect(rules[0]!.blocks).toHaveLength(2);
      expect(rules[0]!.blocks[0]!.filePath).toBe("file1.ts");
      expect(rules[0]!.blocks[1]!.filePath).toBe("file2.ts");
    });

    test("handles file read errors gracefully", async () => {
      mockReadFile
        .mockResolvedValueOnce(`
// AI_SPEC_BEGIN(valid): "valid block"
const a = 1;
// AI_SPEC_END(valid)
`)
        .mockRejectedValueOnce(new Error("File not found"))
        .mockResolvedValueOnce(`
// AI_SPEC_BEGIN(another): "another block"
const b = 2;
// AI_SPEC_END(another)
`);

      const rules = await parser.parseFiles(["file1.ts", "file2.ts", "file3.ts"]);

      // Should continue processing despite error in file2.ts
      expect(rules).toHaveLength(2);
      expect(rules.map(r => r.name).sort()).toEqual(["another", "valid"]);
    });
  });

  describe("parseFile - XML-style comments", () => {
    test("recognizes XML-style AI_SPEC block", async () => {
      const fileContent = `
<!-- AI_SPEC_BEGIN(test_rule): "this is a test specification" -->
function testCode() {
  return 42;
}
<!-- AI_SPEC_END(test_rule) -->
`;
      mockReadFile.mockResolvedValue(fileContent);

      const rules = await parser.parseFile("test.md");

      expect(rules).toHaveLength(1);
      expect(rules[0]!.name).toBe("test_rule");
      expect(rules[0]!.blocks).toHaveLength(1);
      expect(rules[0]!.blocks[0]!.specification).toBe("this is a test specification");
      expect(rules[0]!.blocks[0]!.source).toContain("function testCode()");
      expect(rules[0]!.blocks[0]!.filePath).toBe("test.md");
      expect(rules[0]!.blocks[0]!.startLine).toBe(2);
      expect(rules[0]!.blocks[0]!.endLine).toBe(6);
    });

    test("recognizes mixed comment styles in same file", async () => {
      const fileContent = `
// AI_SPEC_BEGIN(rule1): "double slash comment"
const a = 1;
// AI_SPEC_END(rule1)

<!-- AI_SPEC_BEGIN(rule2): "XML comment" -->
const b = 2;
<!-- AI_SPEC_END(rule2) -->
`;
      mockReadFile.mockResolvedValue(fileContent);

      const rules = await parser.parseFile("test.md");

      expect(rules).toHaveLength(2);
      expect(rules.map(r => r.name).sort()).toEqual(["rule1", "rule2"]);
      expect(rules.find(r => r.name === "rule1")!.blocks[0]!.specification).toBe("double slash comment");
      expect(rules.find(r => r.name === "rule2")!.blocks[0]!.specification).toBe("XML comment");
    });

    test("handles XML comments with extra whitespace", async () => {
      const fileContent = `
<!--   AI_SPEC_BEGIN(test):   "specification text"   -->
const code = true;
<!--   AI_SPEC_END(test)   -->
`;
      mockReadFile.mockResolvedValue(fileContent);

      const rules = await parser.parseFile("test.md");

      expect(rules).toHaveLength(1);
      expect(rules[0]!.blocks[0]!.specification).toBe("specification text");
    });
  });

  describe("parseFile - whitespace and formatting", () => {
    test("trims specification text", async () => {
      const fileContent = `
// AI_SPEC_BEGIN(test):   "  extra whitespace  "
const a = 1;
// AI_SPEC_END(test)
`;
      mockReadFile.mockResolvedValue(fileContent);

      const rules = await parser.parseFile("test.ts");

      expect(rules[0]!.blocks[0]!.specification).toBe("extra whitespace");
    });

    test("handles empty lines in block gracefully", async () => {
      const fileContent = `
// AI_SPEC_BEGIN(test): "test"

const a = 1;

const b = 2;
// AI_SPEC_END(test)
`;
      mockReadFile.mockResolvedValue(fileContent);

      const rules = await parser.parseFile("test.ts");

      expect(rules[0]!.blocks[0]!.source).toBeTruthy();
    });

    test("trims source code", async () => {
      const fileContent = `
// AI_SPEC_BEGIN(test): "test"


const a = 1;


// AI_SPEC_END(test)
`;
      mockReadFile.mockResolvedValue(fileContent);

      const rules = await parser.parseFile("test.ts");

      const source = rules[0]!.blocks[0]!.source;
      expect(source).not.toStartWith("\n\n");
      expect(source).not.toEndWith("\n\n");
    });
  });
});
