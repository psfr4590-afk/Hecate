'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PHASES,
  createTargetDescriptor,
  targetPriority,
  createAssessmentPlan,
} = require('./assessment-plan');

test('assessment plan defaults to the complete assessment lifecycle', () => {
  const plan = createAssessmentPlan({ name: 'Synthetic Assessment' });
  assert.equal(plan.name, 'Synthetic Assessment');
  assert.deepEqual(plan.phases, PHASES);
  assert.equal(plan.options.discovery, true);
  assert.equal(plan.options.adaptivePacing, true);
});

test('target priority combines sensitivity and business criticality', () => {
  const target = createTargetDescriptor({
    id: 'api-1',
    name: 'Customer API',
    type: 'api',
    dataSensitivity: 'HIGH',
    businessCriticality: 'CRITICAL',
  });

  assert.equal(targetPriority(target), 7);
});

test('unknown phases are rejected', () => {
  assert.throws(
    () => createAssessmentPlan({ phases: ['discovery', 'not-a-phase'] }),
    /Unknown assessment phase/,
  );
});

test('target tags are normalized and deduplicated', () => {
  const target = createTargetDescriptor({
    name: 'Portal',
    tags: ['internet-facing', 'internet-facing', 'customer'],
  });

  assert.deepEqual(target.tags, ['internet-facing', 'customer']);
});
