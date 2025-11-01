# ai-spec: AI code rules and cross-file checks

This is a command line tool that lets you define natural-language specification blocks through source code comments to enable AI correctness & consistency checks.

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

You can even use it to help keep your docs up-to-date:

```markdown
<!-- documentation.md -->
## The calculator
<!-- AI_SPEC_BEGIN(def_operations): "documents defined operations" -->
The calculator offers four operations: add, subtract, multiply and divide.
<!-- AI_SPEC_END(def_operations)  -->
```

## How to use

### 1. Install:

```bash
npm install -g @x311volt/ailint
```

### 2. Configure:

```bash
export AI_BASE_URL=https://api.openai.com/v1/
export AI_MODEL_NAME=gpt-5-mini
export AI_API_KEY=your-api-key-here
```

### 3. Use:

```bash
ailint .
```

By default, `ailint` will recursively scan the given directory for source files. 



## Integration

This is meant to be used for manual usage or CI/CD. Beware of false positives, however. Treat failures as warnings rather than errors.

## Chunking

Rules are sent in batches up to 150k characters by default. This is to reduce API calls while keeping context length small enough to fit in most popular models. It also limits output degradation in long-context models.

## AI API

This tool is designed to call any OpenAI-compatible API. Refer to `.env` for possible configuration options.

This means that you can use one of the following:
 - OpenAI API
 - Any model from OpenRouter
 - Gemini, by using their OpenAI-compatible endpoint

As of 2025-10-28, I personally recommend Gemini 2.5 Flash-Lite, as it is suitable for simple consistency checks while being extremely fast and low-cost. The older Gemini 2.0 Flash can also be used for a higher rate limit of 1 million TPM on the free tier.



## Configuration

`ailint` uses a flexible configuration system based on `ailintconfig.json` files. The tool searches for these configuration files in the directory being scanned and all its subdirectories, respecting configuration inheritance.

### Configuration File Location

Place an `ailintconfig.json` file in any directory you want to configure. The tool will:
1. Look for `ailintconfig.json` in the current directory
2. If not found, search parent directories recursively
3. Apply the first configuration file found

This means you can have different configurations for different parts of your project.

### API Configuration

The tool supports per-directory API configuration through the `apiConfig` section in `ailintconfig.json`. This allows you to use different AI models, API endpoints, and settings for different parts of your project.

#### API Configuration Schema

```json
{
  "baseConfig": "default",
  "apiConfig": {
    "baseUrl": "${OPENAI_BASE_URL:-https://api.openai.com/v1}",
    "modelName": "${OPENAI_MODEL:-gpt-5-nano}",
    "apiKey": "${OPENAI_API_KEY:-}",
    "temperature": "${OPENAI_TEMPERATURE:-0.0}"
  }
}
```

#### Environment Variable Expansion

The `apiConfig` section supports environment variable expansion using the `${VAR:-default}` syntax:
- `${OPENAI_BASE_URL:-https://api.openai.com/v1}` - Uses `OPENAI_BASE_URL` env var, or defaults to the OpenAI API
- `${OPENAI_MODEL:-gpt-5-nano}` - Uses `OPENAI_MODEL` env var, or defaults to `gpt-5-nano`
- `${OPENAI_API_KEY:-}` - Uses `OPENAI_API_KEY` env var, or defaults to empty string
- `${OPENAI_TEMPERATURE:-0.0}` - Uses `OPENAI_TEMPERATURE` env var, or defaults to `0.0`

#### Special Temperature Handling

For models containing "gpt-5" in their name, the temperature parameter is automatically excluded from API requests, as OpenAI does not accept this parameter for those models.

#### Per-Directory API Configuration

You can have different API configurations for different subdirectories:

```json
// src/frontend/ailintconfig.json
{
  "baseConfig": "default",
  "apiConfig": {
    "baseUrl": "${OPENAI_BASE_URL:-https://api.openai.com/v1}",
    "modelName": "${FRONTEND_MODEL:-gpt-4}",
    "apiKey": "${OPENAI_API_KEY:-}",
    "temperature": "${FRONTEND_TEMPERATURE:-0.1}"
  }
}
```

```json
// src/backend/ailintconfig.json
{
  "baseConfig": "default", 
  "apiConfig": {
    "baseUrl": "${OPENAI_BASE_URL:-https://api.openai.com/v1}",
    "modelName": "${BACKEND_MODEL:-gpt-5-nano}",
    "apiKey": "${OPENAI_API_KEY:-}",
    "temperature": "${BACKEND_TEMPERATURE:-0.0}"
  }
}
```

This allows you to use different models and settings for different parts of your codebase, with the chunking mechanism respecting the per-directory configuration.

#### API Configuration Rule Overrides

You can override API configuration for specific rules or groups of rules using the `apiConfigRuleOverrides` field. This allows you to use different models, endpoints, or settings for particular rules while keeping a base configuration for others.

**Rule Pattern Syntax:**

