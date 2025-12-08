import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryAuditLogger } from "../src/web/audit.js";

describe("InMemoryAuditLogger", () => {
    let auditLogger: InMemoryAuditLogger;

    beforeEach(() => {
        auditLogger = new InMemoryAuditLogger({ maxEvents: 100 });
    });

    describe("event logging", () => {
        it("should log an event", () => {
            auditLogger.log({
                userId: "user-123",
                action: "read",
                resource: "prompt:abc",
                result: "success",
            });

            const events = auditLogger.getEvents({});
            expect(events).toHaveLength(1);

            const event = events[0];
            expect(event.id).toBeTypeOf("string");
            expect(event.timestamp).toBeTypeOf("string");
            expect(event.userId).toBe("user-123");
            expect(event.action).toBe("read");
            expect(event.resource).toBe("prompt:abc");
            expect(event.result).toBe("success");
        });

        it("should log multiple events", () => {
            auditLogger.log({
                userId: "user-1",
                action: "create",
                resource: "prompt:1",
                result: "success",
            });

            auditLogger.log({
                userId: "user-2",
                action: "delete",
                resource: "prompt:2",
                result: "failure",
            });

            const events = auditLogger.getEvents({});

            expect(events).toHaveLength(2);
            expect(events[0].userId).toBe("user-1");
            expect(events[1].userId).toBe("user-2");
        });

        it("should include optional fields", () => {
            auditLogger.log({
                userId: "user-123",
                action: "update",
                resource: "prompt:abc",
                result: "success",
                details: { fields: ["title", "content"] },
                ipAddress: "192.168.1.1",
                userAgent: "Test Browser/1.0",
            });

            const events = auditLogger.getEvents({});
            const event = events[0];

            expect(event.details).toEqual({ fields: ["title", "content"] });
            expect(event.ipAddress).toBe("192.168.1.1");
            expect(event.userAgent).toBe("Test Browser/1.0");
        });
    });

    describe("event filtering", () => {
        beforeEach(() => {
            auditLogger.log({
                userId: "user-1",
                action: "create",
                resource: "prompt:1",
                result: "success",
            });

            auditLogger.log({
                userId: "user-2",
                action: "read",
                resource: "prompt:2",
                result: "success",
            });

            auditLogger.log({
                userId: "user-1",
                action: "delete",
                resource: "prompt:3",
                result: "failure",
            });
        });

        it("should filter by userId", () => {
            const events = auditLogger.getEvents({ userId: "user-1" });

            expect(events).toHaveLength(2);
            expect(events.every((e) => e.userId === "user-1")).toBe(true);
        });

        it("should filter by action", () => {
            const events = auditLogger.getEvents({ action: "delete" });

            expect(events).toHaveLength(1);
            expect(events[0].action).toBe("delete");
        });

        it("should filter by result", () => {
            const events = auditLogger.getEvents({ result: "failure" });

            expect(events).toHaveLength(1);
            expect(events[0].result).toBe("failure");
        });

        it("should filter by resource pattern", () => {
            const events = auditLogger.getEvents({ resource: "prompt:1" });

            expect(events).toHaveLength(1);
            expect(events[0].resource).toBe("prompt:1");
        });

        it("should combine filters", () => {
            const events = auditLogger.getEvents({
                userId: "user-1",
                result: "success",
            });

            expect(events).toHaveLength(1);
            expect(events[0].userId).toBe("user-1");
            expect(events[0].action).toBe("create");
            expect(events[0].result).toBe("success");
        });

        it("should limit results", () => {
            const events = auditLogger.getEvents({ limit: 2 });

            expect(events).toHaveLength(2);
        });
    });

    describe("max events limit", () => {
        it("should respect max events limit", () => {
            const smallLogger = new InMemoryAuditLogger({ maxEvents: 5 });

            // Log 10 events
            for (let i = 0; i < 10; i++) {
                smallLogger.log({
                    userId: `user-${i}`,
                    action: "read",
                    resource: `prompt:${i}`,
                    result: "success",
                });
            }

            const events = smallLogger.getEvents({});

            // Should only keep the last 5 events
            expect(events).toHaveLength(5);
            expect(events[0].userId).toBe("user-5");
            expect(events[4].userId).toBe("user-9");
        });
    });
});
