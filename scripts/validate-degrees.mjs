#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const schemaPath = path.join(root, "schema", "degree.schema.json");
const degreesDir = path.join(root, "degrees");

const errors = [];

function fail(message) {
  errors.push(message);
}

function parseScalar(value) {
  const trimmed = value.trim();

  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);

  const quoted = trimmed.match(/^(['"])(.*)\1$/);
  if (quoted) return quoted[2];

  return trimmed;
}

function parseInlineKeyValue(line) {
  const index = line.indexOf(":");
  if (index === -1) return null;

  const key = line.slice(0, index).trim();
  const rawValue = line.slice(index + 1).trim();
  if (!key) return null;

  return [key, rawValue === "" ? undefined : parseScalar(rawValue)];
}

function parseFrontmatterYaml(source, filePath) {
  const data = {};
  const lines = source.split(/\r?\n/);
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.trim() === "" || line.trim().startsWith("#")) {
      index += 1;
      continue;
    }

    if (/^\s/.test(line)) {
      fail(`${filePath}: unexpected indented top-level line: ${line}`);
      index += 1;
      continue;
    }

    const pair = parseInlineKeyValue(line);
    if (!pair) {
      fail(`${filePath}: expected key/value line: ${line}`);
      index += 1;
      continue;
    }

    const [key, value] = pair;

    if (value !== undefined) {
      data[key] = value;
      index += 1;
      continue;
    }

    const items = [];
    index += 1;

    while (index < lines.length) {
      const itemLine = lines[index];

      if (itemLine.trim() === "" || itemLine.trim().startsWith("#")) {
        index += 1;
        continue;
      }

      if (!itemLine.startsWith("  - ")) break;

      const firstItem = itemLine.slice(4);
      const objectPair = parseInlineKeyValue(firstItem);

      if (objectPair) {
        const object = {};
        object[objectPair[0]] = objectPair[1] ?? "";
        index += 1;

        while (index < lines.length) {
          const nestedLine = lines[index];
          if (nestedLine.trim() === "" || nestedLine.trim().startsWith("#")) {
            index += 1;
            continue;
          }
          if (!nestedLine.startsWith("    ")) break;
          if (nestedLine.startsWith("    - ")) {
            fail(`${filePath}: nested arrays are not supported: ${nestedLine}`);
            index += 1;
            continue;
          }

          const nestedPair = parseInlineKeyValue(nestedLine.trim());
          if (!nestedPair) {
            fail(`${filePath}: expected nested key/value line: ${nestedLine}`);
            index += 1;
            continue;
          }

          object[nestedPair[0]] = nestedPair[1] ?? "";
          index += 1;
        }

        items.push(object);
        continue;
      }

      items.push(parseScalar(firstItem));
      index += 1;
    }

    data[key] = items;
  }

  return data;
}

function splitDegreeFile(source, filePath) {
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

function validateDegree(data, filePath, schema, seenIds) {
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
  expectStringArray(data, "activationHints", filePath);

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
    if (seenIds.has(data.id)) fail(`${filePath}: duplicate degree id ${data.id}`);
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

async function main() {
  let schema;

  try {
    schema = JSON.parse(await readFile(schemaPath, "utf8"));
  } catch (error) {
    fail(`schema/degree.schema.json: invalid JSON: ${error.message}`);
  }

  if (!schema) return finish();

  const entries = await readdir(degreesDir, { withFileTypes: true });
  const degreeFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".degree.md"))
    .map((entry) => entry.name)
    .sort();

  if (degreeFiles.length === 0) {
    fail("degrees/: no .degree.md files found");
  }

  const seenIds = new Set();

  for (const fileName of degreeFiles) {
    const filePath = path.join("degrees", fileName);
    const absolutePath = path.join(degreesDir, fileName);
    const source = await readFile(absolutePath, "utf8");
    const parts = splitDegreeFile(source, filePath);
    if (!parts) continue;

    const data = parseFrontmatterYaml(parts.frontmatter, filePath);
    validateDegree(data, filePath, schema, seenIds);
  }

  finish(degreeFiles.length);
}

function finish(count = 0) {
  if (errors.length > 0) {
    console.error(`Degree validation failed with ${errors.length} error(s):`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log(`Degree validation passed (${count} degree files).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
