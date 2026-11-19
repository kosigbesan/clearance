// Minimal browser stub for running a single-file app's <script> under Node.
// Prepend this (or the equivalent in scripts/build_and_run_logic_tests.py) to
// the app script so top-level DOM calls do not throw, then append your tests.
// Extend the stubs only as far as the app actually touches at load time.

const _el = () => ({
  textContent: "", innerHTML: "", value: "", checked: false, dataset: {},
  addEventListener() {}, setAttribute() {},
  classList: { toggle() {}, add() {}, remove() {} },
});

global.document = {
  getElementById: _el,
  querySelectorAll: () => [],
  addEventListener() {},
};
global.window = { scrollTo() {}, print() {} };
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.navigator = {};
global.alert = () => {};
global.confirm = () => false;
global.prompt = () => null;
