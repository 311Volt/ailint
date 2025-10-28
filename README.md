# ai-spec: AI code rules and cross-file checks

This is a command line tool that lets you define specification blocks through source code comments to enable AI consistency checks.

For instance, consider these 2 files:

```javascript
// enums.ts

// AI_SPEC_BEGIN(def_operations): "defines all available operations"
enum Operation {
  add,
  subtract,
  multiply,
  divide 
}
// AI_SPEC_END(def_operations)
```

```javascript
// impl.ts

// AI_SPEC_BEGIN(def_operations): "implements all defined operations"
if(op == add) { /* ... */ }
if(op == subtract) { /* ... */ }
if(op == multiply) { /* ... */ }
if(op == divide) { /* ... */ }
// AI_SPEC_END(def_operations)
```



These comments define a rule called "def_operations" across both of these files. On usage, an AI is called that checks whether the specifications match the code, in the context of all AI_SPEC blocks that make up the rule.

For example, if you comment out the "op == multiply" line, the code no longer meets the requirement "implements all defined operations" and the tool will report a failure.

## Integration

This is meant to be used for manual usage or CI/CD. Beware of false positives, however. Treat failures as warnings rather than errors.

## Chunking

Rules are sent in batches up to 150k characters by default. This is to reduce API calls while keeping context length small enough to fit in most popular models. It also limits output degradation in long-context models.

## AI API

This tool is designed to call any OpenAI-compatible API. Refer to `.env` for possible configuration options.

As of 2025-10-28, I personally recommend Gemini 2.5 Flash-Lite, as it is suitable for simple consistency checks while being extremely fast and low-cost. The older Gemini 2.0 Flash can also be used for a higher rate limit of 1 million TPM on the free tier.



## Configuration

`ailint` uses a flexible configuration system based on `ailintconfig.json` files. The tool searches for these configuration files in the directory being scanned and all its subdirectories, respecting configuration inheritance.

### Configuration File Location

Place an `ailintconfig.json` file in any directory you want to configure. The tool will:
1. Look for `ailintconfig.json` in the current directory
2. If not found, search parent directories recursively
3. Apply the first configuration file found

This means you can have different configurations for different parts of your project.

### Configuration Schema

```json
{
  "baseConfig": "default",
  "includeExtensions": [".ts", ".js"],
  "includeMimeTypes": ["text/plain"],
  "ignore": ["**/dist", "**/build"]
}
```

#### Fields

- **`baseConfig`** (required): Either `"empty"` or `"default"`
  - `"empty"`: Start with no default file patterns
  - `"default"`: Extend the built-in default configuration (recommended)

- **`includeExtensions`** (optional): Array of file extensions to include
  - Extensions are appended to base config if `baseConfig` is `"default"`
  - Examples: `".ts"`, `".tsx"`, `".py"`, `".java"`

- **`includeMimeTypes`** (optional): Array of MIME type patterns to include
  - Supports wildcards like `"text/*"` to match all text files
  - Appended to base config if `baseConfig` is `"default"`
  - Examples: `"text/*"`, `"application/json"`

- **`ignore`** (optional): Array of .gitignore-compatible patterns
  - Patterns are appended to base config if `baseConfig` is `"default"`
  - Supports all standard .gitignore syntax
  - Examples: `"**/node_modules"`, `"dist/"`, `"*.log"`

### Default Configuration

When using `"baseConfig": "default"`, the following defaults are applied:

**Extensions:**
```
.ts, .tsx, .js, .jsx, .mjs, .cjs, .py, .java, .cpp, .c, .h, .hpp,
.go, .rs, .php, .rb, .swift, .kt, .scala, .clj, .hs, .ml, .fs,
.sh, .bash, .zsh, .fish, .ps1, .yaml, .yml, .toml, .ini, .cfg,
.json, .xml, .svg, .md, .rst, .sql, .graphql, .gql
```

**MIME Types:**
```
text/*
```

**Ignore Patterns:**
```
/**/node_modules
/**/.git
```

### Configuration Examples

#### Minimal Configuration (Use Defaults)

```json
{
  "baseConfig": "default"
}
```

This uses all default file types and ignore patterns.

#### Custom Extensions Only

```json
{
  "baseConfig": "empty",
  "includeExtensions": [".ts", ".tsx", ".js", ".jsx"]
}
```

Only scans TypeScript and JavaScript files.

#### Extend Defaults with Additional Patterns

```json
{
  "baseConfig": "default",
  "includeExtensions": [".vue", ".svelte"],
  "ignore": [
    "**/coverage",
    "**/tmp",
    "**/*.test.ts"
  ]
}
```

Uses all defaults plus Vue and Svelte files, and ignores coverage, tmp directories, and test files.

#### Python Project Configuration

```json
{
  "baseConfig": "empty",
  "includeExtensions": [".py"],
  "ignore": [
    "**/__pycache__",
    "**/venv",
    "**/.pytest_cache",
    "**/*.pyc"
  ]
}
```

#### Ignore Specific Directories

```json
{
  "baseConfig": "default",
  "ignore": [
    "**/generated",
    "**/vendor",
    "docs/",
    "*.min.js"
  ]
}
```

## Dry Run Mode

Use dry run mode to preview what `ailint` will scan without making actual AI API calls.

### Files Mode

See the list of files that would be scanned:

```bash
ailint ./src --dry-run=files
```

Output:
```
Dry run mode: files

Found 42 files that would be scanned:

  src/index.ts
  src/parser.ts
  src/scanner.ts
  ...

Total: 42 files
```

### Rules Mode

See the XML that would be sent to the AI model:

```bash
ailint ./src --dry-run=rules
```

Output:
```
Dry run mode: rules

XML that would be sent to the AI model:

<?xml version="1.0" encoding="UTF-8"?>
<AISpecRules>
  <Rule name="example_rule">
    <Block>
      <specification>validates input</specification>
      <filePath>src/validator.ts</filePath>
      <startLine>10</startLine>
      <endLine>25</endLine>
      <source><![CDATA[
function validate(input: string) {
  // ... code here
}
]]></source>
    </Block>
  </Rule>
</AISpecRules>

Total rules: 5
XML length: 12,345 characters
```

This is useful for:
- Debugging configuration issues
- Verifying ignore patterns work correctly
- Checking XML formatting before sending to AI
- Estimating token usage

## CLI Options

```bash
ailint <folder> [options]
```

### Options

- `-b, --base-url <url>` - OpenAI-compatible API base URL (env: `AI_BASE_URL`)
- `-k, --api-key <key>` - AI API key (env: `AI_API_KEY`)
- `-m, --model <name>` - AI model name (default: `gemini-2.5-flash-lite`, env: `AI_MODEL_NAME`)
- `-t, --temperature <temp>` - AI temperature (default: `0.1`, env: `AI_TEMPERATURE`)
- `-c, --chunk-size <size>` - Max chunk size in characters (default: `150000`, env: `MAX_CHUNK_SIZE`)
- `-o, --output-format <format>` - Output format: `pretty` or `json` (default: `pretty`)
- `-v, --verbose` - Verbose output
- `--dry-run <mode>` - Dry run mode: `files` or `rules`

## WIP

This is a work-in-progress. For more details, refer to the [AI-generated README](README-ai.md).
