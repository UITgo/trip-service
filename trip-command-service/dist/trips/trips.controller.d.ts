import { TripsService } from './trips.service';
import { CancelDto, CreateTripDto, FinishDto, QuoteDto, RateDto } from './dto';
export declare class TripsController {
    private svc;
    constructor(svc: TripsService);
    quote(dto: QuoteDto): Promise<{
        distanceKm: number;
        durationMin: number;
        etaPickupMin: number;
        fare: {
            base: number;
            distance: number;
            time: number;
            total: number;
        };
    }>;
    create(req: any, dto: CreateTripDto): Promise<any>;
    cancel(req: any, id: string, dto: CancelDto): Promise<{
        success: boolean;
    }>;
    rate(req: any, id: string, dto: RateDto): Promise<{
        ok: boolean;
    }>;
    accept(req: any, id: string): Promise<{
        ok: boolean;
        reason: string;
    } | {
        ok: boolean;
        reason?: undefined;
    }>;
    decline(req: any, id: string): Promise<{
        ok: boolean;
    }>;
    arrive(id: string): Promise<{
        ok: boolean;
    }>;
    start(id: string): Promise<{
        ok: boolean;
    }>;
    finish(id: string, b: FinishDto): Promise<{
        finalFareTotal: number;
        ok: boolean;
    }>;
}