Rule patterns can be either:
1. **Exact rule name**: `"my_rule"` - matches only the rule named `my_rule`
2. **Prefix pattern**: `"prefix_*"` - matches any rule starting with `prefix_`

Note: Patterns like `"prefix_*_suffix"` are **not allowed**. Only prefix patterns ending with a single asterisk are supported.

**Example:**

```json
{
  "baseConfig": "default",
  "apiConfig": {
    "baseUrl": "${OPENAI_BASE_URL:-https://api.openai.com/v1}",
    "modelName": "${OPENAI_MODEL:-gpt-5-nano}",
    "apiKey": "${OPENAI_API_KEY:-}",
    "temperature": "${OPENAI_TEMPERATURE:-0.0}"
  },
  "apiConfigRuleOverrides": {
    "complex_algorithm": {
      "modelName": "gpt-5-mini",
      "temperature": "0.2"
    },
    "security_*": {
      "modelName": "claude-3-opus",
      "baseUrl": "https://api.anthropic.com/v1"
    },
    "test_*": {
      "modelName": "gpt-5-nano",
      "temperature": "0.5"
    }
  }
}
```

In this example:
- The `complex_algorithm` rule will use `gpt-5-mini` with temperature `0.2`
- Any rule starting with `security_` (e.g., `security_check`, `security_audit`) will use `claude-3-opus`
- Any rule starting with `test_` will use `gpt-5-nano` with temperature `0.5`
- All other rules will use the base `apiConfig` settings

**Important:** Rule overrides are partial - they merge with the base `apiConfig`. You only need to specify the fields you want to override.

**Pattern Matching Priority:**

When multiple patterns match a rule, the conflict is resolved using these priorities (in order):

1. **Exact match**: A pattern without `*` always wins over prefix patterns
2. **Longest prefix**: Among prefix patterns, the one with the longest prefix wins
3. **Most nested directory**: Configuration from more deeply nested directories takes precedence

**Example of priority resolution:**

```json
// /project/ailintconfig.json
{
  "apiConfigRuleOverrides": {
    "test_*": { "modelName": "gpt-5-nano" },
    "test_security_*": { "modelName": "gpt-5-mini" }
  }
}

// /project/src/ailintconfig.json
{
  "apiConfigRuleOverrides": {
    "test_security_auth": { "modelName": "gpt-5-large" }
  }
}
```

For a rule named `test_security_auth` in `/project/src/file.ts`:
- **Winner**: `test_security_auth` (exact match from `/project/src/ailintconfig.json`)
- Priority over: `test_security_*` (longer prefix but not exact)
- Priority over: `test_*` (shorter prefix)

For a rule named `test_security_encryption` in `/project/src/file.ts`:
- **Winner**: `test_security_*` (longest prefix)
- Priority over: `test_*` (shorter prefix)

**Validation:**

The configuration loader validates rule patterns and will reject configurations that:
- Contain duplicate patterns in the same file
- Use invalid pattern syntax (e.g., `"prefix_*_suffix"`)
- Have patterns with multiple asterisks

**⚠️ Configuration Validation Warning**

A single rule must use **exactly one** API configuration. All blocks within a rule are sent together in a single AI API request, so they must all resolve to the same configuration.

If blocks within the same rule resolve to different API configurations (whether through different directory configs or conflicting rule overrides), the tool will throw an error with details about the conflict. For example:

```
Configuration conflict detected for rule "my_rule":
Blocks within this rule resolve to different API configurations.
This is invalid because a rule must be contained within a single AI API request.
Conflicting configurations: {baseUrl: https://api.openai.com/v1, modelName: gpt-5-nano} vs {baseUrl: https://api.openai.com/v1, modelName: gpt-5-mini}
Blocks are located in:
  - src/file1.ts
  - src/file2.ts
Please ensure all blocks in rule "my_rule" use the same API configuration.
Check your ailintconfig.json files and apiConfigRuleOverrides settings.
```

To fix such errors:
1. Ensure all files containing blocks for the same rule are in directories with compatible configurations
2. Use `apiConfigRuleOverrides` consistently - don't override the same rule differently in different config files
3. Consider renaming rules if blocks genuinely need different AI models (split into separate rules)

### Configuration Schema

```json
{
  "baseConfig": "default",
  "includeExtensions": [".ts", ".js"],
  "includeMimeTypes": ["text/plain"],
  "ignore": ["**/dist", "**/build"],
  "useGitIgnore": true
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

- **`useGitIgnore`** (optional): Whether to automatically apply .gitignore patterns
  - Default: `true` (enabled by default)
  - When `true`, reads all .gitignore files from scan directory up to project root
  - .gitignore patterns are combined with the `ignore` patterns
  - Set to `false` to disable automatic .gitignore processing

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

This uses all default file types and ignore patterns, including automatic .gitignore processing.

#### Disable .gitignore Processing

```json
{
  "baseConfig": "default",
  "useGitIgnore": false
}
```

Disables automatic .gitignore pattern processing, only using explicit `ignore` patterns.

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
