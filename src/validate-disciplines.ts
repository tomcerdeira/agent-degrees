#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import YAML from "yaml";

const root = process.cwd();
const schemaPath = path.join(root, "schema", "discipline.schema.json");
const disciplinesDir = path.join(root, "disciplines");
const resolverCasesPath = path.join(root, "fixtures", "resolver-cases.jsonc");

const errors = [];

function fail(message) {
  errors.push(message);
}

function splitDisciplineFile(source, filePath) {
  if (!source.startsWith("---\n")) {
    fail(`${filePath}: missing opening frontmatter delimiter`);
    return null;
  }

  const end = source.indexOf("\n---", 4);
  if (end === -1) {
    fail(`${filePath}: missing closing frontmatter delimiter`);
    return null;
  }

  const frontmatter = source.slice(4, end).trim();
  const body = source.slice(end + 4).trim();

  if (!frontmatter) fail(`${filePath}: empty frontmatter`);
  if (!body) fail(`${filePath}: empty markdown body`);

  return { frontmatter, body };
}

function parseFrontmatterYaml(source, filePath) {
  try {
    const data = YAML.parse(source);
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      fail(`${filePath}: frontmatter must be a YAML object`);
      return {};
    }
    return data;
  } catch (error) {
    fail(`${filePath}: invalid YAML frontmatter: ${error.message}`);
    return {};
  }
}

function expectString(data, key, filePath) {
  if (typeof data[key] !== "string" || data[key].trim() === "") {
    fail(`${filePath}: ${key} must be a non-empty string`);
  }
}

function expectStringArray(data, key, filePath, { allowEmpty = false } = {}) {
  if (!Array.isArray(data[key])) {
    fail(`${filePath}: ${key} must be an array`);
    return;
  }

  if (!allowEmpty && data[key].length === 0) {
    fail(`${filePath}: ${key} must not be empty`);
  }

  data[key].forEach((item, index) => {
    if (typeof item !== "string" || item.trim() === "") {
      fail(`${filePath}: ${key}[${index}] must be a non-empty string`);
    }
  });

  const unique = new Set(data[key]);
  if (unique.size !== data[key].length) {
    fail(`${filePath}: ${key} must not contain duplicates`);
  }
}

function parseJsonc(source, filePath) {
  const withoutLineComments = source.replace(/^\s*\/\/.*$/gm, "");

  try {
    return JSON.parse(withoutLineComments);
  } catch (error) {
    fail(`${filePath}: invalid JSONC: ${error.message}`);
    return null;
  }
}

function validateDiscipline(data, filePath, schema, seenIds) {
  const allowedKeys = new Set(Object.keys(schema.properties));
  const requiredKeys = schema.required;

  for (const key of requiredKeys) {
    if (!(key in data)) fail(`${filePath}: missing required field ${key}`);
  }

  for (const key of Object.keys(data)) {
    if (!allowedKeys.has(key)) fail(`${filePath}: unknown field ${key}`);
  }

  expectString(data, "id", filePath);
  expectString(data, "name", filePath);
  expectString(data, "version", filePath);
  expectString(data, "description", filePath);
  expectStringArray(data, "includeSkills", filePath);
  expectStringArray(data, "softExcludeSkills", filePath, { allowEmpty: true });

  if ("aliases" in data) expectStringArray(data, "aliases", filePath, { allowEmpty: true });
  if ("notes" in data) expectString(data, "notes", filePath);

  if ("confidenceThreshold" in data) {
    const threshold = data.confidenceThreshold;
    if (typeof threshold !== "number" || threshold < 0 || threshold > 1) {
      fail(`${filePath}: confidenceThreshold must be a number from 0 to 1`);
    }
  }

  if (typeof data.id === "string") {
    const idPattern = new RegExp(schema.properties.id.pattern);
    if (!idPattern.test(data.id)) fail(`${filePath}: id does not match ${idPattern}`);
    if (seenIds.has(data.id)) fail(`${filePath}: duplicate discipline id ${data.id}`);
    seenIds.add(data.id);
  }

  if (typeof data.version === "string") {
    const versionPattern = new RegExp(schema.properties.version.pattern);
    if (!versionPattern.test(data.version)) {
      fail(`${filePath}: version does not match semver pattern`);
    }
  }

  const skillPattern = new RegExp(schema.$defs.skillId.pattern);
  for (const key of ["includeSkills", "softExcludeSkills"]) {
    if (!Array.isArray(data[key])) continue;
    for (const skill of data[key]) {
      if (typeof skill === "string" && !skillPattern.test(skill)) {
        fail(`${filePath}: ${key} contains invalid skill id ${skill}`);
      }
    }
  }

  validateRecommendedTools(data.recommendedTools, filePath, schema);
  validateActivation(data.activation, filePath);
}

