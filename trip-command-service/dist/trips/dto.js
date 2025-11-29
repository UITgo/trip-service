"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FinishDto = exports.RateDto = exports.CancelDto = exports.CreateTripDto = exports.QuoteDto = void 0;
class QuoteDto {
    origin;
    destination;
    serviceType;
}
exports.QuoteDto = QuoteDto;
class CreateTripDto {
    origin;
    destination;
    note;
    paymentMethodId;
}
exports.CreateTripDto = CreateTripDto;
class CancelDto {
    reasonCode;
    note;
}
exports.CancelDto = CancelDto;
class RateDto {
    stars;
    comment;
}
exports.RateDto = RateDto;
class FinishDto {
    actualDistanceKm;
    actualDurationMin;
}
exports.FinishDto = FinishDto;
//# sourceMappingURL=dto.js.map