"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Http = void 0;
const axios_1 = __importDefault(require("axios"));
exports.Http = axios_1.default.create({ timeout: 8000 });
//# sourceMappingURL=http.js.map