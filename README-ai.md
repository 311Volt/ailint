# AI Spec Validator

A command-line tool that validates AI specification rules in code using AI analysis. It scans source code for special AI specification blocks and ensures that implementations match their specifications.

## Overview

The AI Spec Validator helps maintain code consistency by:
- Scanning text files for AI specification blocks
- Extracting rules and their associated code blocks
- Validating that implementations match specifications using AI
- Providing clear pass/fail results with explanations

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd ai-spec

# Install dependencies
bun install

# Build the project
bun run build
```

## Usage

### Basic Usage

```bash
# Scan current directory
bun run src/index.ts

# Scan specific directory
bun run src/index.ts ./src

# Use the CLI directly (after building)
ai-spec ./my-project
```

### Command Line Options

```bash
ai-spec [folder] [options]

Arguments:
  folder          Folder path to scan (default: ".")

Options:
  -b, --base-url <url>     OpenAI-compatible API base URL
  -k, --api-key <key>      OpenAI API key
  -m, --model <name>       AI model name (default: "gpt-4")
  -c, --chunk-size <size>  Maximum chunk size in characters (default: "150000")
  -v, --verbose            Verbose output
  -h, --help               Display help for command
```

### Environment Variables

You can use environment variables instead of command line options:

```bash
# Create a .env file
OPENAI_API_KEY=your-api-key-here
OPENAI_BASE_URL=https://api.openai.com/v1
```

## AI Specification Syntax

The tool looks for AI specification blocks in your source code comments:

### Defining a Rule

```javascript
// AI_SPEC_BEGIN(def_operations): "defines all available operations"
enum Operation {
  add,
  subtract,
  multiply,
  divide 
}
// AI_SPEC_END(def_operations)
```

### Implementing a Rule

```javascript
// AI_SPEC_BEGIN(def_operations): "implements all defined operations"
if(op == add) { /* ... */ }
if(op == subtract) { /* ... */ }
if(op == multiply) { /* ... */ }
if(op == divide) { /* ... */ }
// AI_SPEC_END(def_operations)
```

### Rule Structure

Each AI specification rule consists of:
- **Rule Name**: Identifier (e.g., `def_operations`)
- **Blocks**: Multiple blocks with:
  - **Specification**: What the code should do
  - **Source**: The actual implementation
  - **File Path**: Where the code is located
  - **Line Numbers**: Start and end lines

## Examples

### Example 1: Complete Rule Definition

File: `operations.ts`
```typescript
// AI_SPEC_BEGIN(math_operations): "defines basic math operations"
export enum MathOperation {
  ADD,
  SUBTRACT,
  MULTIPLY,
  DIVIDE
}
// AI_SPEC_END(math_operations)
```

File: `calculator.ts`
```typescript
// AI_SPEC_BEGIN(math_operations): "implements all math operations"
export function calculate(op: MathOperation, a: number, b: number): number {
  switch (op) {
    case MathOperation.ADD:
      return a + b;
    case MathOperation.SUBTRACT:
      return a - b;
    case MathOperation.MULTIPLY:
      return a * b;
    case MathOperation.DIVIDE:
      return b !== 0 ? a / b : NaN;
    default:
      throw new Error('Unknown operation');
  }
}
// AI_SPEC_END(math_operations)
```

### Example 2: API Endpoint Validation

File: `api-types.ts`
```typescript
// AI_SPEC_BEGIN(user_api): "defines user management API endpoints"
export interface UserEndpoints {
  createUser: 'POST /api/users';
  getUser: 'GET /api/users/:id';
  updateUser: 'PUT /api/users/:id';
  deleteUser: 'DELETE /api/users/:id';
}
// AI_SPEC_END(user_api)
```

File: `user-routes.ts`
```typescript
// AI_SPEC_BEGIN(user_api): "implements all user management endpoints"
app.post('/api/users', createUserHandler);
app.get('/api/users/:id', getUserHandler);
app.put('/api/users/:id', updateUserHandler);
app.delete('/api/users/:id', deleteUserHandler);
// AI_SPEC_END(user_api)
```

## Output Format

The tool outputs validation results in the following format:

```json
{
  "rule1": {
    "result": "PASS"
  },
  "rule2": {
    "result": "FAIL",
    "reason": "The implementation is missing the divide operation that was defined in the specification."
  }
}
```

### Console Output

```
Validation Results:
==================
✅ math_operations: PASS
❌ user_api: FAIL
   Reason: The implementation is missing error handling for invalid user IDs.

Summary:
========
Total rules: 2
Passed: 1
Failed: 1
```

## Configuration

### AI Service Configuration

The tool supports various OpenAI-compatible APIs:

```bash
# OpenAI
ai-spec ./src --base-url https://api.openai.com/v1 --model gpt-4

# Azure OpenAI
ai-spec ./src --base-url https://your-resource.openai.azure.com/ --model gpt-4

# Local LLM (e.g., Ollama)
ai-spec ./src --base-url http://localhost:11434/v1 --model llama2
```

### Chunk Size Configuration

For large codebases, you can adjust the chunk size:

```bash
# Smaller chunks for more granular processing
ai-spec ./src --chunk-size 50000

# Larger chunks for faster processing
ai-spec ./src --chunk-size 300000
```

## Integration with CI/CD

### GitHub Actions

```yaml
name: AI Spec Validation
on: [push, pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bun run src/index.ts ./src
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

### Pre-commit Hook

```bash
#!/bin/sh
# .git/hooks/pre-commit

bun run src/index.ts ./src
if [ $? -ne 0 ]; then
  echo "AI Spec validation failed. Please fix the issues before committing."
  exit 1
fi
```

## File Types

The tool automatically detects and scans all files with `text/*` MIME types, including:
- `.js`, `.ts`, `.jsx`, `.tsx`
- `.py`, `.java`, `.cpp`, `.c`
- `.go`, `.rs`, `.php`
- `.rb`, `.swift`, `.kt`
- `.md`, `.txt`, `.json`, `.yaml`
- And many more...

It automatically excludes:
- `node_modules/`
- `.git/`
- Binary files

## Error Handling

The tool provides detailed error information:

```bash
ai-spec ./src --verbose
```

Verbose mode shows:
- Files being scanned
- Rules found
- AI processing progress
- Detailed error messages

## Best Practices

1. **Keep specifications concise**: Clear, specific descriptions help the AI provide accurate validation
2. **One rule per concept**: Group related specifications under a single rule name
3. **Use descriptive rule names**: Make rule names self-explanatory
4. **Include edge cases**: Specify error handling and edge cases in your specifications
5. **Test incrementally**: Validate rules as you add them to catch issues early

## Troubleshooting

### Common Issues

1. **No rules found**: Ensure your AI_SPEC blocks follow the correct syntax
2. **API errors**: Check your API key and base URL configuration
3. **Timeout errors**: Reduce chunk size or use a faster model
4. **False positives**: Make specifications more specific and detailed

### Debug Mode

```bash
# Enable verbose output for debugging
ai-spec ./src --verbose

# Test with a single file
ai-spec ./src/my-file.ts --verbose
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the MIT License.
