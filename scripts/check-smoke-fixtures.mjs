import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = process.cwd();
const manifestPath = path.join(root, "tests", "smoke", "manifest.json");

function fail(message) {
  console.error(`SMOKE FIXTURE ERROR: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(manifestPath)) {
  fail("tests/smoke/manifest.json is missing");
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (!manifest || !Array.isArray(manifest.cases) || manifest.cases.length === 0) {
  fail("manifest must contain a non-empty cases array");
}

for (const testCase of manifest.cases) {
  if (!testCase || typeof testCase !== "object") {
    fail("each case must be an object");
  }
  if (!testCase.id || !testCase.file) {
    fail("each case must include id and file");
  }

  const casePath = path.join(root, testCase.file);
  if (!fs.existsSync(casePath)) {
    fail(`missing case file: ${testCase.file}`);
  }

  const source = fs.readFileSync(casePath, "utf8");
  try {
    new vm.Script(source, { filename: testCase.file });
  } catch (error) {
    fail(`syntax error in ${testCase.file}: ${error.message}`);
  }

  if (!Array.isArray(testCase.requiredApis) || testCase.requiredApis.length === 0) {
    fail(`case ${testCase.id} must declare requiredApis`);
  }

  if (!Array.isArray(testCase.frames) || testCase.frames.length === 0) {
    fail(`case ${testCase.id} must declare at least one frame`);
  }

  if (Array.isArray(testCase.assets)) {
    for (const asset of testCase.assets) {
      const assetPath = path.join(root, asset);
      if (!fs.existsSync(assetPath)) {
        fail(`missing asset for ${testCase.id}: ${asset}`);
      }
    }
  }
}

console.log(`Smoke fixture validation passed for ${manifest.cases.length} cases.`);
