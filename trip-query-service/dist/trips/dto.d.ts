export type LatLng = {
    lat: number;
    lng: number;
};
export declare class QuoteDto {
    origin: LatLng;
    destination: LatLng;
    serviceType?: string;
}
export declare class CreateTripDto {
    origin: LatLng;
    destination: LatLng;
    note?: string;
    paymentMethodId?: string;
}
export declare class CancelDto {
    reasonCode: string;
    note?: string;
}
export declare class RateDto {
    stars: number;
    comment?: string;
}
export declare class FinishDto {
    actualDistanceKm: number;
    actualDurationMin: number;
}
