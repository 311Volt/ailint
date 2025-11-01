import { expect, test, describe, beforeEach, mock } from "bun:test";
import { DirectoryScanner } from "./directory-scanner.js";
import type { AilintConfig } from "./interfaces/ailintconfig.js";

// Mock fs/promises functions
const mockReaddir = mock(() => Promise.resolve([]));
const mockStat = mock(() => Promise.resolve({} as any));
const mockAccess = mock(() => Promise.resolve());
const mockReadFile = mock(() => Promise.resolve(""));

// Mock mime-types
const mockLookup = mock((path: string): string | false => false);

// Mock ignore
const mockIgnoreInstance = {
  add: mock(() => mockIgnoreInstance),
  ignores: mock((path: string) => false),
};
const mockIgnore = mock(() => mockIgnoreInstance);

// Mock ConfigLoader
const mockConfigLoader = {
  loadConfigWithExpandedApiConfig: mock(() => Promise.resolve(null) as Promise<AilintConfig | null>),
  loadBaseConfig: mock(() => Promise.resolve({})),
  clearCache: mock(() => {}),
};

mock.module("node:fs/promises", () => ({
  readdir: mockReaddir,
  stat: mockStat,
  access: mockAccess,
  readFile: mockReadFile,
}));

mock.module("mime-types", () => ({
  lookup: mockLookup,
}));

mock.module("ignore", () => ({
  default: mockIgnore,
}));

mock.module("./config-loader.js", () => ({
  ConfigLoader: mock(function() {
    return mockConfigLoader;
  }),
}));

