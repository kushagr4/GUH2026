#!/usr/bin/env node
// Conventional Commits check for PR titles and commit messages. No dependencies.
//
//   node scripts/check-commits.mjs --title "feat(auth): add social sign-in"
//   node scripts/check-commits.mjs --range <base>..<head> [--advisory]
//   node scripts/check-commits.mjs --branch [--advisory]    (this branch vs origin/main)
//
// The PR title is what lands on main (we squash-merge), so CI fails on a bad
// title. Commit messages are squashed away, so CI only warns about them.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const TYPES = [
  "feat",
  "fix",
  "refactor",
  "perf",
  "test",
  "docs",
  "chore",
  "ci",
  "build",
  "style",
  "revert",
];
export const MAX_HEADER_LENGTH = 100;

const HEADER = /^(?<type>[A-Za-z]+)(?:\((?<scope>[^()]*)\))?(?<breaking>!)?:(?<space> ?)(?<subject>.*)$/;
const SCOPE = /^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9-]+)*$/;
const EXAMPLE = '"feat(auth): add social sign-in" or "fix: handle an empty list"';

/** Returns the problems with one header line. An empty list means it's valid. */
export function checkHeader(raw) {
  const header = String(raw ?? "").split("\n")[0].trim();
  if (!header) return ["it's empty"];
  // `git revert` writes this itself.
  if (/^Revert ".+"$/.test(header)) return [];

  const problems = [];
  if (header.length > MAX_HEADER_LENGTH) {
    problems.push(`it's ${header.length} characters; keep it to ${MAX_HEADER_LENGTH}`);
  }

  const match = HEADER.exec(header);
  if (!match?.groups) {
    problems.push(`use "type(scope): description", for example ${EXAMPLE}`);
    return problems;
  }

  const { type, scope, space, subject } = match.groups;
  if (!TYPES.includes(type)) {
    const lower = type.toLowerCase();
    problems.push(
      TYPES.includes(lower)
        ? `write the type in lowercase: "${lower}"`
        : `"${type}" isn't a known type. Use one of: ${TYPES.join(", ")}`,
    );
  }
  if (scope !== undefined && !SCOPE.test(scope)) {
    problems.push(`the scope "${scope}" should be short, lowercase and hyphenated, like "auth" or "sign-in"`);
  }
  if (!subject.trim()) {
    problems.push("add a description after the colon");
  } else if (!space) {
    problems.push('put a space after the colon: "type: description"');
  } else {
    if (/^[A-Z][a-z]/.test(subject)) {
      problems.push(`start the description in lowercase: "${subject[0].toLowerCase()}${subject.slice(1)}"`);
    }
    if (subject.endsWith(".")) problems.push("drop the full stop at the end");
  }
  return problems;
}

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  return { ok: result.status === 0, out: result.stdout ?? "", err: result.stderr ?? "" };
}

/** Commit subjects in a range, oldest first, without merge commits. */
function commitsIn(range) {
  const log = git(["log", "--no-merges", "--reverse", "--format=%h%x1f%s", range]);
  if (!log.ok) return null;
  return log.out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, subject] = line.split("\x1f");
      return { sha, subject };
    });
}

// GitHub workflow commands need these characters escaped.
const escapeAnnotation = (text) => text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

function parseArgs(argv) {
  const args = { advisory: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--advisory") args.advisory = true;
    else if (arg === "--branch") args.branch = true;
    else if (arg === "--title") args.title = argv[++i] ?? "";
    else if (arg === "--range") args.range = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const inActions = process.env.GITHUB_ACTIONS === "true";
  let failed = false;

  if (args.title !== undefined) {
    const problems = checkHeader(args.title);
    if (problems.length) {
      failed = true;
      console.log(`PR title is not a Conventional Commit: "${args.title}"`);
      for (const problem of problems) console.log(`  - ${problem}`);
      console.log("\nThe title becomes the commit on main when the PR is squash-merged.");
      console.log("Edit the PR title on GitHub; the checks re-run by themselves.");
      if (inActions) {
        console.log(`::error title=PR title::${escapeAnnotation(`"${args.title}": ${problems.join("; ")}`)}`);
      }
    } else {
      console.log(`PR title ok: "${args.title}"`);
    }
  }

  if (args.range || args.branch) {
    let range = args.range;
    if (args.branch) {
      const base = git(["merge-base", "origin/main", "HEAD"]);
      if (!base.ok || !base.out.trim()) {
        console.log("Can't find where this branch left origin/main. Run `git fetch origin main`, then try again.");
        // Advisory means advisory: say what's missing, but don't fail the run.
        process.exit(args.advisory ? 0 : 1);
      }
      range = `${base.out.trim()}..HEAD`;
    }
    const commits = commitsIn(range);
    if (commits === null) {
      console.log(`Can't read the commits in ${range}. Is the full history checked out?`);
      process.exit(1);
    }
    const bad = commits
      .map((commit) => ({ ...commit, problems: checkHeader(commit.subject) }))
      .filter((commit) => commit.problems.length);

    if (commits.length === 0) console.log("No commits to check.");
    else if (bad.length === 0) console.log(`All ${commits.length} commit message(s) follow Conventional Commits.`);
    else {
      console.log(`${bad.length} of ${commits.length} commit message(s) don't follow Conventional Commits:`);
      for (const commit of bad) {
        console.log(`  ${commit.sha} "${commit.subject}"`);
        for (const problem of commit.problems) console.log(`      - ${problem}`);
        if (inActions && args.advisory) {
          console.log(
            `::warning title=Commit message::${escapeAnnotation(`${commit.sha} "${commit.subject}": ${commit.problems.join("; ")}`)}`,
          );
        }
      }
      if (args.advisory) {
        console.log("\nAdvisory only: squash-merging replaces these with the PR title, so this doesn't fail the PR.");
      } else {
        failed = true;
      }
    }
  }

  if (args.title === undefined && !args.range && !args.branch) {
    console.log('Usage: check-commits.mjs --title "<PR title>" | --range <base>..<head> | --branch [--advisory]');
    process.exit(2);
  }
  if (failed) process.exit(1);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) main();
