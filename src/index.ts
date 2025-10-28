#!/usr/bin/env node

import { Command } from 'commander';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { DirectoryScanner } from './directory-scanner.js';
import { AISpecBlockParser } from './ai-spec-block-parser.js';
import { SendRulesToAI } from './send-rules-to-ai.js';

// Load environment variables (local overrides take precedence)
config({ path: ['.env', '.local.env'], override: true, quiet: true });

const program = new Command();

program
  .name('ailint')
  .description('CLI tool to validate AI specification rules in code')
  .version('1.0.0')
  .argument('<folder>', 'Folder path to scan')
  .option('-b, --base-url <url>', 'OpenAI-compatible API base URL', process.env.AI_BASE_URL)
  .option('-k, --api-key <key>', 'AI API key', process.env.AI_API_KEY)
  .option('-m, --model <name>', 'AI model name', process.env.AI_MODEL_NAME || 'gemini-2.5-flash-lite')
  .option('-t, --temperature <temp>', 'AI temperature', process.env.AI_TEMPERATURE || '0.1')
  .option('-c, --chunk-size <size>', 'Maximum chunk size in characters', process.env.MAX_CHUNK_SIZE || '150000')
  .option('-o, --output-format <format>', 'Output format (pretty or json)', 'pretty')
  .option('-v, --verbose', 'Verbose output')
  .option('--dry-run <mode>', 'Dry run mode (files or rules) - shows what would be processed without making AI calls')
  .action(async (folder: string, options) => {
    try {
      if (options.verbose) {
        console.log('Starting AI Spec validation...');
        console.log(`Scanning folder: ${resolve(folder)}`);
      }

      // Initialize components
      const scanner = new DirectoryScanner();
      const parser = new AISpecBlockParser();

      // Scan for text files
      if (options.verbose) {
        console.log('Scanning for text files...');
      }
      const textFiles = await scanner.scanDirectory(resolve(folder));
      
      if (options.verbose) {
        console.log(`Found ${textFiles.length} text files`);
      }

      if (textFiles.length === 0) {
        console.log('No text files found to scan.');
        return;
      }

      // Handle --dry-run=files mode
      if (options.dryRun === 'files') {
        console.log('Dry run mode: files');
        console.log('===================\n');
        console.log(`Found ${textFiles.length} files that would be scanned:\n`);
        for (const file of textFiles) {
          console.log(`  ${file}`);
        }
        console.log(`\nTotal: ${textFiles.length} files`);
        return;
      }

      // Parse AI spec rules
      if (options.verbose) {
        console.log('Parsing AI specification rules...');
      }
      const rules = await parser.parseFiles(textFiles);
      
      if (options.verbose) {
        console.log(`Found ${rules.length} AI specification rules`);
      }

      if (rules.length === 0) {
        console.log('No AI specification rules found in the scanned files.');
        return;
      }

      // Handle --dry-run=rules mode
      if (options.dryRun === 'rules') {
        console.log('Dry run mode: rules');
        console.log('===================\n');
        
        const aiService = new SendRulesToAI({
          maxChunkSize: parseInt(options.chunkSize, 10),
        });
        
        const xmlOutput = aiService.formatRulesToXML(rules);
        
        console.log('XML that would be sent to the AI model:\n');
        console.log(xmlOutput);
        console.log(`\nTotal rules: ${rules.length}`);
        console.log(`XML length: ${xmlOutput.length} characters`);
        return;
      }

      // Validate dry-run option if provided
      if (options.dryRun) {
        console.error(`Error: Invalid dry-run mode "${options.dryRun}". Must be "files" or "rules".`);
        process.exit(1);
      }

      const aiService = new SendRulesToAI({
        baseUrl: options.baseUrl,
        apiKey: options.apiKey,
        modelName: options.model,
        temperature: parseFloat(options.temperature),
        maxChunkSize: parseInt(options.chunkSize, 10),
      });

      // Validate rules with AI
      if (options.verbose) {
        console.log('Validating rules with AI...');
      }
      
      const results = await aiService.validateRules(rules, (current, total) => {
        if (total > 1 && options.outputFormat === 'pretty') {
          process.stderr.write(`\rProcessing chunk ${current}/${total}...`);
          if (current === total) {
            process.stderr.write('\n');
          }
        }
      });

      // Output results based on format
      if (options.outputFormat === 'json') {
        // JSON output
        let passCount = 0;
        let failCount = 0;
        
        for (const result of Object.values(results)) {
          if (result.result === 'PASS') {
            passCount++;
          } else {
            failCount++;
          }
        }
        
        console.log(JSON.stringify({
          summary: {
            total: rules.length,
            passed: passCount,
            failed: failCount
          },
          results
        }, null, 2));
        
        process.exit(failCount > 0 ? 1 : 0);
      } else {
        // Pretty output
        console.log('\nValidation Results:');
        console.log('==================');
        
        let passCount = 0;
        let failCount = 0;

        for (const [ruleName, result] of Object.entries(results)) {
          if (result.result === 'PASS') {
            console.log(`✅ ${ruleName}: PASS`);
            passCount++;
          } else {
            console.log(`❌ ${ruleName}: FAIL`);
            if (result.reason) {
              console.log(`   Reason: ${result.reason}`);
            }
            failCount++;
          }
        }

        console.log('\nSummary:');
        console.log(`========`);
        console.log(`Total rules: ${rules.length}`);
        console.log(`Passed: ${passCount}`);
        console.log(`Failed: ${failCount}`);

        // Exit with appropriate code
        process.exit(failCount > 0 ? 1 : 0);
      }

    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      if (options.verbose) {
        console.error(error);
      }
      process.exit(1);
    }
  });

program.parse();
