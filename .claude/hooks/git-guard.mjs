#!/usr/bin/env node
// Claude Code PreToolUse hook for Bash and PowerShell commands. It never blocks
// ordinary work: commits and pushes to your own branch always go through. It
// blocks only the moments that need a person:
//
//   1. Merging or approving a pull request. Always denied: that's a human's call.
//   2. Pushing to main. Every change reaches main through a reviewed PR.
//   3. Marking a PR ready for review (`gh pr ready`, or `gh pr create` without
//      --draft) before /self-review has passed for exactly this branch's diff.
//
// Escape hatch for 2 and 3, only when the user explicitly asks for it: put
// SKIP_GIT_GUARD=1 first on the first line (`$env:SKIP_GIT_GUARD=1; ...` in
// PowerShell). It stays visible in the transcript. Nothing unlocks 1.
//
// LIMITS: this reads command text; it doesn't run a shell parser. Quoted text,
// here-strings and heredoc bodies are treated as data, so a commit message that
// mentions `gh pr merge` isn't blocked. A command hidden inside `bash -c "..."`
// or a script file isn't seen. The current branch and the review marker are read
// from the session's working directory, not from a `cd` or `git -C` inside the
// command; an explicit push to main is denied either way. GitHub itself can't enforce reviews on this
// repo's plan (docs/ci-and-reviews.md), so this guards Claude, not people.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { branchDiff, git, markerPath, repoRoot } from "./lib.mjs";

const SKIP = /^\s*(?:SKIP_GIT_GUARD=1\s|\$env:SKIP_GIT_GUARD\s*=\s*["']?1["']?\s*;)/;

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

/**
 * Decides one tool call. `context` supplies what needs git, so tests can fake it:
 *   currentBranch(): string
 *   reviewState({ forReady }): { ok: true } | { ok: false, reason: string }
 */
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
          "Merging is a person's job. Never run `gh pr merge`, approve a PR, or merge through the API. Tell the user the PR is ready, and leave the merge to its reviewer or owner.",
        );
      }
      if (group === "pr" && action === "review" && rest.some((arg) => arg === "--approve" || arg === "-a")) {
        return deny(
          "Approving is a person's job, and GitHub never lets the author approve their own PR. Claude's /self-review never replaces the human approval. Ask a teammate to review.",
        );
      }
      if (group === "api" && RAW_API_MERGE.test(command)) {
        return deny("Merging or approving through the GitHub API is a person's job, like `gh pr merge`.");
      }
      const ready =
        (group === "pr" && action === "ready" && !rest.includes("--undo")) ||
        (group === "pr" && action === "create" && !rest.some((arg) => arg === "--draft" || arg === "-d"));
      if (ready && !skip) {
        const state = context.reviewState({ forReady: action === "ready" });
        if (!state.ok) {
          return deny(
            `${state.reason} Open it as a draft (\`gh pr create --draft\`), run /self-review, fix every Critical and Important finding, and mark it ready only after that.`,
          );
        }
      }
    }

    if (name === "git") {
      const sub = gitSubcommand(words);
      if (sub.name === "push" && !skip && pushTargetsMain(sub.args, context.currentBranch)) {
        return deny(
          "Don't push to main. Every change reaches main through a pull request with one approval from someone other than the author. Push a branch and open a draft PR instead.",
        );
      }
    }
  }
  return { decision: "allow" };
}

function deny(reason) {
  return { decision: "deny", reason: `Git guard: ${reason}` };
}

/** The real context, backed by git in the directory the command runs in. */
export function gitContext(cwd) {
  return {
    currentBranch: () => git(["branch", "--show-current"], cwd).out,
    reviewState: ({ forReady }) => {
      const root = repoRoot(cwd);
      if (!root) return { ok: true }; // Not a git repo: nothing to gate.
      const diff = branchDiff(root);
      if (diff.error) return { ok: false, reason: `This branch can't be checked: ${diff.error}` };
      const file = markerPath(root);
      if (!existsSync(file)) return { ok: false, reason: "This branch hasn't passed /self-review yet." };
      let marker;
      try {
        marker = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        return { ok: false, reason: "The /self-review marker is unreadable. Delete .claude/review/last-review.json and re-run /self-review." };
      }
      if (marker.diff_hash !== diff.hash) {
        return {
          ok: false,
          reason: `The branch changed after the last /self-review (${marker.reviewed_at ?? "unknown time"}). Re-run /self-review over the current diff.`,
        };
      }
      if (forReady) {
        const upstream = git(["rev-parse", "@{upstream}"], root);
        if (upstream.ok && upstream.out !== diff.head) {
          return { ok: false, reason: "The reviewed commits aren't all pushed, so the PR doesn't match what was reviewed. Push first." };
        }
      }
      return { ok: true };
    },
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