function validateRecommendedTools(tools, filePath, schema) {
  if (!Array.isArray(tools)) {
    fail(`${filePath}: recommendedTools must be an array`);
    return;
  }

  const toolPattern = new RegExp(schema.$defs.toolRecommendation.properties.id.pattern);
  const allowedKinds = new Set(schema.$defs.toolRecommendation.properties.kind.enum);
  const allowedKeys = new Set(Object.keys(schema.$defs.toolRecommendation.properties));
  const seen = new Set();

  tools.forEach((tool, index) => {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
      fail(`${filePath}: recommendedTools[${index}] must be an object`);
      return;
    }

    for (const key of schema.$defs.toolRecommendation.required) {
      if (!(key in tool)) fail(`${filePath}: recommendedTools[${index}] missing ${key}`);
    }

    for (const key of Object.keys(tool)) {
      if (!allowedKeys.has(key)) {
        fail(`${filePath}: recommendedTools[${index}] has unknown field ${key}`);
      }
    }

    if (typeof tool.id !== "string" || !toolPattern.test(tool.id)) {
      fail(`${filePath}: recommendedTools[${index}].id is invalid`);
    }

    if (typeof tool.kind !== "string" || !allowedKinds.has(tool.kind)) {
      fail(`${filePath}: recommendedTools[${index}].kind is invalid`);
    }

    if (typeof tool.purpose !== "string" || tool.purpose.trim() === "") {
      fail(`${filePath}: recommendedTools[${index}].purpose must be a non-empty string`);
    }

    if ("when" in tool && (typeof tool.when !== "string" || tool.when.trim() === "")) {
      fail(`${filePath}: recommendedTools[${index}].when must be a non-empty string`);
    }

    if ("optional" in tool && typeof tool.optional !== "boolean") {
      fail(`${filePath}: recommendedTools[${index}].optional must be a boolean`);
    }

    if (typeof tool.id === "string") {
      if (seen.has(tool.id)) fail(`${filePath}: duplicate recommended tool id ${tool.id}`);
      seen.add(tool.id);
    }
  });
}

function validateActivation(activation, filePath) {
  if (!activation || typeof activation !== "object" || Array.isArray(activation)) {
    fail(`${filePath}: activation must be an object`);
    return;
  }

  const allowedKeys = new Set(["pathPatterns", "commandPatterns", "promptSignals", "minScore"]);
  for (const key of Object.keys(activation)) {
    if (!allowedKeys.has(key)) fail(`${filePath}: activation has unknown field ${key}`);
  }

  expectStringArray(activation, "pathPatterns", `${filePath}: activation`, { allowEmpty: true });
  expectStringArray(activation, "commandPatterns", `${filePath}: activation`, { allowEmpty: true });

  if (!("promptSignals" in activation)) {
    fail(`${filePath}: activation missing promptSignals`);
  } else {
    validatePromptSignals(activation.promptSignals, filePath);
  }

  if (!("minScore" in activation)) {
    fail(`${filePath}: activation missing minScore`);
  } else if (typeof activation.minScore !== "number" || activation.minScore < 0) {
    fail(`${filePath}: activation.minScore must be a number greater than or equal to 0`);
  }

  if (Array.isArray(activation.commandPatterns)) {
    activation.commandPatterns.forEach((pattern, index) => {
      if (typeof pattern !== "string") return;
      try {
        new RegExp(pattern);
      } catch (error) {
        fail(`${filePath}: activation.commandPatterns[${index}] is not a valid RegExp: ${error.message}`);
      }
    });
  }
}

