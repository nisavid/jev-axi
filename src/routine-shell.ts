/**
 * Recognize a deliberately small POSIX shell language for the local safety fast path.
 * This is not a general shell parser: anything outside the complete forms below must
 * be evaluated. In particular, do not strip shell syntax before inspecting it.
 */
function literalCommands(command: string): string[][] | undefined {
  const commands: string[][] = [];
  let argv: string[] = [];
  let word = "";
  let started = false;
  let needsCommand = false;
  const finishWord = () => {
    if (started) argv.push(word);
    word = "";
    started = false;
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!;
    if (c === "'" || c === '"') {
      started = true;
      const quote = c;
      let closed = false;
      while (++i < command.length) {
        const q = command[i]!;
        if (q === quote) { closed = true; break; }
        // Double quotes still permit expansions and escapes. Single quotes do not.
        if (quote === '"' && /[$`\\]/.test(q)) return undefined;
        if (q === "\0" || q === "\r") return undefined;
        word += q;
      }
      if (!closed) return undefined;
    } else if (c === " " || c === "\t") {
      finishWord();
    } else if (c === "\n" || c === ";" || c === "|" || c === "&") {
      finishWord();
      // A newline can continue && / || / |, or follow another newline or semicolon.
      if (c === "\n" && argv.length === 0) continue;
      if (argv.length === 0) return undefined;
      let operator = c;
      if ((c === "&" || c === "|") && command[i + 1] === c) operator += command[++i];
      if (operator === "&") return undefined;
      commands.push(argv);
      argv = [];
      needsCommand = operator === "&&" || operator === "||" || operator === "|";
    } else {
      // No expansions, comments, escapes, redirections, groups, or globbing. Tilde is
      // literal inside a word (HEAD~1), but expands at the beginning of a shell word.
      if (!/[A-Za-z0-9_./,:=@%+~-]/.test(c) || (c === "~" && (!started || /[=:]$/.test(word)))) return undefined;
      started = true;
      word += c;
    }
  }
  finishWord();
  if (argv.length) commands.push(argv);
  else if (needsCommand) return undefined;
  return commands.length ? commands : undefined;
}

/** Validate every option, including arity; return operands without losing word boundaries. */
function readArgs(args: string[], flags: RegExp, values: readonly string[] = []): string[] | undefined {
  const operands: string[] = [];
  let options = true;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (options && arg === "--") { options = false; continue; }
    if (options && arg.startsWith("-") && arg !== "-") {
      if (values.includes(arg)) {
        if (++i >= args.length) return undefined;
      } else if (!flags.test(arg)) return undefined;
    } else operands.push(arg);
  }
  return operands;
}

const NO_FLAGS = /$^/;
const SEARCH_FLAGS = /^-[EFGFinHhRrsvwxcoulqa]+$/;
const PROJECT_SCRIPT = /^(test|lint|typecheck|check|format:check|build)$/;
const REBUILDABLE = /^(\.\/)?(node_modules|dist|build|out|\.next|\.nuxt|\.turbo|\.cache|coverage|target|__pycache__|\.pytest_cache|\.venv|venv|tmp)\/?$/;

/** Validate supported Git subcommands and arguments, assuming trusted local Git configuration. */
function routineGit(args: string[]): boolean {
  const [sub, ...rest] = args;
  switch (sub) {
    case "status":
      return readArgs(rest, /^-[sb]+$|^--(short|branch|porcelain(?:=v[12])?|untracked-files(?:=(?:no|normal|all))?)$/) !== undefined;
    case "log":
    case "show":
    case "diff":
      return readArgs(rest, /^-\d+$|^-[pUuwb]+$|^--(oneline|stat|name-only|name-status|no-decorate|decorate|all|no-ext-diff|no-textconv|cached|staged|check)$/) !== undefined;
    case "rev-parse":
      return readArgs(rest, /^--(show-toplevel|git-dir|is-inside-work-tree|abbrev-ref|verify|short)$/) !== undefined;
    case "ls-files":
      return readArgs(rest, /^-[zcdmoist]+$|^--(cached|deleted|modified|others|ignored|stage|exclude-standard)$/) !== undefined;
    case "describe":
      return readArgs(rest, /^--(tags|always|dirty)$/) !== undefined;
    case "grep":
      return readArgs(rest, SEARCH_FLAGS, ["-e", "-f"]) !== undefined;
    case "branch":
      return rest.length === 0 || (rest.length === 1 && ["-a", "-r", "--all"].includes(rest[0]!))
        || (rest[0] === "--list" && readArgs(rest.slice(1), NO_FLAGS) !== undefined);
    case "remote": return rest.length === 0 || (rest.length === 1 && rest[0] === "-v");
    case "stash": return rest.length === 1 && rest[0] === "list";
    default: return false;
  }
}

/** Validate one literal argv against the supported utility and trusted project-workflow forms. */
function routineCommand(argv: string[]): boolean {
  const [cmd, ...args] = argv;
  switch (cmd) {
    case "true": case "pwd": case "whoami": return args.length === 0;
    case "ls": return readArgs(args, /^-[laAdFhHLrRtS1]+$|^--(all|almost-all|directory|human-readable|recursive|reverse)$/) !== undefined;
    case "cat": return readArgs(args, /^-[AbeEnstTuv]+$/) !== undefined;
    case "head": case "tail": return readArgs(args, /^-\d+$|^-[nc]\d+$|^-[qv]+$/, ["-n", "-c"]) !== undefined;
    case "wc": return readArgs(args, /^-[clmwL]+$/) !== undefined;
    case "grep": case "egrep": case "fgrep": return readArgs(args, SEARCH_FLAGS, ["-e", "-f"]) !== undefined;
    case "rg": return readArgs(args, /^-[nHhivwxlcoqsaF]+$|^--(files|hidden|no-ignore|line-number|fixed-strings)$/, ["-e", "-f", "-g", "--glob"]) !== undefined;
    case "sort": return readArgs(args, /^-[bdfghinMrRsuVz]+$/, ["-t", "-k"]) !== undefined;
    case "uniq": {
      const operands = readArgs(args, /^-[cdiuD]+$/);
      return operands !== undefined && operands.length <= 1; // A second operand is an output file.
    }
    case "cut": return readArgs(args, /^-[sn]+$/, ["-b", "-c", "-f", "-d"]) !== undefined;
    case "tr": {
      const operands = readArgs(args, /^-[cdstC]+$/);
      return operands !== undefined && operands.length <= 2;
    }
    case "echo": return readArgs(args, /^-[neE]+$/) !== undefined;
    case "printf": return args.length > 0 && !args[0]!.startsWith("-") && !/%[^%]*n/.test(args[0]!);
    case "date": return args.length === 0 || (args.length === 1 && (args[0]!.startsWith("+") || ["-u", "--utc", "-R", "--rfc-email"].includes(args[0]!)));
    case "uname": return readArgs(args, /^-[asnrvmpio]+$|^--all$/) !== undefined;
    case "basename": {
      const operands = readArgs(args, NO_FLAGS);
      return operands !== undefined && operands.length >= 1 && operands.length <= 2;
    }
    case "dirname": case "realpath": return readArgs(args, NO_FLAGS) !== undefined;
    case "diff": return readArgs(args, /^-[uqrNwbiBE]+$/)?.length === 2;
    case "git": return routineGit(args);
    case "rm": {
      const targets = readArgs(args, /^-[rf]+$|^--(recursive|force)$/);
      return targets !== undefined && targets.length > 0 && targets.every((a) => REBUILDABLE.test(a));
    }
    case "npm": case "pnpm": case "yarn": case "bun": {
      const scriptArgs = args[0] === "run" ? args.slice(1) : args;
      if (PROJECT_SCRIPT.test(scriptArgs[0] ?? "")) {
        return scriptArgs.length === 1 || (scriptArgs[0] === "test" && scriptArgs[1] === "--" && scriptArgs[2] === "--run"
          && scriptArgs.slice(3).every((a) => /^(?:\.\/)?[\w./-]+$/.test(a) && !a.startsWith("-") && !a.startsWith("/") && !a.split("/").includes("..")));
      }
      return /^(install|i|ci)$/.test(args[0] ?? "")
        && args.slice(1).every((a) => ["--frozen-lockfile", "--ignore-scripts", "--offline", "--prefer-offline"].includes(a));
    }
    // Default npx/pnpx can download code. Retain only the explicit installed-tool form.
    case "npx":
      return args.length === 3 && args[0] === "--no-install" && args[1] === "tsc" && args[2] === "--noEmit";
    case "tsc": return args.length === 0 || (args.length === 1 && args[0] === "--noEmit");
    case "cargo": return (args.length === 1 && /^(test|build|check|clippy)$/.test(args[0]!)) || (args.length === 2 && args[0] === "fmt" && args[1] === "--check");
    case "go": return args.length === 1 && /^(test|build|vet)$/.test(args[0]!);
    case "gh":
      return args.length >= 2 && args.length <= 3 && /^(pr|issue|run|repo|release|workflow)$/.test(args[0]!)
        && /^(view|list|status|checks|diff)$/.test(args[1]!) && (args.length === 2 || /^[\w./-]+$/.test(args[2]!) && !args[2]!.startsWith("-"));
    default: return false;
  }
}

/** Allow only fully recognized POSIX commands; native Windows shell commands require evaluation. */
export function isRoutineShellCommand(command: string): boolean {
  // guard-exec uses cmd.exe on Windows. POSIX quoting cannot establish what it runs.
  if (process.platform === "win32") return false;
  const commands = literalCommands(command);
  return commands !== undefined && commands.every(routineCommand);
}
