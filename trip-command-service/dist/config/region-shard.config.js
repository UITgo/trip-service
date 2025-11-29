"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REGION_SHARD_CONFIG = void 0;
exports.getDriverStreamUrl = getDriverStreamUrl;
exports.REGION_SHARD_CONFIG = {
    HCM: {
        driverStreamBaseUrl: process.env.DRIVER_STREAM_HCM_URL || 'http://driver-stream-hcm:8080',
    },
    HN: {
        driverStreamBaseUrl: process.env.DRIVER_STREAM_HN_URL || 'http://driver-stream-hn:8080',
    },
};
function getDriverStreamUrl(cityCode) {
    if (!cityCode) {
        return exports.REGION_SHARD_CONFIG.HCM.driverStreamBaseUrl;
    }
    const config = exports.REGION_SHARD_CONFIG[cityCode.toUpperCase()];
    if (!config) {
        return exports.REGION_SHARD_CONFIG.HCM.driverStreamBaseUrl;
    }
    return config.driverStreamBaseUrl;
}
//# sourceMappingURL=region-shard.config.js.map