import { addTraceProcessor, type TracingProcessor, type Span, type Trace } from '@openai/agents';
import { LatitudeTelemetry, type TelemetryContext } from '@latitude-data/telemetry';
import { trace, context, SpanStatusCode } from '@opentelemetry/api';

import openaiAgents from '@openai/agents';

const telemetry = new LatitudeTelemetry(
  process.env.LATITUDE_API_KEY as string,
  {
    disableBatch: true,
  }
)

const tracer = trace.getTracer('openai-agents');

// Bridge OpenAI Agents SDK tracing to Latitude
class LatitudeAgentsTracingProcessor implements TracingProcessor {
  private captureContext = context.active();
  private spanContexts = new Map<string, ReturnType<typeof context.active>>();
  private spans = new Map<string, ReturnType<typeof tracer.startSpan>>();

  setContext(ctx: ReturnType<typeof context.active>) {
    this.captureContext = ctx;
  }

  clearContext() {
    this.captureContext = context.active();
    this.spanContexts.clear();
  }

  private getParentContext(span: Span<any>) {
    const parentId = (span as any).parentId;
    if (parentId && this.spanContexts.has(parentId)) {
      return this.spanContexts.get(parentId)!;
    }
    return this.captureContext;
  }

  async onSpanStart(span: Span<any>): Promise<void> {
    const parentCtx = this.getParentContext(span);
    const spanData = span.spanData as Record<string, unknown>;

    // Create a raw OpenTelemetry span with ALL the original data
    const otelSpan = tracer.startSpan(
      `${spanData.type || 'unknown'}: ${spanData.name || span.spanId}`,
      {
        attributes: this.toAttributes(spanData, span),
      },
      parentCtx
    );

    const newCtx = trace.setSpan(parentCtx, otelSpan);
    this.spans.set(span.spanId, otelSpan);
    this.spanContexts.set(span.spanId, newCtx);
  }

  async onSpanEnd(span: Span<any>): Promise<void> {
    const otelSpan = this.spans.get(span.spanId);
    if (!otelSpan) return;

    const spanData = span.spanData as Record<string, unknown>;

    // Add any end-time data
    otelSpan.setAttributes(this.toAttributes(spanData, span, 'end'));

    if (span.error) {
      otelSpan.setStatus({ code: SpanStatusCode.ERROR, message: String(span.error) });
      otelSpan.recordException(typeof span.error === 'object' ? span.error : new Error(String(span.error)));
    } else {
      otelSpan.setStatus({ code: SpanStatusCode.OK });
    }

    otelSpan.end();
    this.spans.delete(span.spanId);
    this.spanContexts.delete(span.spanId);
  }

  private toAttributes(spanData: Record<string, unknown>, span: Span<any>, phase = 'start') {
    const attrs: Record<string, string | number | boolean> = {
      'openai.agents.span_id': span.spanId,
      'openai.agents.trace_id': span.traceId,
      'openai.agents.phase': phase,
    };

    for (const [key, value] of Object.entries(spanData)) {
      if (value === null || value === undefined) continue;
      
      const attrKey = `openai.agents.${key}`;
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        attrs[attrKey] = value;
      } else {
        try {
          attrs[attrKey] = JSON.stringify(value);
        } catch {
          // skip unserializable
        }
      }
    }

    return attrs;
  }

  async onTraceStart(trace: Trace): Promise<void> {}
  async onTraceEnd(trace: Trace): Promise<void> {}
  async forceFlush(): Promise<void> { await telemetry.flush(); }
  async shutdown(): Promise<void> { await telemetry.shutdown(); }
}

// Create and register the processor
const latitudeProcessor = new LatitudeAgentsTracingProcessor();
addTraceProcessor(latitudeProcessor);

export default telemetry;
export { latitudeProcessor };