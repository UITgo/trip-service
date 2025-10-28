import { Controller, MessageEvent, Param, Sse } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

const bus = new Map<string, Subject<MessageEvent>>();
export function emitEvent(tripId: string, type: string, data: any) {
  if (!bus.has(tripId)) bus.set(tripId, new Subject<MessageEvent>());
  bus.get(tripId)!.next({ type, data } as any);
}

@Controller('v1/trips')
export class TripsSSEController {
  @Sse(':tripId/events')
  events(@Param('tripId') tripId: string): Observable<MessageEvent> {
    if (!bus.has(tripId)) bus.set(tripId, new Subject<MessageEvent>());
    return bus.get(tripId)!;
  }
}
