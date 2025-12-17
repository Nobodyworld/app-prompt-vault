import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { StructuredLogger } from "./logger.js";
import { createLoggerFromEnv } from "./logger.js";

type Labels = Record<string, string>;

interface MetricMetadata {
  readonly name: string;
  readonly help: string;
  readonly type: "counter" | "histogram" | "gauge" | "summary";
  readonly labelNames: readonly string[];
}

class CounterMetric {
  private readonly metadata: MetricMetadata;

  private readonly samples = new Map<string, number>();

  public constructor(metadata: MetricMetadata) {
    this.metadata = metadata;
  }

  public increment(labels: Labels = {}, value = 1): void {
    if (value < 0) {
      throw new Error("Counter value cannot be negative");
    }
    const key = this.serializeLabels(labels);
    const current = this.samples.get(key) ?? 0;
    this.samples.set(key, current + value);
  }

  public toPrometheus(): string {
    const lines: string[] = [];
    lines.push(`# HELP ${this.metadata.name} ${this.metadata.help}`);
    lines.push(`# TYPE ${this.metadata.name} counter`);
    for (const [labelKey, value] of this.samples.entries()) {
      const suffix = labelKey.length > 0 ? `{${labelKey}}` : "";
      lines.push(`${this.metadata.name}${suffix} ${value}`);
    }
    return lines.join("\n");
  }

  private serializeLabels(labels: Labels): string {
    const merged: Record<string, string> = {};
    for (const name of this.metadata.labelNames) {
      if (labels[name]) {
        merged[name] = labels[name];
      }
    }
    const entries = Object.entries(merged);
    if (entries.length === 0) {
      return "";
    }
    return entries
      .map(([key, value]) => `${key}="${value.replace(/"/g, '\\"')}"`)
      .join(",");
  }
}

interface HistogramSample {
  readonly buckets: Map<number, number>;
  sum: number;
  count: number;
}

class GaugeMetric {
  private readonly metadata: MetricMetadata;

  private readonly samples = new Map<string, number>();

  public constructor(metadata: MetricMetadata) {
    this.metadata = metadata;
  }

  public set(value: number, labels: Labels = {}): void {
    const key = this.serializeLabels(labels);
    this.samples.set(key, value);
  }

  public increment(labels: Labels = {}, value = 1): void {
    const key = this.serializeLabels(labels);
    const current = this.samples.get(key) ?? 0;
    this.samples.set(key, current + value);
  }

  public decrement(labels: Labels = {}, value = 1): void {
    const key = this.serializeLabels(labels);
    const current = this.samples.get(key) ?? 0;
    this.samples.set(key, current - value);
  }

  public toPrometheus(): string {
    const lines: string[] = [];
    lines.push(`# HELP ${this.metadata.name} ${this.metadata.help}`);
    lines.push(`# TYPE ${this.metadata.name} gauge`);
    for (const [labelKey, value] of this.samples.entries()) {
      const suffix = labelKey.length > 0 ? `{${labelKey}}` : "";
      lines.push(`${this.metadata.name}${suffix} ${value}`);
    }
    return lines.join("\n");
  }

  private serializeLabels(labels: Labels): string {
    const merged: Record<string, string> = {};
    for (const name of this.metadata.labelNames) {
      if (labels[name]) {
        merged[name] = labels[name];
      }
    }
    const entries = Object.entries(merged);
    if (entries.length === 0) {
      return "";
    }
    return entries
      .map(([key, value]) => `${key}="${value.replace(/"/g, '\\"')}"`)
      .join(",");
  }
}

interface SummarySample {
  readonly quantiles: Map<number, number>;
  sum: number;
  count: number;
}

class SummaryMetric {
  private readonly metadata: MetricMetadata;

  private readonly quantiles: readonly number[];

  private readonly samples = new Map<string, SummarySample>();

  public constructor(
    metadata: MetricMetadata,
    quantiles: readonly number[] = [0.5, 0.9, 0.95, 0.99],
  ) {
    this.metadata = metadata;
    this.quantiles = quantiles;
  }

  public observe(value: number, labels: Labels = {}): void {
    const key = this.serializeLabels(labels);
    const sample = this.samples.get(key) ?? {
      quantiles: new Map<number, number>(),
      sum: 0,
      count: 0,
    };

    // Simple quantile estimation (in production, you'd want a proper quantile estimator)
    // For now, we'll just keep all values and compute quantiles on demand
    // This is a simplified implementation
    sample.sum += value;
    sample.count += 1;

    // Update quantiles (simplified - in practice you'd use a proper algorithm)
    const values = Array.from(sample.quantiles.values());
    values.push(value);
    values.sort((a, b) => a - b);

    for (const quantile of this.quantiles) {
      const index = Math.floor(quantile * (values.length - 1));
      sample.quantiles.set(quantile, values[index]);
    }

    this.samples.set(key, sample);
  }

