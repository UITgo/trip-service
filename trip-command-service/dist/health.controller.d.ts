export declare class HealthController {
    ok(): Promise<{
        ok: boolean;
        service: string;
    }>;
}
