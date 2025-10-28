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



## WIP

This is a work-in-progress. For more details, refer to the [AI-generated README](README.md).