  public toPrometheus(): string {
    const lines: string[] = [];
    lines.push(`# HELP ${this.metadata.name} ${this.metadata.help}`);
    lines.push(`# TYPE ${this.metadata.name} summary`);
    for (const [labelKey, sample] of this.samples.entries()) {
      for (const [quantile, value] of sample.quantiles.entries()) {
        const suffix =
          labelKey.length > 0
            ? `{quantile="${quantile}",${labelKey}}`
            : `{quantile="${quantile}"}`;
        lines.push(`${this.metadata.name}${suffix} ${value}`);
      }
      const countSuffix = labelKey.length > 0 ? `{${labelKey}}` : "";
      lines.push(`${this.metadata.name}_count${countSuffix} ${sample.count}`);
      lines.push(`${this.metadata.name}_sum${countSuffix} ${sample.sum}`);
    }
    return lines.join("\n");
  }

  private serializeLabels(labels: Labels): string {
    const merged: Record<string, string> = {};
    for (const name of this.metadata.labelNames) {
      if (labels[name]) {
        merged[name] = labels[name];
      }
    }
    const entries = Object.entries(merged);
    if (entries.length === 0) {
      return "";
    }
    return entries
      .map(([key, value]) => `${key}="${value.replace(/"/g, '\\"')}"`)
      .join(",");
  }
}

class HistogramMetric {
  private readonly metadata: MetricMetadata;

  private readonly buckets: readonly number[];

  private readonly samples = new Map<string, HistogramSample>();

  public constructor(metadata: MetricMetadata, buckets: readonly number[]) {
    this.metadata = metadata;
    this.buckets = buckets;
  }

  public observe(value: number, labels: Labels = {}): void {
    const key = this.serializeLabels(labels);
    const sample = this.samples.get(key) ?? {
      buckets: new Map<number, number>(),
      sum: 0,
      count: 0,
    };
    for (const bucket of this.buckets) {
      if (!sample.buckets.has(bucket)) {
        sample.buckets.set(bucket, 0);
      }
      if (value <= bucket) {
        sample.buckets.set(bucket, (sample.buckets.get(bucket) ?? 0) + 1);
      }
    }
    sample.sum += value;
    sample.count += 1;
    this.samples.set(key, sample);
  }

  public toPrometheus(): string {
    const lines: string[] = [];
    lines.push(`# HELP ${this.metadata.name} ${this.metadata.help}`);
    lines.push(`# TYPE ${this.metadata.name} histogram`);
    for (const [labelKey, sample] of this.samples.entries()) {
      for (const bucket of this.buckets) {
        const suffixParts = [`le="${bucket}"`];
        if (labelKey.length > 0) {
          suffixParts.push(labelKey);
        }
        const suffix = `{${suffixParts.join(",")}}`;
        lines.push(
          `${this.metadata.name}_bucket${suffix} ${sample.buckets.get(bucket) ?? 0}`,
        );
      }
      const infSuffix =
        labelKey.length > 0 ? `{le="+Inf",${labelKey}}` : `{le="+Inf"}`;
      lines.push(`${this.metadata.name}_bucket${infSuffix} ${sample.count}`);
      const countSuffix = labelKey.length > 0 ? `{${labelKey}}` : "";
      lines.push(`${this.metadata.name}_count${countSuffix} ${sample.count}`);
      lines.push(`${this.metadata.name}_sum${countSuffix} ${sample.sum}`);
    }
    return lines.join("\n");
  }

  private serializeLabels(labels: Labels): string {
    const merged: Record<string, string> = {};
    for (const name of this.metadata.labelNames) {
      if (labels[name]) {
        merged[name] = labels[name];
      }
    }
    const entries = Object.entries(merged);
    if (entries.length === 0) {
      return "";
    }
    return entries
      .map(([key, value]) => `${key}="${value.replace(/"/g, '\\"')}"`)
      .join(",");
  }
}

export class MetricRegistry {
  private readonly counters = new Map<string, CounterMetric>();

  private readonly histograms = new Map<string, HistogramMetric>();

  private readonly gauges = new Map<string, GaugeMetric>();

  private readonly summaries = new Map<string, SummaryMetric>();

