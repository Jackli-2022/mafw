"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toolExecutedHook = toolExecutedHook;
const observation_capture_1 = require("./observation-capture");
async function toolExecutedHook(hookContext) {
    const { toolName, output, projectDir } = hookContext;
    if (output.length > 1000) {
        const truncated = output.length > 2000 ? output.slice(0, 500) + '\n... [TRUNCATED] ...\n' + output.slice(-500) : output;
    }
    await (0, observation_capture_1.captureObservation)({ toolName, output, args: '' });
}
//# sourceMappingURL=tool-executed.js.map