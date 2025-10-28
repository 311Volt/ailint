# Changelog

## Version 1.1.0 - File Discovery System Refactor

### Major Changes

#### New Configuration System
- Introduced `ailintconfig.json` configuration files
- Supports hierarchical configuration (searches current directory and parents)
- Two base config modes: `"empty"` and `"default"`
- Removed hardcoded checks for `node_modules` and `.git`

#### Configuration Options
- `includeExtensions`: Array of file extensions to include
- `includeMimeTypes`: Array of MIME type patterns (supports wildcards like `text/*`)
- `ignore`: Array of .gitignore-compatible patterns
- All options are optional and appended to base config when using `"default"` mode

#### XML Format for AI Submission
- Changed from JSON to XML format for submitting rules to AI models
- Source code now wrapped in CDATA blocks for better readability
- Makes code snippets more readable for both humans and models

#### Dry Run Modes
- `--dry-run=files`: Shows all files that would be scanned
- `--dry-run=rules`: Shows the XML that would be sent to the AI model
- Useful for debugging configuration and verifying ignore patterns

### Technical Details

#### New Files
- `src/interfaces/ailintconfig.ts`: Configuration interface
- `src/config-loader.ts`: Configuration loading and merging logic

#### Modified Files
- `src/directory-scanner.ts`: Complete rewrite using config system
- `src/send-rules-to-ai.ts`: Added XML formatting methods
- `src/index.ts`: Added dry-run mode support
- `package.json`: Added `ignore` package for .gitignore pattern matching
- `tsconfig.json`: Added JSON module resolution
- `README.md`: Comprehensive documentation of new features

### Examples

#### Minimal Configuration
```json
{
  "baseConfig": "default"
}
```

#### Custom Project Configuration
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

#### Python Project
```json
{
  "baseConfig": "empty",
  "includeExtensions": [".py"],
  "ignore": [
    "**/__pycache__",
    "**/venv",
    "**/.pytest_cache"
  ]
}
```

### Breaking Changes
- None. Existing functionality is preserved when no `ailintconfig.json` is present
- Default behavior uses built-in base configuration

### Migration Guide
1. No changes needed for basic usage
2. To customize behavior, create an `ailintconfig.json` in your project root
3. Start with `{"baseConfig": "default"}` and add customizations as needed