  private readonly defaultLabels: Labels;

  public constructor(defaultLabels: Labels = {}) {
    this.defaultLabels = defaultLabels;
  }

  public getOrCreateCounter(
    name: string,
    help: string,
    labelNames: readonly string[] = [],
  ): CounterMetric {
    if (!this.counters.has(name)) {
      this.counters.set(
        name,
        new CounterMetric({ name, help, type: "counter", labelNames }),
      );
    }
    return this.counters.get(name)!;
  }

  public getOrCreateHistogram(
    name: string,
    help: string,
    labelNames: readonly string[] = [],
    buckets: readonly number[] = [0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  ): HistogramMetric {
    if (!this.histograms.has(name)) {
      this.histograms.set(
        name,
        new HistogramMetric(
          { name, help, type: "histogram", labelNames },
          buckets,
        ),
      );
    }
    return this.histograms.get(name)!;
  }

  public getOrCreateGauge(
    name: string,
    help: string,
    labelNames: readonly string[] = [],
  ): GaugeMetric {
    if (!this.gauges.has(name)) {
      this.gauges.set(
        name,
        new GaugeMetric({ name, help, type: "gauge", labelNames }),
      );
    }
    return this.gauges.get(name)!;
  }

  public getOrCreateSummary(
    name: string,
    help: string,
    labelNames: readonly string[] = [],
    quantiles: readonly number[] = [0.5, 0.9, 0.95, 0.99],
  ): SummaryMetric {
    if (!this.summaries.has(name)) {
      this.summaries.set(
        name,
        new SummaryMetric(
          { name, help, type: "summary", labelNames },
          quantiles,
        ),
      );
    }
    return this.summaries.get(name)!;
  }

  public snapshot(): string {
    const lines: string[] = [];
    if (
      this.counters.size === 0 &&
      this.histograms.size === 0 &&
      this.gauges.size === 0 &&
      this.summaries.size === 0
    ) {
      lines.push("# No metrics recorded yet");
    }
    for (const counter of this.counters.values()) {
      lines.push(counter.toPrometheus());
    }
    for (const histogram of this.histograms.values()) {
      lines.push(histogram.toPrometheus());
    }
    for (const gauge of this.gauges.values()) {
      lines.push(gauge.toPrometheus());
    }
    for (const summary of this.summaries.values()) {
      lines.push(summary.toPrometheus());
    }
    return lines.join("\n");
  }

  public withDefaultLabels(labels: Labels): Labels {
    return { ...this.defaultLabels, ...labels };
  }
}

export interface TelemetrySpanAttributes {
  readonly [key: string]: string | number | boolean | undefined;
}

export interface TelemetrySpanContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly startTime: number;
  readonly attributes: TelemetrySpanAttributes;
}

export interface TelemetryOptions {
  readonly serviceName: string;
  readonly logger?: StructuredLogger;
  readonly registry?: MetricRegistry;
}

export interface Telemetry {
  readonly registry: MetricRegistry;
  withSpan<T>(
    name: string,
    attributes: TelemetrySpanAttributes,
    fn: () => T,
  ): T;
  withSpan<T>(
    name: string,
    attributes: TelemetrySpanAttributes,
    fn: () => Promise<T>,
  ): Promise<T>;
  recordEvent(name: string, attributes?: TelemetrySpanAttributes): void;
  getActiveContext(): TelemetrySpanContext | undefined;
  createChildSpan(
    name: string,
    attributes?: TelemetrySpanAttributes,
  ): TelemetrySpanContext;
  withChildSpan<T>(
    name: string,
    attributes: TelemetrySpanAttributes,
    fn: () => T,
  ): T;
  withChildSpan<T>(
    name: string,
    attributes: TelemetrySpanAttributes,
    fn: () => Promise<T>,
  ): Promise<T>;
}

class NoopTelemetry implements Telemetry {
  public readonly registry = new MetricRegistry();

  public withSpan<T>(
    _: string,
    __: TelemetrySpanAttributes,
    fn: () => T | Promise<T>,
  ): T | Promise<T> {
    return fn();
  }

  public recordEvent(): void {
    // intentionally noop
  }

  public getActiveContext(): TelemetrySpanContext | undefined {
    return undefined;
  }

  public createChildSpan(): TelemetrySpanContext {
    return {
      traceId: randomUUID(),
      spanId: randomUUID(),
      name: "noop",
      startTime: Date.now(),
      attributes: {},
    };
  }

