/* Namespace for the core modules that are copied unchanged from JSON Studio (find.js, editing.js, textdiff.js),
 * so the global keeps its original name, JSS. Everything MD Studio adds lives next to it (mdtransform.js, ...). */
(function (root) {
  'use strict';
  root.JSS = root.JSS || {};
})(typeof self !== 'undefined' ? self : globalThis);
