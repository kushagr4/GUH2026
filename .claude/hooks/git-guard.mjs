#!/usr/bin/env node
// Claude Code PreToolUse hook. Hackathon fast-build mode: do not gate PRs
// on Claude self-review or human approval. Keep human-controlled merge and
// direct-main-push restrictions to avoid interfering with teammates.
// Parsing below only guards explicit gh merge/approve and direct main pushes.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { git } from "./lib.mjs";

const SKIP = /^\\s*(?:SKIP_GIT_GUARD=1\\s|\\$env:SKIP_GIT_GUARD\\s*=\\s*["']?1["']?\\s*;)/;

/** Blanks out quoted strings, here-strings and heredoc bodies, which are data. */
export function stripQuoted(command) {
  return blankQuotes(
    command
      // PowerShell here-strings: @' ... '@ and @" ... "@, closed at the start of a line.
      .replace(/@'[\s\S]*?\n'@/g, "''")
      .replace(/@"[\s\S]*?\n"@/g, '""')
      // Bash heredocs: everything up to the closing delimiter line.
      .replace(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[^\n]*\n[\s\S]*?\n\s*\2[ \t]*(?=\n|$)/g, "<<HEREDOC")
      .replace(/^[\s\S]*$/, blankQuotes)
  );
}

/**
 * One left-to-right pass, so a quote character inside the other kind of quote
 * stays data: `'he said "ok'` must not open a double-quoted span that swallows
 * the commands after it. An unclosed quote leaves the rest visible.
 */
function blankQuotes(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    // An apostrophe after a letter is part of a word (don't), not a quote.
    const single = char === "'" && !(i > 0 && /[A-Za-z0-9_]/.test(text[i - 1]));
    if (char === '"' || single) {
      let j = i + 1;
      while (j < text.length && text[j] !== char) j += char === '"' && text[j] === "\\" ? 2 : 1;
      if (j >= text.length) return out + text.slice(i);
      out += char + char;
      i = j + 1;
      continue;
    }
    out += char;
    i++;
  }
  return out;
}

/** Splits a command line into simple commands, each as a list of words. */
export function simpleCommands(command) {
  return stripQuoted(command)
    .split(/\r?\n|;|&&|\|\||\||&|\(|\)|\{|\}|`|\$\(/)
    .map((segment) =>
      segment
        .trim()
        .split(/\s+/)
        .filter(Boolean),
    )
    .map((words) => {
      // Drop what can come before the program: env assignments, shell keywords,
      // and PowerShell's call operator.
      let i = 0;
      while (
        i < words.length &&
        (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]) || /^(then|do|else|elif|if|while|until|time|!|&|exec|command)$/.test(words[i]))
      ) {
        i++;
      }
      return words.slice(i);
    })
    .filter((words) => words.length > 0);
}

const program = (word) => word.replace(/\\/g, "/").split("/").pop().replace(/\.exe$/i, "").toLowerCase();

/** The git subcommand and its arguments, skipping git's own options such as -C <dir>. */
function gitSubcommand(words) {
  let i = 1;
  while (i < words.length && words[i].startsWith("-")) {
    if (["-C", "-c", "--git-dir", "--work-tree", "--namespace"].includes(words[i])) i++;
    i++;
  }
  return { name: words[i], args: words.slice(i + 1) };
}

const MAIN_REF = /^\+?(?:[^:]*:)?(?:refs\/heads\/)?main$/;

/** Does this `git push` (its arguments after "push") update or delete main? */
export function pushTargetsMain(args, currentBranch) {
  if (args.some((arg) => arg === "--all" || arg === "--mirror")) return true;
  const deleting = args.some((arg) => arg === "--delete" || arg === "-d");
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (["--repo", "--receive-pack", "--exec", "-o", "--push-option"].includes(arg)) {
      i++;
      continue;
    }
    if (!arg.startsWith("-")) positional.push(arg);
  }
  const refspecs = positional.slice(1);
  if (refspecs.length === 0) return !deleting && currentBranch() === "main";
  return refspecs.some((spec) => MAIN_REF.test(spec) || (spec === "HEAD" && currentBranch() === "main"));
}

const RAW_API_MERGE = /\/pulls\/[^/\s]+\/merge\b|mergePullRequest|enablePullRequestAutoMerge|event=APPROVE|"event"\s*:\s*"APPROVE"/;

/** Decide whether a command can mutate protected GitHub refs. */
export function evaluate(command, context) {
  const skip = SKIP.test(command.split("\n")[0]);
  for (const words of simpleCommands(command)) {
    const name = program(words[0]);

    if (name === "gh") {
      // Skip gh's own options, such as -R owner/repo, to reach "pr merge".
      const args = [];
      for (let i = 1; i < words.length; i++) {
        if (["-R", "--repo", "--hostname"].includes(words[i])) i++;
        else args.push(words[i]);
      }
      const [group, action] = args;
      const rest = args.slice(2);
      if (group === "pr" && action === "merge") {
        return deny(
          "Merging remains the repository owner's job. No review or approval is required by the hackathon workflow; tell the owner the PR is ready for merge.",
        );
      }
      if (group === "pr" && action === "review" && rest.some((arg) => arg === "--approve" || arg === "-a")) {
        return deny(
          "Claude must not approve PRs. Hackathon mode has no review or approval requirement.",
        );
      }
      if (group === "api" && RAW_API_MERGE.test(command)) {
        return deny("Merging or approving through the GitHub API is a person's job, like `gh pr merge`.");
      }

    }

    if (name === "git") {
      const sub = gitSubcommand(words);
      if (sub.name === "push" && !skip && pushTargetsMain(sub.args, context.currentBranch)) {
        return deny(
          "Don't push directly to main. Push a feature branch and open a PR; reviews are not required in hackathon mode.",
        );
      }
    }
  }
  return { decision: "allow" };
}

function deny(reason) {
  return { decision: "deny", reason: `Git guard: ${reason}` };
}

/** Only the current branch is needed; no review-marker lookup. */
export function gitContext(cwd) {
  return {
    currentBranch: () => git(["branch", "--show-current"], cwd).out,
  };
}

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  try {
    const payload = JSON.parse(readStdin() || "{}");
    const tool = payload.tool_name ?? "";
    const command = payload.tool_input?.command;
    if ((tool === "Bash" || tool === "PowerShell") && typeof command === "string") {
      const result = evaluate(command, gitContext(payload.cwd || process.cwd()));
      if (result.decision === "deny") {
        console.log(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "deny",
              permissionDecisionReason: result.reason,
            },
          }),
        );
      }
    }
  } catch (error) {
    // Fail open, but say so: a guard that vanishes silently is worse than none.
    console.log(JSON.stringify({ systemMessage: `Git guard is INACTIVE for this command: ${error.message}` }));
  }
  process.exit(0);
}
