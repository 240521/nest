"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NoopGraphInspector = void 0;
const graph_inspector_1 = require("./graph-inspector");
const noop = () => { };
exports.NoopGraphInspector = new Proxy(graph_inspector_1.GraphInspector.prototype, {
    get: () => noop,
});
