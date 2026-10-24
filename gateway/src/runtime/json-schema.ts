/**
 * 轻量 JSON Schema 校验子集——Batch 1 结构化输出用。
 *
 * 只覆盖 goal/worker 实际会用的关键字；遇到 `$ref` / `$defs` 等未实现关键字
 * **显式失败**，避免“看起来校验通过但其实没校验”。
 */
export interface ValidationError {
  path: string;
  message: string;
}

function isObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function typeMatches(type: string, value: unknown): boolean {
  switch (type) {
    case 'null': return value === null;
    case 'array': return Array.isArray(value);
    case 'object': return isObject(value);
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'boolean': return typeof value === 'boolean';
    default: return false;
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isObject(a) && isObject(b)) {
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    return ak.length === bk.length && ak.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
}

function err(path: string, message: string): ValidationError {
  return { path, message };
}

export function validateJsonSchema(schema: any, value: any, path = '$'): ValidationError[] {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return [];

  if (schema.$ref !== undefined || schema.$defs !== undefined || schema.definitions !== undefined) {
    return [err(path, 'unsupported schema keyword: $ref/$defs')];
  }

  const errors: ValidationError[] = [];

  // const / enum
  if (Object.prototype.hasOwnProperty.call(schema, 'const') && !deepEqual(schema.const, value)) {
    errors.push(err(path, `must equal ${JSON.stringify(schema.const)}`));
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((v: unknown) => deepEqual(v, value))) {
    errors.push(err(path, `must be one of ${JSON.stringify(schema.enum)}`));
  }

  // type
  const types = Array.isArray(schema.type) ? schema.type : (typeof schema.type === 'string' ? [schema.type] : []);
  if (types.length > 0 && !types.some((t: string) => typeMatches(t, value))) {
    errors.push(err(path, `must be of type ${types.join('|')}`));
    // Don't run structural checks on the wrong shape.
    return errors;
  }

  // combinators
  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf) errors.push(...validateJsonSchema(sub, value, path));
  }
  if (Array.isArray(schema.anyOf)) {
    const results = schema.anyOf.map((sub: any) => validateJsonSchema(sub, value, path));
    if (results.every((r: ValidationError[]) => r.length > 0)) {
      errors.push(err(path, `does not match anyOf (${results[0]?.[0]?.message ?? 'no branch'})`));
    }
  }
  if (Array.isArray(schema.oneOf)) {
    const passed = schema.oneOf.filter((sub: any) => validateJsonSchema(sub, value, path).length === 0).length;
    if (passed !== 1) errors.push(err(path, `must match exactly one oneOf branch (matched ${passed})`));
  }

  // object
  if (isObject(value)) {
    const props = isObject(schema.properties) ? schema.properties : {};
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (typeof key === 'string' && !Object.prototype.hasOwnProperty.call(value, key)) {
          errors.push(err(`${path}.${key}`, 'is required'));
        }
      }
    }
    for (const [key, sub] of Object.entries(props)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        errors.push(...validateJsonSchema(sub, value[key], `${path}.${key}`));
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(props, key)) {
          errors.push(err(`${path}.${key}`, 'is not allowed (additionalProperties:false)'));
        }
      }
    } else if (isObject(schema.additionalProperties)) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(props, key)) {
          errors.push(...validateJsonSchema(schema.additionalProperties, value[key], `${path}.${key}`));
        }
      }
    }
    const count = Object.keys(value).length;
    if (typeof schema.minProperties === 'number' && count < schema.minProperties) {
      errors.push(err(path, `must have at least ${schema.minProperties} properties`));
    }
    if (typeof schema.maxProperties === 'number' && count > schema.maxProperties) {
      errors.push(err(path, `must have at most ${schema.maxProperties} properties`));
    }
  }

  // array
  if (Array.isArray(value)) {
    if (Array.isArray(schema.items)) {
      schema.items.forEach((sub: any, i: number) => {
        if (i < value.length) errors.push(...validateJsonSchema(sub, value[i], `${path}[${i}]`));
      });
    } else if (isObject(schema.items)) {
      value.forEach((item, i) => errors.push(...validateJsonSchema(schema.items, item, `${path}[${i}]`)));
    }
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      errors.push(err(path, `must have at least ${schema.minItems} items`));
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      errors.push(err(path, `must have at most ${schema.maxItems} items`));
    }
    if (schema.uniqueItems === true) {
      for (let i = 0; i < value.length; i++) {
        for (let j = i + 1; j < value.length; j++) {
          if (deepEqual(value[i], value[j])) {
            errors.push(err(`${path}[${j}]`, 'must be unique'));
            i = value.length; // one error is enough
            break;
          }
        }
      }
    }
  }

  // string
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errors.push(err(path, `must be at least ${schema.minLength} characters`));
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      errors.push(err(path, `must be at most ${schema.maxLength} characters`));
    }
    if (typeof schema.pattern === 'string') {
      try {
        if (!new RegExp(schema.pattern).test(value)) errors.push(err(path, `must match pattern ${schema.pattern}`));
      } catch {
        errors.push(err(path, `invalid schema pattern: ${schema.pattern}`));
      }
    }
  }

  // number
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push(err(path, `must be >= ${schema.minimum}`));
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push(err(path, `must be <= ${schema.maximum}`));
    }
    if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) {
      errors.push(err(path, `must be > ${schema.exclusiveMinimum}`));
    }
    if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) {
      errors.push(err(path, `must be < ${schema.exclusiveMaximum}`));
    }
    if (typeof schema.multipleOf === 'number' && schema.multipleOf > 0) {
      const q = value / schema.multipleOf;
      if (Math.abs(q - Math.round(q)) > 1e-9) errors.push(err(path, `must be a multiple of ${schema.multipleOf}`));
    }
  }

  return errors;
}
