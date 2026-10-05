// Node / JavaScriptCore runner: `node tests/run.mjs`
import { runTests } from './tests.js';

const log = typeof console !== 'undefined' ? (...a) => console.log(...a) : print;
const { failed } = await runTests(log);
if (failed && typeof process !== 'undefined') process.exit(1);