describe("DirectoryScanner", () => {
  let scanner: DirectoryScanner;

  const baseConfig: AilintConfig = {
    baseConfig: "empty",
    includeExtensions: [".ts", ".js"],
    includeMimeTypes: ["text/*"],
    ignore: ["**/node_modules", "**/.git"],
    useGitIgnore: true,
  };

  beforeEach(() => {
    scanner = new DirectoryScanner();
    mockReaddir.mockClear();
    mockStat.mockClear();
    mockAccess.mockClear();
    mockReadFile.mockClear();
    mockLookup.mockClear();
    mockIgnore.mockClear();
    mockIgnoreInstance.add.mockClear();
    mockIgnoreInstance.ignores.mockClear();
    mockConfigLoader.loadConfigWithExpandedApiConfig.mockClear();
    mockConfigLoader.loadBaseConfig.mockClear();
    mockConfigLoader.clearCache.mockClear();
    scanner.clearCache();
  });

  describe("includeExtensions", () => {
    test("correctly includes files with matching extensions", async () => {
      const config: AilintConfig = {
        baseConfig: "empty",
        includeExtensions: [".ts", ".js"],
        includeMimeTypes: [],
        ignore: [],
        useGitIgnore: false,
      };

      mockConfigLoader.loadBaseConfig.mockResolvedValue(config);
      mockIgnoreInstance.ignores.mockReturnValue(false);
      
      mockReaddir.mockResolvedValue([
        { name: "file1.ts", isDirectory: () => false, isFile: () => true },
        { name: "file2.js", isDirectory: () => false, isFile: () => true },
        { name: "file3.py", isDirectory: () => false, isFile: () => true },
      ] as any);

      const files = await scanner.scanDirectory("/test");

      expect(files).toHaveLength(2);
      expect(files).toContain("/test/file1.ts");
      expect(files).toContain("/test/file2.js");
      expect(files).not.toContain("/test/file3.py");
    });

    test("excludes files without matching extensions", async () => {
      const config: AilintConfig = {
        baseConfig: "empty",
        includeExtensions: [".ts"],
        includeMimeTypes: [],
        ignore: [],
        useGitIgnore: false,
      };

      mockConfigLoader.loadBaseConfig.mockResolvedValue(config);
      mockIgnoreInstance.ignores.mockReturnValue(false);
      
      mockReaddir.mockResolvedValue([
        { name: "file1.ts", isDirectory: () => false, isFile: () => true },
        { name: "file2.txt", isDirectory: () => false, isFile: () => true },
      ] as any);

      const files = await scanner.scanDirectory("/test");

      expect(files).toHaveLength(1);
      expect(files).toContain("/test/file1.ts");
    });
  });

  describe("includeMimeTypes", () => {
    test("correctly includes files with matching MIME types", async () => {
      const config: AilintConfig = {
        baseConfig: "empty",
        includeExtensions: [],
        includeMimeTypes: ["text/plain"],
        ignore: [],
        useGitIgnore: false,
      };

      mockConfigLoader.loadBaseConfig.mockResolvedValue(config);
      mockIgnoreInstance.ignores.mockReturnValue(false);
      
      mockReaddir.mockResolvedValue([
        { name: "file1.txt", isDirectory: () => false, isFile: () => true },
        { name: "file2.html", isDirectory: () => false, isFile: () => true },
      ] as any);

      mockLookup
        .mockReturnValueOnce("text/plain")
        .mockReturnValueOnce("text/html");

      const files = await scanner.scanDirectory("/test");

      expect(files).toHaveLength(1);
      expect(files).toContain("/test/file1.txt");
    });

    test("supports wildcard MIME type patterns", async () => {
      const config: AilintConfig = {
        baseConfig: "empty",
        includeExtensions: [],
        includeMimeTypes: ["text/*"],
        ignore: [],
        useGitIgnore: false,
      };

      mockConfigLoader.loadBaseConfig.mockResolvedValue(config);
      mockIgnoreInstance.ignores.mockReturnValue(false);
      
      mockReaddir.mockResolvedValue([
        { name: "file1.txt", isDirectory: () => false, isFile: () => true },
        { name: "file2.html", isDirectory: () => false, isFile: () => true },
        { name: "file3.png", isDirectory: () => false, isFile: () => true },
      ] as any);

      mockLookup
        .mockReturnValueOnce("text/plain")
        .mockReturnValueOnce("text/html")
        .mockReturnValueOnce("image/png");

      const files = await scanner.scanDirectory("/test");

      expect(files).toHaveLength(2);
      expect(files).toContain("/test/file1.txt");
      expect(files).toContain("/test/file2.html");
      expect(files).not.toContain("/test/file3.png");
    });
  });

  describe("ignore patterns", () => {
    test("correctly applies ignore patterns", async () => {
      const config: AilintConfig = {
        baseConfig: "empty",
        includeExtensions: [".ts"],
        includeMimeTypes: [],
        ignore: ["**/node_modules/**", "**/dist/**"],
        useGitIgnore: false,
      };

      mockConfigLoader.loadBaseConfig.mockResolvedValue(config);
      
      mockReaddir.mockResolvedValue([
        { name: "file1.ts", isDirectory: () => false, isFile: () => true },
        { name: "node_modules", isDirectory: () => true, isFile: () => false },
      ] as any);

      mockIgnoreInstance.ignores
        .mockReturnValueOnce(false) // file1.ts not ignored
        .mockReturnValueOnce(true);  // node_modules ignored

      const files = await scanner.scanDirectory("/test");

      expect(files).toHaveLength(1);
      expect(files).toContain("/test/file1.ts");
    });

    test("ignores files matching patterns", async () => {
      const config: AilintConfig = {
        baseConfig: "empty",
        includeExtensions: [".ts"],
        includeMimeTypes: [],
        ignore: ["*.test.ts"],
        useGitIgnore: false,
      };

      mockConfigLoader.loadBaseConfig.mockResolvedValue(config);
      
      mockReaddir.mockResolvedValue([
        { name: "code.ts", isDirectory: () => false, isFile: () => true },
        { name: "code.test.ts", isDirectory: () => false, isFile: () => true },
      ] as any);

      mockIgnoreInstance.ignores
        .mockReturnValueOnce(false) // code.ts not ignored
        .mockReturnValueOnce(true);  // code.test.ts ignored

      const files = await scanner.scanDirectory("/test");

      expect(files).toHaveLength(1);
      expect(files).toContain("/test/code.ts");
    });
  });

  describe("gitignore patterns", () => {
    test("respects .gitignore when useGitIgnore is true", async () => {
      const config: AilintConfig = {
        baseConfig: "empty",
        includeExtensions: [".ts"],
        includeMimeTypes: [],
        ignore: [],
        useGitIgnore: true,
      };

      mockConfigLoader.loadBaseConfig.mockResolvedValue(config);
      
      // Mock .gitignore file
      mockAccess.mockResolvedValueOnce(undefined); // .gitignore exists
      mockReadFile.mockResolvedValueOnce("*.log\ntemp/\nignored.ts");
      
      mockReaddir.mockResolvedValue([
        { name: "file1.ts", isDirectory: () => false, isFile: () => true },
        { name: "ignored.ts", isDirectory: () => false, isFile: () => true },
      ] as any);

      mockIgnoreInstance.ignores
        .mockReturnValueOnce(false) // file1.ts not ignored
        .mockReturnValueOnce(true);  // ignored.ts ignored by gitignore

      const files = await scanner.scanDirectory("/test");

      expect(mockReadFile).toHaveBeenCalled();
      expect(files).toHaveLength(1);
      expect(files).toContain("/test/file1.ts");
    });

    test("skips .gitignore when useGitIgnore is false", async () => {
      const config: AilintConfig = {
        baseConfig: "empty",
        includeExtensions: [".ts"],
        includeMimeTypes: [],
        ignore: [],
        useGitIgnore: false,
      };

      mockConfigLoader.loadBaseConfig.mockResolvedValue(config);
      mockIgnoreInstance.ignores.mockReturnValue(false);
      
      mockReaddir.mockResolvedValue([
        { name: "file1.ts", isDirectory: () => false, isFile: () => true },
        { name: "ignored.ts", isDirectory: () => false, isFile: () => true },
      ] as any);

      const files = await scanner.scanDirectory("/test");

      // Should not try to read .gitignore
      expect(mockReadFile).not.toHaveBeenCalled();
      expect(files).toHaveLength(2);
    });

    test("handles .gitignore with comments and empty lines", async () => {
      const config: AilintConfig = {
        baseConfig: "empty",
        includeExtensions: [".ts"],
        includeMimeTypes: [],
        ignore: [],
        useGitIgnore: true,
      };

      mockConfigLoader.loadBaseConfig.mockResolvedValue(config);
      
      // Mock .gitignore with comments and empty lines
      mockAccess.mockResolvedValueOnce(undefined);
      mockReadFile.mockResolvedValueOnce(`
# This is a comment
*.log

# Another comment
temp/
`);
      
      mockReaddir.mockResolvedValue([
        { name: "file1.ts", isDirectory: () => false, isFile: () => true },
      ] as any);

      mockIgnoreInstance.ignores.mockReturnValue(false);

      await scanner.scanDirectory("/test");

      // Should add patterns but skip comments and empty lines
      expect(mockIgnoreInstance.add).toHaveBeenCalled();
    });

    test("handles nested .gitignore files", async () => {
      const config: AilintConfig = {
        baseConfig: "empty",
        includeExtensions: [".ts"],
        includeMimeTypes: [],
        ignore: [],
        useGitIgnore: true,
      };

      mockConfigLoader.loadBaseConfig.mockResolvedValue(config);
      
      // Mock root .gitignore
      mockAccess
        .mockResolvedValueOnce(undefined) // root .gitignore exists
        .mockRejectedValueOnce(new Error("Not found")); // no nested .gitignore
      
      mockReadFile.mockResolvedValueOnce("*.log");
      
      mockReaddir
        .mockResolvedValueOnce([
          { name: "subdir", isDirectory: () => true, isFile: () => false },
        ] as any)
        .mockResolvedValueOnce([
          { name: "file.ts", isDirectory: () => false, isFile: () => true },
        ] as any);

      mockIgnoreInstance.ignores.mockReturnValue(false);

      await scanner.scanDirectory("/test");

      expect(mockReadFile).toHaveBeenCalled();
    });

    test("handles absolute and relative gitignore patterns", async () => {
      const config: AilintConfig = {
        baseConfig: "empty",
        includeExtensions: [".ts"],
        includeMimeTypes: [],
        ignore: [],
        useGitIgnore: true,
      };

      mockConfigLoader.loadBaseConfig.mockResolvedValue(config);
      
      mockAccess.mockResolvedValueOnce(undefined);
      mockReadFile.mockResolvedValueOnce("/absolute/path\nrelative/path\n*.log");
      
      mockReaddir.mockResolvedValue([
        { name: "file.ts", isDirectory: () => false, isFile: () => true },
      ] as any);

      mockIgnoreInstance.ignores.mockReturnValue(false);

      await scanner.scanDirectory("/test");

      expect(mockIgnoreInstance.add).toHaveBeenCalled();
    });

    test("correctly prefixes patterns from subdirectory .gitignore", async () => {
      const config: AilintConfig = {
        baseConfig: "empty",
        includeExtensions: [".ts"],
        includeMimeTypes: [],
        ignore: [],
        useGitIgnore: true,
      };

      mockConfigLoader.loadBaseConfig.mockResolvedValue(config);
      
      // Simulate scanning a nested directory
      mockAccess
        .mockRejectedValueOnce(new Error("Not found")) // no .gitignore at root
        .mockResolvedValueOnce(undefined); // .gitignore in subdir
      
      mockReadFile.mockResolvedValueOnce("temp/");
      
      mockReaddir.mockResolvedValue([
        { name: "file.ts", isDirectory: () => false, isFile: () => true },
      ] as any);

      mockIgnoreInstance.ignores.mockReturnValue(false);

      await scanner.scanDirectory("/test/subdir");

      expect(mockReadFile).toHaveBeenCalled();
    });
  });

  describe("nested configuration handling", () => {
    test("uses directory-specific configuration", async () => {
      const customConfig: AilintConfig = {
        baseConfig: "empty",
        includeExtensions: [".vue"],
        includeMimeTypes: [],
        ignore: [],
        useGitIgnore: false,
      };

      mockAccess.mockResolvedValueOnce(undefined); // config exists
      mockConfigLoader.loadConfigWithExpandedApiConfig.mockResolvedValue(customConfig);
      mockIgnoreInstance.ignores.mockReturnValue(false);
      
      mockReaddir.mockResolvedValue([
        { name: "component.vue", isDirectory: () => false, isFile: () => true },
        { name: "file.ts", isDirectory: () => false, isFile: () => true },
      ] as any);

      const files = await scanner.scanDirectory("/test");

      expect(files).toHaveLength(1);
      expect(files).toContain("/test/component.vue");
    });

    test("falls back to parent directory config when not found", async () => {
      mockAccess.mockRejectedValue(new Error("Not found")); // no config in current dir
      mockConfigLoader.loadBaseConfig.mockResolvedValue(baseConfig);
      mockIgnoreInstance.ignores.mockReturnValue(false);
      
      mockReaddir.mockResolvedValue([
        { name: "file.ts", isDirectory: () => false, isFile: () => true },
      ] as any);

      const files = await scanner.scanDirectory("/test/subdir");

      expect(files).toHaveLength(1);
    });

    test("caches configuration for directories", async () => {
      const customConfig: AilintConfig = {
        baseConfig: "empty",
        includeExtensions: [".ts"],
        includeMimeTypes: [],
        ignore: [],
        useGitIgnore: false,
      };

      mockAccess.mockResolvedValue(undefined);
      mockConfigLoader.loadConfigWithExpandedApiConfig.mockResolvedValue(customConfig);
      mockIgnoreInstance.ignores.mockReturnValue(false);
      
      mockReaddir
        .mockResolvedValueOnce([
          { name: "subdir", isDirectory: () => true, isFile: () => false },
        ] as any)
        .mockResolvedValueOnce([
          { name: "file.ts", isDirectory: () => false, isFile: () => true },
        ] as any);

      await scanner.scanDirectory("/test");

      // Config should be loaded and cached
      expect(mockConfigLoader.loadConfigWithExpandedApiConfig).toHaveBeenCalled();
    });
  });

  describe("recursive directory scanning", () => {
    test("recursively scans subdirectories", async () => {
      mockConfigLoader.loadBaseConfig.mockResolvedValue(baseConfig);
      mockIgnoreInstance.ignores.mockReturnValue(false);
      
      mockReaddir
        .mockResolvedValueOnce([
          { name: "subdir", isDirectory: () => true, isFile: () => false },
        ] as any)
        .mockResolvedValueOnce([
          { name: "file.ts", isDirectory: () => false, isFile: () => true },
        ] as any);

      const files = await scanner.scanDirectory("/test");

      expect(mockReaddir).toHaveBeenCalledTimes(2);
      expect(files).toHaveLength(1);
      expect(files[0]).toContain("file.ts");
    });

    test("handles read errors gracefully", async () => {
      mockConfigLoader.loadBaseConfig.mockResolvedValue(baseConfig);
      mockIgnoreInstance.ignores.mockReturnValue(false);
      
      mockReaddir.mockRejectedValue(new Error("Permission denied"));

      const files = await scanner.scanDirectory("/test");

      expect(files).toHaveLength(0);
    });
  });

  describe("clearCache", () => {
    test("clears both scanner and config loader caches", () => {
      scanner.clearCache();

      expect(mockConfigLoader.clearCache).toHaveBeenCalled();
    });
  });
});