  public withChildSpan<T>(
    _: string,
    __: TelemetrySpanAttributes,
    fn: () => T | Promise<T>,
  ): T | Promise<T> {
    return fn();
  }
}

class InstrumentedTelemetry implements Telemetry {
  public readonly registry: MetricRegistry;

  private readonly logger: StructuredLogger;

  private readonly storage = new AsyncLocalStorage<TelemetrySpanContext>();

  private readonly spanCounter;

  private readonly spanDuration;

  private readonly eventCounter;

  public constructor(options: TelemetryOptions) {
    this.registry =
      options.registry ?? new MetricRegistry({ service: options.serviceName });
    this.logger =
      options.logger ??
      createLoggerFromEnv({
        serviceName: options.serviceName,
        telemetry: this,
        includeTraceId: true,
      });
    this.spanCounter = this.registry.getOrCreateCounter(
      "prompt_vault_span_total",
      "Total spans recorded",
      ["span_name", "status"],
    );
    this.spanDuration = this.registry.getOrCreateHistogram(
      "prompt_vault_span_duration_seconds",
      "Span duration in seconds",
      ["span_name", "status"],
    );
    this.eventCounter = this.registry.getOrCreateCounter(
      "prompt_vault_events_total",
      "Total telemetry events",
      ["event_name"],
    );
  }

  public withSpan<T>(
    name: string,
    attributes: TelemetrySpanAttributes,
    fn: () => T | Promise<T>,
  ): T | Promise<T> {
    const parent = this.storage.getStore();
    const context: TelemetrySpanContext = {
      traceId: parent?.traceId ?? randomUUID(),
      spanId: randomUUID(),
      parentSpanId: parent?.spanId,
      name,
      startTime: Date.now(),
      attributes,
    };

    const run = (): T | Promise<T> => {
      const start = process.hrtime.bigint();
      const execute = (): T | Promise<T> => fn();
      const finalise = (status: "ok" | "error", error?: unknown): void => {
        const end = process.hrtime.bigint();
        const durationSeconds = Number(end - start) / 1_000_000_000;
        this.spanCounter.increment(
          this.registry.withDefaultLabels({
            span_name: name,
            status,
          }),
        );
        this.spanDuration.observe(
          durationSeconds,
          this.registry.withDefaultLabels({
            span_name: name,
            status,
          }),
        );
        const logPayload = {
          traceId: context.traceId,
          spanId: context.spanId,
          parentSpanId: context.parentSpanId,
          durationSeconds,
          ...attributes,
        };
        if (status === "ok") {
          this.logger.info(`span_completed:${name}`, logPayload);
        } else {
          this.logger.error(`span_failed:${name}`, {
            ...logPayload,
            error: error instanceof Error ? error.message : error,
          });
        }
      };

      try {
        const result = execute();
        if (result && typeof (result as Promise<unknown>).then === "function") {
          return (result as Promise<T>)
            .then((value) => {
              finalise("ok");
              return value;
            })
            .catch((error: unknown) => {
              finalise("error", error);
              throw error;
            });
        }
        finalise("ok");
        return result as T;
      } catch (error) {
        finalise("error", error);
        throw error;
      }
    };

    return this.storage.run(context, run);
  }

  public recordEvent(
    name: string,
    attributes: TelemetrySpanAttributes = {},
  ): void {
    this.eventCounter.increment(
      this.registry.withDefaultLabels({ event_name: name }),
    );
    this.logger.debug(`event:${name}`, {
      ...attributes,
      traceId: this.storage.getStore()?.traceId,
    });
  }

  public getActiveContext(): TelemetrySpanContext | undefined {
    return this.storage.getStore();
  }

  public createChildSpan(
    name: string,
    attributes: TelemetrySpanAttributes = {},
  ): TelemetrySpanContext {
    const parent = this.storage.getStore();
    return {
      traceId: parent?.traceId ?? randomUUID(),
      spanId: randomUUID(),
      parentSpanId: parent?.spanId,
      name,
      startTime: Date.now(),
      attributes,
    };
  }

  public withChildSpan<T>(
    name: string,
    attributes: TelemetrySpanAttributes = {},
    fn: () => T | Promise<T>,
  ): T | Promise<T> {
    const context = this.createChildSpan(name, attributes);
    return this.storage.run(context, () => this.withSpan(name, attributes, fn));
  }
}

export function createTelemetry(options?: TelemetryOptions): Telemetry {
  if (!options) {
    return new NoopTelemetry();
  }
  return new InstrumentedTelemetry(options);
}

export function createNoopTelemetry(): Telemetry {
  return new NoopTelemetry();
}
