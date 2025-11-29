import { MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
export declare function emitEvent(tripId: string, type: string, data: any): void;
export declare class TripsSSEController {
    events(tripId: string): Observable<MessageEvent>;
}
