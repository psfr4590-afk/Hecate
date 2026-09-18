'use strict';

/**
 * Assessment planning primitives.
 *
 * This layer deliberately separates:
 *   - what is being assessed,
 *   - what was discovered,
 *   - how traffic should behave,
 *   - and which test cases apply.
 *
 * It does not contain target-specific runtime data.
 */

const PHASES = Object.freeze([
  'discovery',
  'attack-surface',
  'authentication',
  'authorization',
  'application',
  'network',
  'secrets',
  'crypto',
  'post-exploitation',
  'validation',
  'reporting',
]);

const PRIORITY = Object.freeze({
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
});

function normalizePriority(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 4) {
    return value;
  }
  if (typeof value === 'string') {
    const key = value.trim().toUpperCase();
    if (Object.prototype.hasOwnProperty.call(PRIORITY, key)) return PRIORITY[key];
  }
  return PRIORITY.MEDIUM;
}

function createTargetDescriptor(input = {}) {
  const name = String(input.name || '').trim();
  if (!name) throw new TypeError('Target name is required');

  return Object.freeze({
    id: String(input.id || name),
    name,
    type: String(input.type || 'unknown'),
    exposure: String(input.exposure || 'unknown'),
    dataSensitivity: normalizePriority(input.dataSensitivity),
    businessCriticality: normalizePriority(input.businessCriticality),
    tags: Object.freeze(Array.isArray(input.tags) ? [...new Set(input.tags.map(String))] : []),
  });
}

function targetPriority(target) {
  return target.dataSensitivity + target.businessCriticality;
}

function createAssessmentPlan(input = {}) {
  const targets = Array.isArray(input.targets)
    ? input.targets.map(createTargetDescriptor)
    : [];

  const phases = Array.isArray(input.phases) && input.phases.length
    ? [...new Set(input.phases.map(String))]
    : [...PHASES];

  for (const phase of phases) {
    if (!PHASES.includes(phase)) {
      throw new TypeError(`Unknown assessment phase: ${phase}`);
    }
  }

  return Object.freeze({
    id: String(input.id || `assessment-${Date.now()}`),
    name: String(input.name || 'Assessment'),
    phases: Object.freeze(phases),
    targets: Object.freeze(targets),
    options: Object.freeze({
      discovery: input.options?.discovery !== false,
      adaptivePacing: input.options?.adaptivePacing !== false,
      retainRuntimeDataLocally: input.options?.retainRuntimeDataLocally !== false,
    }),
  });
}

module.exports = {
  PHASES,
  PRIORITY,
  normalizePriority,
  createTargetDescriptor,
  targetPriority,
  createAssessmentPlan,
};
