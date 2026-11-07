#!/usr/bin/env node
// Checks every GitHub Actions workflow before GitHub sees it: valid YAML, the
// expected shape, and the repo's safety rules. npm run check:workflows
//
// GitHub still has the final word: it rejects a workflow it can't run, and
// shows "Invalid workflow file" on the run. This catches most of that locally.
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseDocument } from "yaml";

const WORKFLOW_DIR = ".github/workflows";
const FULL_SHA = /^[0-9a-f]{40}$/;

/** Returns a list of problems with one workflow file. An empty list means it passed. */
export function checkWorkflow(text) {
  const doc = parseDocument(text, { prettyErrors: true });
  if (doc.errors.length) {
    return doc.errors.map((error) => {
      const at = error.linePos?.[0];
      return at ? `line ${at.line}: ${error.message.split("\n")[0]}` : error.message;
    });
  }

  const workflow = doc.toJS();
  if (!workflow || typeof workflow !== "object") return ["the file is empty or not a mapping"];

  const problems = [];
  const triggers = workflow.on;
  if (!triggers) problems.push('missing "on:" (what triggers the workflow)');

  const events =
    typeof triggers === "string" ? [triggers] : Array.isArray(triggers) ? triggers : Object.keys(triggers ?? {});
  if (events.includes("pull_request_target")) {
    problems.push(
      '"pull_request_target" runs pull request code with this repo\'s secrets. Use "pull_request" instead',
    );
  }

  const jobs = workflow.jobs;
  if (!jobs || typeof jobs !== "object" || Object.keys(jobs).length === 0) {
    problems.push('missing "jobs:"');
    return problems;
  }

  const workflowPermissions = "permissions" in workflow;

  for (const [id, job] of Object.entries(jobs)) {
    const where = `job "${id}"`;
    if (!job || typeof job !== "object") {
      problems.push(`${where} is empty`);
      continue;
    }
    if (!workflowPermissions && !("permissions" in job)) {
      problems.push(`${where} has no "permissions:". Declare the least it needs, for example contents: read`);
    }
    // A job that calls a reusable workflow has no runner or steps of its own.
    if (job.uses) continue;
    if (!job["runs-on"]) problems.push(`${where} is missing "runs-on:"`);
    if (job["timeout-minutes"] === undefined) {
      problems.push(`${where} is missing "timeout-minutes:". A hung job otherwise runs for 6 hours`);
    }
    if (!Array.isArray(job.steps) || job.steps.length === 0) {
      problems.push(`${where} has no steps`);
      continue;
    }
    job.steps.forEach((step, index) => {
      const label = `${where}, step ${index + 1}${step?.name ? ` ("${step.name}")` : ""}`;
      if (!step || (!step.uses && !step.run)) {
        problems.push(`${label} needs "uses:" or "run:"`);
        return;
      }
      if (typeof step.uses === "string" && !step.uses.startsWith("./")) {
        const ref = step.uses.split("@")[1] ?? "";
        if (!FULL_SHA.test(ref)) {
          problems.push(
            `${label} uses "${step.uses}". Pin actions to a full commit SHA, with the version in a comment`,
          );
        }
      }
    });
  }
  return problems;
}

export function workflowFiles(directory = WORKFLOW_DIR) {
  return readdirSync(directory)
    .filter((file) => /\.ya?ml$/.test(file))
    .sort()
    .map((file) => `${directory}/${file}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  let failed = 0;
  const files = workflowFiles();
  for (const file of files) {
    const problems = checkWorkflow(readFileSync(file, "utf8"));
    if (problems.length === 0) {
      console.log(`ok    ${file}`);
      continue;
    }
    failed++;
    console.log(`FAIL  ${file}`);
    for (const problem of problems) console.log(`      - ${problem}`);
  }
  if (files.length === 0) {
    console.log(`No workflow files found in ${WORKFLOW_DIR}.`);
    process.exit(1);
  }
  if (failed) {
    console.log(`\n${failed} of ${files.length} workflow file(s) have problems. Fix them before pushing.`);
    process.exit(1);
  }
  console.log(`\nAll ${files.length} workflow file(s) are valid.`);
}
