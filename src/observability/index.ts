/**
 * @fileoverview Observability Module Exports
 *
 * This module provides a comprehensive observability stack for the Prompt Vault application,
 * including structured logging, telemetry/metrics collection, health monitoring, and
 * distributed tracing capabilities.
 *
 * Key Components:
 * - Structured Logging: Consistent, searchable log format with context and correlation IDs
 * - Telemetry: Metrics collection and performance monitoring with OpenTelemetry compatibility
 * - Health Checks: Application health monitoring with liveness and readiness indicators
 * - HTTP Instrumentation: Automatic tracing and metrics for HTTP requests
 * - Runtime Bootstrap: Environment-based configuration and initialization
 *
 * All components are designed to be production-ready with minimal performance overhead
 * and support for multiple output formats (console, files, remote collectors).
 *
 * @example
 * ```typescript
 * import { bootstrapObservabilityFromEnv } from './observability';
 *
 * const observability = bootstrapObservabilityFromEnv({
 *   serviceName: 'my-service',
 *   serviceVersion: '1.0.0'
 * });
 *
 * observability.logger.info('Service started', { port: 3000 });
 * observability.telemetry.recordEvent('service_startup');
 * ```
 */

// Logger exports
export type { LogLevel, LogFields, LoggerOptions } from "./logger.js";
export { StructuredLogger, createLoggerFromEnv } from "./logger.js";

// Telemetry exports
export { MetricRegistry, createTelemetry, createNoopTelemetry } from "./telemetry.js";
export type { Telemetry, TelemetrySpanAttributes } from "./telemetry.js";

// Health monitoring exports
export { createHealthServer, createHealthIndicator } from "./healthServer.js";

// Runtime bootstrap exports
export { bootstrapObservabilityFromEnv } from "./runtime.js";

// HTTP instrumentation exports
export { createHttpMetricsMiddleware } from "./httpInstrumentation.js";
export { createHttpTracingMiddleware } from "./httpTracing.js";
