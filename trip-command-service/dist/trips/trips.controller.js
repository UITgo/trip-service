"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TripsController = void 0;
const common_1 = require("@nestjs/common");
const trips_service_1 = require("./trips.service");
const dto_1 = require("./dto");
let TripsController = class TripsController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    quote(dto) {
        return this.svc.quote(dto);
    }
    create(req, dto) {
        const passengerId = req.headers['x-user-id'] || 'u_pass_dev';
        return this.svc.create(passengerId, dto);
    }
    get(id) {
        return this.svc.get(id);
    }
    cancel(req, id, dto) {
        const userId = req.headers['x-user-id'] || 'unknown';
        return this.svc.cancel(id, userId, dto);
    }
    rate(req, id, dto) {
        const userId = req.headers['x-user-id'] || 'unknown';
        return this.svc.rate(id, userId, dto);
    }
    accept(req, id) {
        const driverId = req.headers['x-user-id'] || 'driver_dev';
        return this.svc.accept(id, driverId);
    }
    decline(req, id) {
        const driverId = req.headers['x-user-id'] || 'driver_dev';
        return this.svc.decline(id, driverId);
    }
    arrive(id) {
        return this.svc.arrive(id);
    }
    start(id) {
        return this.svc.start(id);
    }
    finish(id, b) {
        return this.svc.finish(id, b);
    }
};
exports.TripsController = TripsController;
__decorate([
    (0, common_1.Post)('quote'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.QuoteDto]),
    __metadata("design:returntype", void 0)
], TripsController.prototype, "quote", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, dto_1.CreateTripDto]),
    __metadata("design:returntype", void 0)
], TripsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(':tripId'),
    __param(0, (0, common_1.Param)('tripId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], TripsController.prototype, "get", null);
__decorate([
    (0, common_1.Post)(':tripId/cancel'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('tripId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, dto_1.CancelDto]),
    __metadata("design:returntype", void 0)
], TripsController.prototype, "cancel", null);
__decorate([
    (0, common_1.Post)(':tripId/rate'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('tripId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, dto_1.RateDto]),
    __metadata("design:returntype", void 0)
], TripsController.prototype, "rate", null);
__decorate([
    (0, common_1.Post)(':tripId/accept'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('tripId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], TripsController.prototype, "accept", null);
__decorate([
    (0, common_1.Post)(':tripId/decline'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('tripId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], TripsController.prototype, "decline", null);
__decorate([
    (0, common_1.Post)(':tripId/arrive-pickup'),
    __param(0, (0, common_1.Param)('tripId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], TripsController.prototype, "arrive", null);
__decorate([
    (0, common_1.Post)(':tripId/start'),
    __param(0, (0, common_1.Param)('tripId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], TripsController.prototype, "start", null);
__decorate([
    (0, common_1.Post)(':tripId/finish'),
    __param(0, (0, common_1.Param)('tripId')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, dto_1.FinishDto]),
    __metadata("design:returntype", void 0)
], TripsController.prototype, "finish", null);
exports.TripsController = TripsController = __decorate([
    (0, common_1.Controller)('trips'),
    __metadata("design:paramtypes", [trips_service_1.TripsService])
], TripsController);
//# sourceMappingURL=trips.controller.js.map