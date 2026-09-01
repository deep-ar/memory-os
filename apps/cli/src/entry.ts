#!/usr/bin/env node
import { createDefaultDependencies, runCli } from "./cli.js";

try {
  process.exitCode = await runCli(process.argv.slice(2), createDefaultDependencies());
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
