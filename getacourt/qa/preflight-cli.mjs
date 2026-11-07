// Reads one bounded local JSON file; stdout only. No .env/credential lookup or IO writes.
import {readFileSync,statSync} from "node:fs";
import {evaluatePreflight} from "./acceptance-preflight.mjs";
const args=process.argv.slice(2);
try{
  if(args.length!==6||args[0]!=="--input"||args[2]!=="--sha"||args[4]!=="--now")throw Error();
  if(statSync(args[1]).size>65536)throw Error();
  const report=evaluatePreflight(JSON.parse(readFileSync(args[1],"utf8")),{sha:args[3],now:args[5]});
  console.log(JSON.stringify(report,null,2));
  process.exitCode=report.checks.some(check=>check.blockers.length)?2:0;
}catch{
  // Parsing errors must not print supplied input, file paths or secret-like values.
  console.error("PREFLIGHT_INPUT_REJECTED: use --input LOCAL_JSON --sha EXACT_HEAD --now UTC_TIMESTAMP; no secrets.");
  process.exitCode=1;
}