function validatePromptSignals(promptSignals, filePath) {
  if (!promptSignals || typeof promptSignals !== "object" || Array.isArray(promptSignals)) {
    fail(`${filePath}: activation.promptSignals must be an object`);
    return;
  }

  const allowedKeys = new Set(["phrases", "allOf", "anyOf", "noneOf"]);
  for (const key of Object.keys(promptSignals)) {
    if (!allowedKeys.has(key)) fail(`${filePath}: activation.promptSignals has unknown field ${key}`);
  }

  expectStringArray(promptSignals, "phrases", `${filePath}: activation.promptSignals`, { allowEmpty: true });
  expectStringArray(promptSignals, "anyOf", `${filePath}: activation.promptSignals`, { allowEmpty: true });
  expectStringArray(promptSignals, "noneOf", `${filePath}: activation.promptSignals`, { allowEmpty: true });

  if (!Array.isArray(promptSignals.allOf)) {
    fail(`${filePath}: activation.promptSignals.allOf must be an array`);
    return;
  }

  promptSignals.allOf.forEach((group, groupIndex) => {
    if (!Array.isArray(group) || group.length === 0) {
      fail(`${filePath}: activation.promptSignals.allOf[${groupIndex}] must be a non-empty string array`);
      return;
    }

    group.forEach((item, itemIndex) => {
      if (typeof item !== "string" || item.trim() === "") {
        fail(`${filePath}: activation.promptSignals.allOf[${groupIndex}][${itemIndex}] must be a non-empty string`);
      }
    });

    if (new Set(group).size !== group.length) {
      fail(`${filePath}: activation.promptSignals.allOf[${groupIndex}] must not contain duplicates`);
    }
  });
}

async function main() {
  let schema;

  try {
    schema = JSON.parse(await readFile(schemaPath, "utf8"));
  } catch (error) {
    fail(`schema/discipline.schema.json: invalid JSON: ${error.message}`);
  }

  if (!schema) return finish();

  const entries = await readdir(disciplinesDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".discipline.md")) {
      fail(`disciplines/${entry.name}: legacy flat discipline files are not supported; use disciplines/<id>/DISCIPLINE.md`);
    }
  }

  const disciplinePackages = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  if (disciplinePackages.length === 0) {
    fail("disciplines/: no discipline packages found; expected disciplines/<id>/DISCIPLINE.md");
  }

  const seenIds = new Set();

  for (const packageName of disciplinePackages) {
    const packagePath = path.join("disciplines", packageName);
    const filePath = path.join(packagePath, "DISCIPLINE.md");
    const absolutePath = path.join(disciplinesDir, packageName, "DISCIPLINE.md");
    let source;

    try {
      source = await readFile(absolutePath, "utf8");
    } catch (error) {
      fail(`${packagePath}: missing DISCIPLINE.md entrypoint`);
      continue;
    }

    const parts = splitDisciplineFile(source, filePath);
    if (!parts) continue;

    const data = parseFrontmatterYaml(parts.frontmatter, filePath);
    if (data.id !== packageName) {
      fail(`${filePath}: frontmatter id must match package folder name ${packageName}`);
    }
    validateDiscipline(data, filePath, schema, seenIds);
  }

  await validateResolverCases(seenIds);

  finish(disciplinePackages.length);
}

async function validateResolverCases(disciplineIds) {
  const filePath = path.join("fixtures", "resolver-cases.jsonc");
  let source;

  try {
    source = await readFile(resolverCasesPath, "utf8");
  } catch (error) {
    fail(`${filePath}: missing resolver fixture cases`);
    return;
  }

  const cases = parseJsonc(source, filePath);
  if (!Array.isArray(cases)) {
    fail(`${filePath}: root must be an array`);
    return;
  }

  if (cases.length === 0) {
    fail(`${filePath}: must contain at least one case`);
  }

  const caseNames = new Set();
  const decisions = new Set(["select", "compose", "ask", "none"]);

  cases.forEach((testCase, index) => {
    const casePath = `${filePath}[${index}]`;

    if (!testCase || typeof testCase !== "object" || Array.isArray(testCase)) {
      fail(`${casePath}: case must be an object`);
      return;
    }

    const allowedCaseKeys = new Set(["name", "task", "repoSignals", "commands", "expected"]);
    for (const key of Object.keys(testCase)) {
      if (!allowedCaseKeys.has(key)) fail(`${casePath}: unknown field ${key}`);
    }

    expectString(testCase, "name", casePath);
    expectString(testCase, "task", casePath);

    if (typeof testCase.name === "string") {
      if (caseNames.has(testCase.name)) fail(`${casePath}: duplicate case name ${testCase.name}`);
      caseNames.add(testCase.name);
    }

    validateRepoSignals(testCase.repoSignals, casePath);
    expectStringArray(testCase, "commands", casePath, { allowEmpty: true });
    validateExpectedResolverCase(testCase.expected, casePath, decisions, disciplineIds);
  });
}

