import { z } from 'zod';

export const SECURITY_CATEGORIES = [
  'hardcoded-secret',
  'authentication',
  'authorization',
  'injection',
  'sql-injection',
  'command-injection',
  'xss',
  'ssrf',
  'insecure-file-handling',
  'unsafe-deserialization',
  'insecure-cryptography',
  'sensitive-data-exposure',
  'insecure-dependency',
  'misconfiguration',
  'other',
] as const;

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
export const CONFIDENCE = ['confirmed', 'potential'] as const;

export const securityFlagSchema = z.strictObject({
  severity: z.enum(SEVERITIES),
  confidence: z.enum(CONFIDENCE),
  category: z.enum(SECURITY_CATEGORIES),
  title: z.string().min(1).max(150),
  description: z.string().min(1).max(2000),
  file: z.union([z.string().min(1).max(500), z.null()]),
  line: z.union([z.number().int().min(1), z.null()]),
  recommendation: z.string().min(1).max(1500),
});

export const auditOutputSchema = z.strictObject({
  summary: z.string().min(1).max(600),
  documentation: z.string().min(1).max(20_000),
  security_flags: z.array(securityFlagSchema).max(50),
});

export type AuditModelOutput = z.infer<typeof auditOutputSchema>;
export type SecurityFlag = AuditModelOutput['security_flags'][number];

/**
 * Hand-written strict JSON Schema. Optional values are nullable.
 * Every property is required and additionalProperties is false.
 * Kept independent of Zod; tests assert the two descriptions stay aligned.
 */
export const AUDIT_OUTPUT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'documentation', 'security_flags'],
  properties: {
    summary: { type: 'string', minLength: 1, maxLength: 600 },
    documentation: { type: 'string', minLength: 1, maxLength: 20000 },
    security_flags: {
      type: 'array',
      maxItems: 50,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'severity',
          'confidence',
          'category',
          'title',
          'description',
          'file',
          'line',
          'recommendation',
        ],
        properties: {
          severity: { type: 'string', enum: [...SEVERITIES] },
          confidence: { type: 'string', enum: [...CONFIDENCE] },
          category: { type: 'string', enum: [...SECURITY_CATEGORIES] },
          title: { type: 'string', minLength: 1, maxLength: 150 },
          description: { type: 'string', minLength: 1, maxLength: 2000 },
          file: { type: ['string', 'null'], minLength: 1, maxLength: 500 },
          line: { type: ['integer', 'null'], minimum: 1 },
          recommendation: { type: 'string', minLength: 1, maxLength: 1500 },
        },
      },
    },
  },
} as const;

export interface JsonSchemaNode {
  type?: string | readonly string[];
  additionalProperties?: boolean;
  required?: readonly string[];
  properties?: Readonly<Record<string, JsonSchemaNode>>;
  items?: JsonSchemaNode;
  enum?: readonly string[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maxItems?: number;
}

/** Minimal checker for the audit schema. Returns human-readable failures. */
export function jsonSchemaErrors(schema: JsonSchemaNode, value: unknown, path = '$'): string[] {
  const errors: string[] = [];
  const types = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];

  if (value === null) {
    if (!types.includes('null')) {
      errors.push(`${path} is null`);
    }
    return errors;
  }

  if (types.includes('string') && typeof value === 'string') {
    if (schema.enum && !schema.enum.includes(value)) {
      errors.push(`${path} is not an allowed enum value`);
    }
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${path} is shorter than minLength`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${path} is longer than maxLength`);
    }
    return errors;
  }

  if ((types.includes('integer') || types.includes('number')) && typeof value === 'number') {
    if (types.includes('integer') && !Number.isInteger(value)) {
      errors.push(`${path} is not an integer`);
    }
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${path} is below minimum`);
    }
    return errors;
  }

  if (types.includes('array') && Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${path} has too many items`);
    }
    if (schema.items) {
      value.forEach((item, index) => {
        errors.push(...jsonSchemaErrors(schema.items as JsonSchemaNode, item, `${path}[${index}]`));
      });
    }
    return errors;
  }

  if (types.includes('object') && value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (schema.additionalProperties === false && schema.properties) {
      for (const key of keys) {
        if (!(key in schema.properties)) {
          errors.push(`${path}.${key} is not allowed`);
        }
      }
    }
    if (schema.required && schema.properties) {
      for (const key of schema.required) {
        if (!(key in record)) {
          errors.push(`${path}.${key} is required`);
        }
      }
    }
    if (schema.properties) {
      for (const [key, child] of Object.entries(schema.properties)) {
        if (key in record) {
          errors.push(...jsonSchemaErrors(child, record[key], `${path}.${key}`));
        }
      }
    }
    return errors;
  }

  errors.push(`${path} has the wrong type`);
  return errors;
}
