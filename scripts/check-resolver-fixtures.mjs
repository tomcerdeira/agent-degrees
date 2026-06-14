#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import YAML from "yaml";

const root = process.cwd();
const degreesDir = path.join(root, "degrees");
const resolverCasesPath = path.join(root, "fixtures", "resolver-cases.jsonc");

function stripJsonComments(source) {
  return source.replace(/^\s*\/\/.*$/gm, "");
}

function splitDegreeFile(source, filePath) {
  if (!source.startsWith("---\n")) {
    throw new Error(`${filePath}: missing opening frontmatter delimiter`);
  }

  const end = source.indexOf("\n---", 4);
  if (end === -1) {
    throw new Error(`${filePath}: missing closing frontmatter delimiter`);
  }

  return source.slice(4, end).trim();
}

async function loadDegrees() {
  const entries = await readdir(degreesDir, { withFileTypes: true });
  const packages = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const degrees = [];

  for (const packageName of packages) {
    const filePath = path.join("degrees", packageName, "DEGREE.md");
    const source = await readFile(path.join(degreesDir, packageName, "DEGREE.md"), "utf8");
    const frontmatter = splitDegreeFile(source, filePath);
    degrees.push(YAML.parse(frontmatter));
  }

  return degrees;
}

async function loadCases() {
  const source = await readFile(resolverCasesPath, "utf8");
  return JSON.parse(stripJsonComments(source));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function globToRegExp(pattern) {
  let source = "";

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];

    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else {
      source += escapeRegExp(char);
    }
  }

  return new RegExp(`^${source}$`, "i");
}

function includesPhrase(text, phrase) {
  return text.toLowerCase().includes(phrase.toLowerCase());
}

function scoreDegree(testCase, degree) {
  const taskText = testCase.task ?? "";
  const files = testCase.repoSignals?.files ?? [];
  const commands = testCase.commands ?? [];
  const activation = degree.activation;
  const promptSignals = activation.promptSignals;
  const matches = {
    pathPatterns: [],
    commandPatterns: [],
    promptSignals: []
  };
  let score = 0;

  for (const pattern of activation.pathPatterns) {
    const regex = globToRegExp(pattern);
    if (files.some((file) => regex.test(file))) {
      matches.pathPatterns.push(pattern);
      score += 3;
    }
  }

  for (const pattern of activation.commandPatterns) {
    const regex = new RegExp(pattern, "i");
    if (commands.some((command) => regex.test(command))) {
      matches.commandPatterns.push(pattern);
      score += 2;
    }
  }

  for (const phrase of promptSignals.phrases) {
    if (includesPhrase(taskText, phrase)) {
      matches.promptSignals.push(phrase);
      score += 2;
    }
  }

  for (const phrase of promptSignals.anyOf) {
    if (includesPhrase(taskText, phrase)) {
      matches.promptSignals.push(phrase);
      score += 1;
    }
  }

  for (const group of promptSignals.allOf) {
    if (group.every((phrase) => includesPhrase(taskText, phrase))) {
      matches.promptSignals.push(group.join(" + "));
      score += group.length + 1;
    }
  }

  for (const phrase of promptSignals.noneOf) {
    if (includesPhrase(taskText, phrase)) {
      score -= 3;
    }
  }

  return {
    degreeId: degree.id,
    minScore: activation.minScore,
    score,
    matches
  };
}

function resolveCase(testCase, degrees) {
  const scored = degrees
    .map((degree) => scoreDegree(testCase, degree))
    .sort((a, b) => b.score - a.score || a.degreeId.localeCompare(b.degreeId));

  const eligible = scored.filter((result) => result.score >= result.minScore);
  if (eligible.length === 0) {
    const hasWeakSignal = scored.some((result) => result.score > 0);
    return {
      decision: hasWeakSignal ? "ask" : "none",
      primaryDegree: null,
      secondaryDegree: null,
      scored
    };
  }

  const primary = eligible[0];
  const secondary = eligible[1];

  if (secondary && secondary.score >= secondary.minScore && secondary.score >= primary.score * 0.6) {
    return {
      decision: "compose",
      primaryDegree: primary.degreeId,
      secondaryDegree: secondary.degreeId,
      scored
    };
  }

  return {
    decision: "select",
    primaryDegree: primary.degreeId,
    secondaryDegree: null,
    scored
  };
}

function expectedDegreesMatch(actual, expected) {
  return (
    actual.decision === expected.decision &&
    actual.primaryDegree === expected.primaryDegree &&
    actual.secondaryDegree === expected.secondaryDegree
  );
}

function formatTopScores(scored) {
  return scored
    .slice(0, 3)
    .map((result) => `${result.degreeId}:${result.score}`)
    .join(", ");
}

async function main() {
  const degrees = await loadDegrees();
  const cases = await loadCases();
  const failures = [];

  for (const testCase of cases) {
    const actual = resolveCase(testCase, degrees);
    const pass = expectedDegreesMatch(actual, testCase.expected);

    if (pass) {
      console.log(`PASS ${testCase.name} -> ${actual.decision}`);
      continue;
    }

    failures.push({
      name: testCase.name,
      expected: testCase.expected,
      actual
    });

    console.error(`FAIL ${testCase.name}`);
    console.error(`  expected: ${testCase.expected.decision} ${testCase.expected.primaryDegree ?? "-"} ${testCase.expected.secondaryDegree ?? "-"}`);
    console.error(`  actual:   ${actual.decision} ${actual.primaryDegree ?? "-"} ${actual.secondaryDegree ?? "-"}`);
    console.error(`  scores:   ${formatTopScores(actual.scored)}`);
  }

  if (failures.length > 0) {
    console.error(`\nResolver fixture check failed (${failures.length}/${cases.length}).`);
    process.exit(1);
  }

  console.log(`Resolver fixture check passed (${cases.length} cases).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
