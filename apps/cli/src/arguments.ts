export interface ParsedArguments {
  readonly positionals: readonly string[];
  readonly options: ReadonlyMap<string, string | true>;
}

export function parseArguments(args: readonly string[]): ParsedArguments {
  const positionals: string[] = [];
  const options = new Map<string, string | true>();
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]!;
    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }
    const name = value.slice(2);
    const next = args[index + 1];
    if (next === undefined || next.startsWith("--")) {
      options.set(name, true);
    } else {
      options.set(name, next);
      index += 1;
    }
  }
  return { positionals, options };
}

export function stringOption(
  args: ParsedArguments,
  name: string,
  options: { readonly required?: boolean; readonly fallback?: string } = {},
): string | undefined {
  const value = args.options.get(name);
  if (value === true) throw new Error(`--${name} requires a value.`);
  const selected = value ?? options.fallback;
  if (selected === undefined && options.required === true) {
    throw new Error(`Missing required --${name}.`);
  }
  return selected;
}

export function booleanOption(args: ParsedArguments, name: string): boolean {
  const value = args.options.get(name);
  if (typeof value === "string") throw new Error(`--${name} does not accept a value.`);
  return value === true;
}
