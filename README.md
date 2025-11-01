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

The tool is also `bun`-compatible.

### 2. Configure:

```bash
export OPENAI_API_KEY=your_openai_api_key_here
export OPENAI_MODEL=gpt-5-nano
```


```bash
export OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
export OPENAI_MODEL=gemini-2.5-flash-lite
export OPENAI_API_KEY=your_gemini_api_key_here
```

### 3. Use:

```bash
ailint .
```

By default, `ailint` will recursively scan the given directory for source files. 

## AI API

This tool is designed to call any OpenAI-compatible API that supports Structured Outputs.

This means that you can use one of the many providers that offer OpenAI-compatible endpoints. Some of them include:

|Provider|Base URL|
|-|-|
|OpenRouter|https://openrouter.ai/api/v1/|
|OpenAI|https://api.openai.com/v1/|
|Anthropic|https://api.anthropic.com/v1/|
|Google Gemini|https://generativelanguage.googleapis.com/v1beta/openai/|

As of November 2025, for a free option, use [Gemini's free tier](https://aistudio.google.com/api-keys) (`gemini-2.5-flash-lite` is especially notable for its speed), or go to [openrouter.ai](openrouter.ai), search for `free` and pick one of the available free models.


A general recommendation is to use a fast, cheap model as a global default, and to use granular per-directory and per-rule overrides (documented below) for isolated cases where a smarter model is required to perform a rule check properly.


## CLI

```bash
ailint <folder> [options]
```

### Options

- `-c, --chunk-size <size>` - Max chunk size in characters (default: `150000`, env: `MAX_CHUNK_SIZE`)
- `-o, --output-format <format>` - Output format: `pretty` or `json` (default: `pretty`)
- `-v, --verbose` - Verbose output
- `--dry-run <mode>` - Dry run mode: `files` or `rules`
- `--no-cache` - Disable caching of rule check results
- `--cache-dir <path>` - Directory to store cache files (default: `./.ai-lint-cache`)




## Integration

This is meant to be used for manual usage or CI/CD. Beware of false positives, however. Treat failures as warnings rather than errors.

### GitLab CI Integration

To integrate `ailint` into your GitLab CI pipeline, add the following job to your `.gitlab-ci.yml` file:

```yaml
ailint:
  stage: test
  image: node:20-alpine
  before_script:
    - npm install -g @x311volt/ailint
    # Or if using bun:
    # - apk add --no-cache curl unzip
    # - curl -fsSL https://bun.sh/install | bash
    # - export PATH="$HOME/.bun/bin:$PATH"
    # - bun install -g @x311volt/ailint
  script:
    - ailint .
  variables:
    OPENAI_BASE_URL: "${OPENAI_BASE_URL}"
    OPENAI_MODEL: "${OPENAI_MODEL}"
    OPENAI_API_KEY: "${OPENAI_API_KEY}"
  allow_failure: true  # Treat as warnings rather than hard failures
```

**Setting up environment variables:**

1. Go to your GitLab project's **Settings** → **CI/CD** → **Variables**
2. Add the following variables:
   - `OPENAI_BASE_URL` - Your AI provider's API endpoint (e.g., `https://generativelanguage.googleapis.com/v1beta/openai/`)
   - `OPENAI_MODEL` - The model to use (e.g., `gemini-2.5-flash-lite`)
   - `OPENAI_API_KEY` - Your API key (mark as **Protected** and **Masked**)

**Additional options:**

- To customize the scan directory, change `ailint .` to `ailint <directory>`
- To enforce failures instead of warnings, remove the `allow_failure: true` line (not recommended due to potential false positives)
- To use a different output format, add `--output-format json` to the script
- To scan only on specific branches, add:
  ```yaml
  only:
    - main
    - merge_requests
  ```


## Chunking

Rules are sent in batches up to 150k characters by default. This is to reduce API calls while keeping context length small enough to fit in most popular models. It also limits output degradation in long-context models.


## Configuration

`ailint` uses a configuration system based on `ailintconfig.json` files. The tool searches for these configuration files in the directory being scanned and all its subdirectories, respecting configuration inheritance.

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

For models containing "gpt-5" in their name, the temperature parameter is automatically excluded from API requests.

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
      "modelName": "claude-sonnet-4-5",
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
- Any rule starting with `security_` (e.g., `security_check`, `security_audit`) will use `claude-sonnet-4-5`
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

## AI_SPEC Block Syntax

### Basic Syntax

AI_SPEC blocks are defined using comment markers that contain the `AI_SPEC_BEGIN` and `AI_SPEC_END` tags:

```
<comment> AI_SPEC_BEGIN(rule_name): "specification" </comment>
... code ...
<comment> AI_SPEC_END(rule_name) </comment>
```

Where `<comment>` can be:
- `//` for single-line comments (JavaScript, TypeScript, Java, C++, etc.)
- `<!-- -->` for XML comments (HTML, XML, Markdown, etc.)
- `#` for hash comments (Python, Shell, etc.)
- Other language-specific comment syntax

### Single Rule Per Block

A block can belong to a single rule:

```javascript
// AI_SPEC_BEGIN(my_rule): "specification text for the rule"
function implementation() {
  // ... code that satisfies the specification
}
// AI_SPEC_END(my_rule)
```

### Multiple Rules Per Block

A block can belong to multiple rules at once by comma-separating rule names:

```javascript
// AI_SPEC_BEGIN(rule1, rule2, rule3): "specification"
function implementation() {
  // ... code that satisfies all three rules
}
// AI_SPEC_END(rule1, rule2, rule3)
```

**Important:** The rule names in `AI_SPEC_BEGIN` and `AI_SPEC_END` must match exactly:
- Same number of rules
- Same rule names in the same order
- Whitespace around rule names is trimmed, so `(rule1, rule2)` and `(rule1,rule2)` are equivalent

Invalid examples:

```javascript
// ❌ Mismatched rule names
// AI_SPEC_BEGIN(rule1, rule2): "spec"
code
// AI_SPEC_END(rule1, rule3)  // rule3 doesn't match rule2

// ❌ Different number of rules
// AI_SPEC_BEGIN(rule1, rule2): "spec"
code
// AI_SPEC_END(rule1)  // missing rule2

// ❌ Different order
// AI_SPEC_BEGIN(rule1, rule2): "spec"
code
// AI_SPEC_END(rule2, rule1)  // order doesn't match
```

### Multiple Blocks Per Rule

A single rule can have multiple blocks across different files:

```javascript
// file1.ts
// AI_SPEC_BEGIN(api_validation): "validates input parameters"
export function validateInput(data: unknown) {
  // ... validation logic
}
// AI_SPEC_END(api_validation)
```

```javascript
// file2.ts
// AI_SPEC_BEGIN(api_validation): "returns appropriate error responses"
export function handleError(error: Error) {
  // ... error handling
}
// AI_SPEC_END(api_validation)
```

The AI will check both blocks together when validating the `api_validation` rule.

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
- Estimating token usage (rule of thumb: 1 token = approx. 3-4 chars)
