import type { ValidationError } from '@nestjs/common';

export interface FieldError {
  field: string;
  message: string;
}

/**
 * Ratakan `ValidationError[]` class-validator menjadi pasangan `{ field, message }`,
 * dengan path bergaya `attendances[2].status` untuk item array bersarang.
 */
export function flattenValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): FieldError[] {
  const out: FieldError[] = [];
  for (const err of errors) {
    const path = joinPath(parentPath, err.property);
    if (err.constraints) {
      for (const message of Object.values(err.constraints)) {
        out.push({ field: path, message });
      }
    }
    if (err.children?.length) {
      out.push(...flattenValidationErrors(err.children, path));
    }
  }
  return out;
}

function joinPath(parent: string, property: string): string {
  if (!parent) return property;
  return /^\d+$/.test(property) ? `${parent}[${property}]` : `${parent}.${property}`;
}
