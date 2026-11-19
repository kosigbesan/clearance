// Caching DOM stub for RENDER verification of a single-file HTML app.
//
// templates/dom_stub.js returns a FRESH element on every getElementById call,
// so anything a render function writes is discarded and cannot be asserted.
// This variant memoizes elements by id, so after calling renderX() you can
// read what it wrote:
//
//     renderLoans();
//     global.__els["loans-list"].innerHTML   // the HTML that was rendered
//
// Prepend this to the app's <script>, then append a render test. Run it with
// scripts/build_and_run_render_tests.py (which prepends this automatically).
// Extend the stubs only as far as the app actually touches at load time.

const _cache = {};
function _el(id) {
  if (!_cache[id]) {
    _cache[id] = {
      id, style: {}, textContent: "", innerHTML: "", value: "", checked: false, dataset: {},
      addEventListener() {}, setAttribute() {},
      classList: { toggle() {}, add() {}, remove() {} },
    };
  }
  return _cache[id];
}

global.document = { getElementById: _el, querySelectorAll: () => [], addEventListener() {} };
global.window = { scrollTo() {}, print() {} };
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.navigator = {};
global.alert = () => {}; global.confirm = () => false; global.prompt = () => null;
global.__els = _cache;
