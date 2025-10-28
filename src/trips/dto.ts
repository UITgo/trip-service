export type LatLng = { lat: number; lng: number };

export class QuoteDto {
  origin!: LatLng;
  destination!: LatLng;
  serviceType?: string;
}

export class CreateTripDto {
  origin!: LatLng;
  destination!: LatLng;
  note?: string;
  paymentMethodId?: string;
}

export class CancelDto {
  reasonCode!: string;
  note?: string;
}

export class RateDto {
  stars!: number; 
  comment?: string;
}

export class FinishDto {
  actualDistanceKm!: number;
  actualDurationMin!: number;
}