function validateRepoSignals(repoSignals, casePath) {
  if (!repoSignals || typeof repoSignals !== "object" || Array.isArray(repoSignals)) {
    fail(`${casePath}: repoSignals must be an object`);
    return;
  }

  const allowedKeys = new Set(["files"]);
  for (const key of Object.keys(repoSignals)) {
    if (!allowedKeys.has(key)) fail(`${casePath}: repoSignals has unknown field ${key}`);
  }

  expectStringArray(repoSignals, "files", `${casePath}: repoSignals`, { allowEmpty: true });
}

function validateExpectedResolverCase(expected, casePath, decisions, disciplineIds) {
  if (!expected || typeof expected !== "object" || Array.isArray(expected)) {
    fail(`${casePath}: expected must be an object`);
    return;
  }

  const allowedKeys = new Set([
    "decision",
    "primaryDiscipline",
    "secondaryDiscipline",
    "choices",
    "question",
    "matchedSignals",
    "reason"
  ]);

  for (const key of Object.keys(expected)) {
    if (!allowedKeys.has(key)) fail(`${casePath}: expected has unknown field ${key}`);
  }

  if (!decisions.has(expected.decision)) {
    fail(`${casePath}: expected.decision must be one of ${Array.from(decisions).join(", ")}`);
  }

  validateOptionalDisciplineId(expected.primaryDiscipline, `${casePath}: expected.primaryDiscipline`, disciplineIds);
  validateOptionalDisciplineId(expected.secondaryDiscipline, `${casePath}: expected.secondaryDiscipline`, disciplineIds);
  validateMatchedSignals(expected.matchedSignals, casePath);
  expectString(expected, "reason", `${casePath}: expected`);

  if (expected.decision === "select") {
    if (!expected.primaryDiscipline) fail(`${casePath}: select cases must set expected.primaryDiscipline`);
    if (expected.secondaryDiscipline !== null) fail(`${casePath}: select cases must set expected.secondaryDiscipline to null`);
  }

  if (expected.decision === "compose") {
    if (!expected.primaryDiscipline) fail(`${casePath}: compose cases must set expected.primaryDiscipline`);
    if (!expected.secondaryDiscipline) fail(`${casePath}: compose cases must set expected.secondaryDiscipline`);
  }

  if (expected.decision === "ask") {
    if (expected.primaryDiscipline !== null) fail(`${casePath}: ask cases must set expected.primaryDiscipline to null`);
    if (expected.secondaryDiscipline !== null) fail(`${casePath}: ask cases must set expected.secondaryDiscipline to null`);
    expectStringArray(expected, "choices", `${casePath}: expected`);
    expectString(expected, "question", `${casePath}: expected`);

    if (Array.isArray(expected.choices)) {
      expected.choices.forEach((disciplineId, choiceIndex) => {
        if (!disciplineIds.has(disciplineId)) {
          fail(`${casePath}: expected.choices[${choiceIndex}] references unknown discipline ${disciplineId}`);
        }
      });
    }
  }

  if (expected.decision === "none") {
    if (expected.primaryDiscipline !== null) fail(`${casePath}: none cases must set expected.primaryDiscipline to null`);
    if (expected.secondaryDiscipline !== null) fail(`${casePath}: none cases must set expected.secondaryDiscipline to null`);
  }
}

function validateOptionalDisciplineId(value, fieldPath, disciplineIds) {
  if (value === null) return;

  if (typeof value !== "string" || value.trim() === "") {
    fail(`${fieldPath} must be a discipline id string or null`);
    return;
  }

  if (!disciplineIds.has(value)) {
    fail(`${fieldPath} references unknown discipline ${value}`);
  }
}

function validateMatchedSignals(matchedSignals, casePath) {
  if (!matchedSignals || typeof matchedSignals !== "object" || Array.isArray(matchedSignals)) {
    fail(`${casePath}: expected.matchedSignals must be an object`);
    return;
  }

  const allowedKeys = new Set(["pathPatterns", "commandPatterns", "promptSignals"]);
  for (const key of Object.keys(matchedSignals)) {
    if (!allowedKeys.has(key)) fail(`${casePath}: expected.matchedSignals has unknown field ${key}`);
  }

  expectStringArray(matchedSignals, "pathPatterns", `${casePath}: expected.matchedSignals`, { allowEmpty: true });
  expectStringArray(matchedSignals, "commandPatterns", `${casePath}: expected.matchedSignals`, { allowEmpty: true });
  expectStringArray(matchedSignals, "promptSignals", `${casePath}: expected.matchedSignals`, { allowEmpty: true });
}

function finish(count = 0) {
  if (errors.length > 0) {
    console.error(`Discipline validation failed with ${errors.length} error(s):`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log(`Discipline validation passed (${count} discipline packages).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
