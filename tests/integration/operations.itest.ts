import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "@prisma/client";
import { GET as auditGet } from "../../app/api/agent/operations/audit/route";
import { GET as operationsGet } from "../../app/api/agent/operations/route";
import { GET as searchGet } from "../../app/api/agent/operations/search/route";
import { GET as viewsGet, POST as viewsPost } from "../../app/api/agent/operations/views/route";
import { transitionCase } from "../../lib/caseService";
import { getCanonicalCase, getCanonicalCases } from "../../lib/caseReadModel";
import { createMeeting, rescheduleMeeting, updateMeetingStatus } from "../../lib/meetingService";
import { OperationalAuthError } from "../../lib/operationalAuth";
import { OperationalCommandError } from "../../lib/operationalTransaction";
import { ensurePastMeetingEscalations, projectPastMeetingEscalation } from "../../lib/operationsProjection";
import { getOperationsQueue, getTeamControlTower } from "../../lib/operationsReadModel";
import { reconcileOperations } from "../../lib/operationsReconciliation";
import { assignTask, cancelTask, completeTask, createTask, waitTask } from "../../lib/taskService";
import {
  createFixtureContext,
  db,
  makeRequest,
  sessionCookieHeader,
  skip,
  type FixtureMember,
} from "./_setup";

const opts = { skip: skip ? "set TEST_DATABASE_URL + ALLOW_DB_TESTS=1" : false };

function meta(key: string) {
  return { idempotencyKey: key, correlationId: `correlation:${key}` };
}

async function cookie(member: FixtureMember) {
  return sessionCookieHeader(member.userId, member.agentId);
}

async function expectCommandError(
  promise: Promise<unknown>,
  status: number,
  code?: string,
) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof OperationalCommandError || error instanceof OperationalAuthError);
    assert.equal(error.status, status);
    if (code) assert.equal((error as OperationalCommandError).code, code);
    return true;
  });
}

test("M1 RBAC and tenant boundaries cover Agent, Manager and Admin reads/writes", opts, async () => {
  const fixtures = createFixtureContext("m1-rbac");
  try {
    const organizationId = await fixtures.makeOrganization("team");
    const agent = await fixtures.makeMember("agent", { organizationId, role: "AGENT" });
    const teammate = await fixtures.makeMember("teammate", { organizationId, role: "AGENT" });
    const manager = await fixtures.makeMember("manager", { organizationId, role: "MANAGER" });
    const admin = await fixtures.makeMember("admin", { organizationId, role: "ADMIN" });
    const ownCase = await fixtures.makeCase(agent, "own");

    const foreign = await fixtures.makeAgent("foreign-agent");
    const foreignManager = await fixtures.makeMember("foreign-manager", {
      organizationId: foreign.organizationId,
      role: "MANAGER",
    });
    const foreignCase = await fixtures.makeCase(foreign, "foreign");

    const task = await createTask(agent.context, {
      leadId: ownCase.leadId,
      title: "Agent-owned task",
      assigneeMembershipId: agent.membershipId,
    }, meta(`m1:${fixtures.runId}:rbac-task`));

    await expectCommandError(assignTask(agent.context, task.id, {
      assigneeMembershipId: teammate.membershipId,
      reason: "Agent must not assign team work",
      version: task.version,
    }, meta(`m1:${fixtures.runId}:agent-assign-denied`)), 403);

    const assigned = await assignTask(manager.context, task.id, {
      assigneeMembershipId: teammate.membershipId,
      reason: "Balance team workload",
      version: task.version,
    }, meta(`m1:${fixtures.runId}:manager-assign`));
    assert.equal(assigned.assigneeMembershipId, teammate.membershipId);
    await expectCommandError(completeTask(manager.context, task.id, {
      outcome: "Manager must not close teammate work",
      version: assigned.version,
    }, meta(`m1:${fixtures.runId}:manager-teammate-mutate-denied`)), 404);

    await expectCommandError(createTask(admin.context, {
      leadId: ownCase.leadId,
      title: "Admin must remain operationally read-only",
    }, meta(`m1:${fixtures.runId}:admin-write-denied`)), 403);

    await expectCommandError(createTask(manager.context, {
      leadId: foreignCase.leadId,
      title: "Cross-tenant create",
    }, meta(`m1:${fixtures.runId}:foreign-create-denied`)), 404);
    await expectCommandError(assignTask(foreignManager.context, task.id, {
      assigneeMembershipId: foreign.membershipId,
      reason: "Cross-tenant assign",
      version: assigned.version,
    }, meta(`m1:${fixtures.runId}:foreign-assign-denied`)), 404);

    const agentQueue = await getOperationsQueue(agent.context);
    assert.equal(Object.values(agentQueue.groups).flat().some((item) => item.id === task.id), false);
    const teammateQueue = await getOperationsQueue(teammate.context);
    assert.equal(Object.values(teammateQueue.groups).flat().some((item) => item.id === task.id), true);
    const managerQueue = await getOperationsQueue(manager.context);
    assert.equal(Object.values(managerQueue.groups).flat().some((item) => item.id === task.id), false);
    assert.equal(Object.values(managerQueue.groups).flat().some((item) => item.caseId === foreignCase.id), false);
    assert.equal(await getCanonicalCase(teammate.context, ownCase.leadId), null);
    assert.equal((await getCanonicalCases(teammate.context)).some((item) => item.caseId === ownCase.id), false);
    assert.equal((await getCanonicalCase(manager.context, ownCase.leadId))?.caseId, ownCase.id);

    const team = await getTeamControlTower(manager.context);
    assert.equal(team.members.some((item) => item.membershipId === teammate.membershipId), true);
    assert.equal(team.cases.some((item) => item.caseId === ownCase.id), true);
    assert.equal(team.cases.some((item) => item.caseId === foreignCase.id), false);
    assert.equal(team.auditEvents.some((event) => event.action === "Исполнитель задачи изменён" && event.actorName === manager.context.name), true);
    const teammateLoad = team.members.find((item) => item.membershipId === teammate.membershipId);
    assert.equal(teammateLoad?.workload, (teammateLoad?.open ?? 0) + (teammateLoad?.meetings ?? 0) * 2);
    await assert.rejects(getTeamControlTower(agent.context), OperationalAuthError);
    assert.equal((await getTeamControlTower(admin.context)).cases.some((item) => item.caseId === ownCase.id), true);

    const agentTeamResponse = await operationsGet(makeRequest("/api/agent/operations?view=team", {
      cookie: await cookie(agent),
    }));
    assert.equal(agentTeamResponse.status, 403);
    const managerTeamResponse = await operationsGet(makeRequest("/api/agent/operations?view=team", {
      cookie: await cookie(manager),
    }));
    assert.equal(managerTeamResponse.status, 200);

    const agentAudit = await auditGet(makeRequest("/api/agent/operations/audit", { cookie: await cookie(agent) }));
    assert.equal(agentAudit.status, 200);
    const agentEvents = (await agentAudit.json() as { events: Array<{ actorMembershipId: string | null }> }).events;
    assert.equal(agentEvents.some((event) => event.actorMembershipId === agent.membershipId), true);
    const managerAudit = await auditGet(makeRequest("/api/agent/operations/audit", { cookie: await cookie(manager) }));
    assert.equal(managerAudit.status, 200);
    const adminAudit = await auditGet(makeRequest("/api/agent/operations/audit", { cookie: await cookie(admin) }));
    assert.equal(adminAudit.status, 200);
  } finally {
    await fixtures.cleanup();
    await fixtures.assertNoResidue();
  }
});

test("M1 task lifecycle requires outcome/reason, enforces version and audits assignment", opts, async () => {
  const fixtures = createFixtureContext("m1-task-life");
  try {
    const organizationId = await fixtures.makeOrganization("team");
    const owner = await fixtures.makeMember("owner", { organizationId, role: "AGENT" });
    const assignee = await fixtures.makeMember("assignee", { organizationId, role: "AGENT" });
    const manager = await fixtures.makeMember("manager", { organizationId, role: "MANAGER" });
    const canonicalCase = await fixtures.makeCase(owner, "task-life");

    const completedCandidate = await createTask(owner.context, {
      leadId: canonicalCase.leadId,
      title: "Record client decision",
      expectedOutcome: "Decision recorded",
    }, meta(`m1:${fixtures.runId}:task-complete-create`));
    await expectCommandError(completeTask(owner.context, completedCandidate.id, {
      outcome: " ",
      version: completedCandidate.version,
    }, meta(`m1:${fixtures.runId}:task-empty-outcome`)), 422);

    const sensitiveTaskOutcome = `PRIVATE-TASK-OUTCOME-${fixtures.runId}`;
    const completed = await completeTask(owner.context, completedCandidate.id, {
      outcome: sensitiveTaskOutcome,
      version: completedCandidate.version,
    }, meta(`m1:${fixtures.runId}:task-complete`));
    assert.equal(completed.status, "COMPLETED");
    assert.equal(completed.version, 2);
    assert.ok(completed.completedAt);
    const completedRow = await db.task.findUniqueOrThrow({ where: { id: completed.id } });
    assert.equal(completedRow.outcome, sensitiveTaskOutcome);
    assert.ok(completedRow.completedAt);

    const replay = await completeTask(owner.context, completedCandidate.id, {
      outcome: "Client approved next step",
      version: completedCandidate.version,
    }, meta(`m1:${fixtures.runId}:task-complete`));
    assert.equal(replay.replayed, true);
    assert.equal(replay.version, 2);
    const noOpKey = `m1:${fixtures.runId}:task-complete-noop`;
    const noOp = await completeTask(owner.context, completedCandidate.id, {
      outcome: `PRIVATE-NOOP-${fixtures.runId}`,
      version: completed.version,
    }, meta(noOpKey));
    assert.equal(noOp.replayed, true);
    assert.equal(noOp.version, completed.version);
    const noOpAudit = await db.operationalAuditEvent.findUniqueOrThrow({
      where: { organizationId_idempotencyKey: { organizationId, idempotencyKey: noOpKey } },
    });
    assert.equal(noOpAudit.action, "task.completion_noop");
    assert.deepEqual(noOpAudit.before, noOpAudit.after);
    const otherTask = await createTask(owner.context, {
      leadId: canonicalCase.leadId,
      title: "Different entity for replay guard",
    }, meta(`m1:${fixtures.runId}:task-replay-other-create`));
    await expectCommandError(completeTask(owner.context, otherTask.id, {
      outcome: "Must not replay another entity",
      version: otherTask.version,
    }, meta(`m1:${fixtures.runId}:task-complete`)), 409, "IDEMPOTENCY_CONFLICT");
    await expectCommandError(completeTask(owner.context, completedCandidate.id, {
      outcome: "Stale overwrite",
      version: 1,
    }, meta(`m1:${fixtures.runId}:task-stale`)), 409, "VERSION_CONFLICT");

    const cancelledCandidate = await createTask(owner.context, {
      leadId: canonicalCase.leadId,
      title: "Obsolete follow-up",
    }, meta(`m1:${fixtures.runId}:task-cancel-create`));
    await expectCommandError(cancelTask(owner.context, cancelledCandidate.id, {
      reason: " ",
      version: cancelledCandidate.version,
    }, meta(`m1:${fixtures.runId}:task-empty-reason`)), 422);
    const cancelled = await cancelTask(owner.context, cancelledCandidate.id, {
      reason: "Client changed requested channel",
      version: cancelledCandidate.version,
    }, meta(`m1:${fixtures.runId}:task-cancel`));
    assert.equal(cancelled.status, "CANCELLED");
    const cancelledRow = await db.task.findUniqueOrThrow({ where: { id: cancelled.id } });
    assert.equal(cancelledRow.outcome, "Client changed requested channel");
    assert.ok(cancelledRow.cancelledAt);

    const assignmentCandidate = await createTask(owner.context, {
      leadId: canonicalCase.leadId,
      title: "Prepare documents",
    }, meta(`m1:${fixtures.runId}:task-assign-create`));
    const assigned = await assignTask(manager.context, assignmentCandidate.id, {
      assigneeMembershipId: assignee.membershipId,
      reason: "Assignee owns document workflow",
      version: assignmentCandidate.version,
    }, meta(`m1:${fixtures.runId}:task-assign`));
    assert.equal(assigned.version, 2);
    assert.equal(assigned.assigneeMembershipId, assignee.membershipId);
    const assignmentAudit = await db.operationalAuditEvent.findUniqueOrThrow({
      where: {
        organizationId_idempotencyKey: {
          organizationId,
          idempotencyKey: `m1:${fixtures.runId}:task-assign`,
        },
      },
    });
    assert.equal(assignmentAudit.action, "task.assigned");
    assert.equal(assignmentAudit.reason, null);
    assert.equal(assignmentAudit.actorMembershipId, manager.membershipId);
    const waitingCandidate = await createTask(owner.context, {
      leadId: canonicalCase.leadId,
      title: "Wait for external confirmation",
    }, meta(`m1:${fixtures.runId}:task-wait-create`));
    const sensitiveWaitingReason = `PRIVATE-WAITING-REASON-${fixtures.runId}`;
    await waitTask(owner.context, waitingCandidate.id, {
      waitingReason: sensitiveWaitingReason,
      version: waitingCandidate.version,
    }, meta(`m1:${fixtures.runId}:task-wait`));
    const taskAudit = await db.operationalAuditEvent.findMany({ where: { organizationId, entityType: "task" } });
    const serializedTaskAudit = JSON.stringify(taskAudit);
    assert.equal(serializedTaskAudit.includes(sensitiveTaskOutcome), false);
    assert.equal(serializedTaskAudit.includes(sensitiveWaitingReason), false);
    assert.equal(serializedTaskAudit.includes("Assignee owns document workflow"), false);
  } finally {
    await fixtures.cleanup();
    await fixtures.assertNoResidue();
  }
});

test("M1 idempotency replay reauthorizes task and meeting resources", opts, async () => {
  const fixtures = createFixtureContext("m1-replay-auth");
  try {
    const organizationId = await fixtures.makeOrganization("team");
    const owner = await fixtures.makeMember("owner", { organizationId, role: "AGENT" });
    const teammate = await fixtures.makeMember("teammate", { organizationId, role: "AGENT" });
    const manager = await fixtures.makeMember("manager", { organizationId, role: "MANAGER" });
    const ownerCase = await fixtures.makeCase(owner, "owner-case");
    const teammateCase = await fixtures.makeCase(teammate, "teammate-case");

    const taskCreateKey = `m1:${fixtures.runId}:task-create`;
    const task = await createTask(owner.context, {
      leadId: ownerCase.leadId,
      title: "Owner-only replay target",
    }, meta(taskCreateKey));
    await expectCommandError(createTask(teammate.context, {
      leadId: teammateCase.leadId,
      title: "Must not receive owner replay",
    }, meta(taskCreateKey)), 404);
    assert.equal(await db.task.count({ where: { caseId: teammateCase.id } }), 0);
    assert.equal((await createTask(manager.context, {
      leadId: ownerCase.leadId,
      title: "Manager may replay team command",
    }, meta(taskCreateKey))).replayed, true);

    const taskCompleteKey = `m1:${fixtures.runId}:task-complete`;
    const completed = await completeTask(owner.context, task.id, {
      outcome: "Owner completed the task",
      version: task.version,
    }, meta(taskCompleteKey));
    await expectCommandError(completeTask(teammate.context, task.id, {
      outcome: "Must not receive owner result",
      version: completed.version,
    }, meta(taskCompleteKey)), 404);

    const meetingCreateKey = `m1:${fixtures.runId}:meeting-create`;
    const meeting = await createMeeting(owner.context, {
      leadId: ownerCase.leadId,
      scheduledAt: new Date(Date.now() + 3_600_000),
    }, meta(meetingCreateKey));
    await expectCommandError(createMeeting(teammate.context, {
      leadId: teammateCase.leadId,
      scheduledAt: new Date(Date.now() + 7_200_000),
    }, meta(meetingCreateKey)), 404);

    const meetingStatusKey = `m1:${fixtures.runId}:meeting-confirm`;
    const confirmed = await updateMeetingStatus(owner.context, meeting.id, {
      status: "CONFIRMED",
      version: meeting.version,
    }, meta(meetingStatusKey));
    await expectCommandError(updateMeetingStatus(teammate.context, meeting.id, {
      status: "CONFIRMED",
      version: confirmed.version,
    }, meta(meetingStatusKey)), 404);
  } finally {
    await fixtures.cleanup();
    await fixtures.assertNoResidue();
  }
});

test("M1 meeting lifecycle requires outcome/reason and rejects stale versions", opts, async () => {
  const fixtures = createFixtureContext("m1-meeting-life");
  try {
    const owner = await fixtures.makeAgent("owner");
    const canonicalCase = await fixtures.makeCase(owner, "meeting-life");
    const tentative = await createMeeting(owner.context, {
      leadId: canonicalCase.leadId,
      scheduledAt: null,
      location: `PRIVATE-MEETING-LOCATION-${fixtures.runId}`,
    }, meta(`m1:${fixtures.runId}:meeting-create`));
    assert.equal(tentative.status, "TENTATIVE");
    assert.equal(tentative.scheduledAt, null);

    const scheduledAt = new Date(Date.now() + 3_600_000);
    await expectCommandError(rescheduleMeeting(owner.context, tentative.id, {
      scheduledAt,
      reason: " ",
      version: tentative.version,
    }, meta(`m1:${fixtures.runId}:meeting-empty-reason`)), 422);
    const scheduled = await rescheduleMeeting(owner.context, tentative.id, {
      scheduledAt,
      durationMinutes: 60,
      reason: "Family confirmed a time",
      version: tentative.version,
    }, meta(`m1:${fixtures.runId}:meeting-schedule`));
    assert.equal(scheduled.status, "SCHEDULED");
    assert.equal(scheduled.version, 2);

    const confirmed = await updateMeetingStatus(owner.context, tentative.id, {
      status: "CONFIRMED",
      version: scheduled.version,
    }, meta(`m1:${fixtures.runId}:meeting-confirm`));
    assert.equal(confirmed.status, "CONFIRMED");
    assert.equal(confirmed.version, 3);
    await expectCommandError(updateMeetingStatus(owner.context, tentative.id, {
      status: "COMPLETED",
      outcome: " ",
      version: confirmed.version,
    }, meta(`m1:${fixtures.runId}:meeting-empty-outcome`)), 422);

    const completed = await updateMeetingStatus(owner.context, tentative.id, {
      status: "COMPLETED",
      outcome: "Needs and next step recorded",
      version: confirmed.version,
    }, meta(`m1:${fixtures.runId}:meeting-complete`));
    assert.equal(completed.status, "COMPLETED");
    assert.equal(completed.version, 4);
    const completedRow = await db.meeting.findUniqueOrThrow({ where: { id: completed.id } });
    assert.equal(completedRow.outcome, "Needs and next step recorded");
    assert.ok(completedRow.outcomeRecordedAt);
    assert.ok(completedRow.endedAt);
    const meetingAudit = await db.operationalAuditEvent.findMany({ where: { organizationId: owner.organizationId, entityType: "meeting" } });
    const serializedMeetingAudit = JSON.stringify(meetingAudit);
    assert.equal(serializedMeetingAudit.includes(`PRIVATE-MEETING-LOCATION-${fixtures.runId}`), false);
    assert.equal(serializedMeetingAudit.includes("Family confirmed a time"), false);
    assert.equal(serializedMeetingAudit.includes("Needs and next step recorded"), false);
    const replayGuardMeeting = await createMeeting(owner.context, {
      leadId: canonicalCase.leadId,
      scheduledAt: new Date(Date.now() + 10_800_000),
    }, meta(`m1:${fixtures.runId}:meeting-replay-guard-create`));
    await expectCommandError(updateMeetingStatus(owner.context, replayGuardMeeting.id, {
      status: "COMPLETED",
      outcome: "Must not replay another entity",
      version: replayGuardMeeting.version,
    }, meta(`m1:${fixtures.runId}:meeting-complete`)), 409, "IDEMPOTENCY_CONFLICT");
    await expectCommandError(updateMeetingStatus(owner.context, tentative.id, {
      status: "CANCELLED",
      reason: "Stale cancel",
      version: confirmed.version,
    }, meta(`m1:${fixtures.runId}:meeting-stale`)), 409, "VERSION_CONFLICT");

    const cancelledCandidate = await createMeeting(owner.context, {
      leadId: canonicalCase.leadId,
      scheduledAt: null,
    }, meta(`m1:${fixtures.runId}:meeting-cancel-create`));
    const cancelled = await updateMeetingStatus(owner.context, cancelledCandidate.id, {
      status: "CANCELLED",
      reason: "Family requested another date",
      version: cancelledCandidate.version,
    }, meta(`m1:${fixtures.runId}:meeting-cancel`));
    assert.equal(cancelled.status, "CANCELLED");
    assert.equal((await db.meeting.findUniqueOrThrow({ where: { id: cancelled.id } })).outcome, "Family requested another date");
  } finally {
    await fixtures.cleanup();
    await fixtures.assertNoResidue();
  }
});

test("M1 concurrent task, meeting and case projection commands create one canonical result", opts, async () => {
  const fixtures = createFixtureContext("m1-concurrent");
  try {
    const owner = await fixtures.makeAgent("owner");
    const canonicalCase = await fixtures.makeCase(owner, "concurrent");
    const taskKey = `m1:${fixtures.runId}:concurrent-task`;
    const taskResults = await Promise.all(Array.from({ length: 6 }, () => createTask(owner.context, {
      leadId: canonicalCase.leadId,
      title: "Concurrent task",
    }, meta(taskKey))));
    assert.equal(new Set(taskResults.map((item) => item.id)).size, 1);
    assert.equal(taskResults.filter((item) => item.replayed).length, 5);
    assert.equal(await db.task.count({ where: { organizationId: owner.organizationId, idempotencyKey: taskKey } }), 1);
    assert.equal(await db.operationalAuditEvent.count({ where: { organizationId: owner.organizationId, idempotencyKey: taskKey } }), 1);

    const meetingKey = `m1:${fixtures.runId}:concurrent-meeting`;
    const meetingResults = await Promise.all(Array.from({ length: 6 }, () => createMeeting(owner.context, {
      leadId: canonicalCase.leadId,
      scheduledAt: new Date(Date.now() + 7_200_000),
    }, meta(meetingKey))));
    assert.equal(new Set(meetingResults.map((item) => item.id)).size, 1);
    assert.equal(meetingResults.filter((item) => item.replayed).length, 5);
    assert.equal(await db.meeting.count({ where: { organizationId: owner.organizationId, idempotencyKey: meetingKey } }), 1);
    assert.equal(await db.operationalAuditEvent.count({ where: { organizationId: owner.organizationId, idempotencyKey: meetingKey } }), 1);

    await db.case.update({
      where: { id: canonicalCase.id },
      data: { stage: "PLANNING", scenarioId: "UNSELECTED" },
    });
    const projectionKey = `m1:${fixtures.runId}:scenario`;
    const projectionResults = await Promise.all(Array.from({ length: 4 }, () => transitionCase({
      leadId: canonicalCase.leadId,
      eventType: "scenario.selected.v1",
      payload: { scenarioId: "CREMATION_V1" },
      context: {
        organizationId: owner.organizationId,
        membershipId: owner.membershipId,
        agentId: owner.agentId,
        actorId: owner.agentId,
        idempotencyKey: projectionKey,
        correlationId: `correlation:${projectionKey}`,
      },
    })));
    assert.equal(new Set(projectionResults.map((item) => item.eventId)).size, 1);
    assert.equal(projectionResults.filter((item) => item.replayed).length, 3);
    const event = await db.caseEvent.findUniqueOrThrow({
      where: { tenantId_idempotencyKey: { tenantId: owner.organizationId, idempotencyKey: projectionKey } },
    });
    assert.equal(await db.projectionReceipt.count({
      where: { organizationId: owner.organizationId, projector: "m1.case-work.v1", sourceEventId: event.id },
    }), 1);
    assert.equal(await db.task.count({
      where: { organizationId: owner.organizationId, sourceEventId: event.id, type: { in: ["PREPARATION", "QUOTE_SEND"] } },
    }), 2);
  } finally {
    await fixtures.cleanup();
    await fixtures.assertNoResidue();
  }
});

test("M1 past meeting escalation is visible, idempotent and reconciles to zero", opts, async () => {
  const fixtures = createFixtureContext("m1-escalation");
  try {
    const owner = await fixtures.makeAgent("owner");
    const teammate = await fixtures.makeMember("teammate", { organizationId: owner.organizationId, role: "AGENT" });
    const manager = await fixtures.makeMember("manager", { organizationId: owner.organizationId, role: "MANAGER" });
    const canonicalCase = await fixtures.makeCase(owner, "past-meeting");
    const pastMeeting = await createMeeting(owner.context, {
      leadId: canonicalCase.leadId,
      scheduledAt: new Date(Date.now() - 3_600_000),
    }, meta(`m1:${fixtures.runId}:past-meeting`));

    const before = await getOperationsQueue(owner.context);
    const visibleMeeting = Object.values(before.groups).flat().find((item) => item.key === `meeting:${pastMeeting.id}`);
    assert.equal(visibleMeeting?.group, "OVERDUE");
    assert.equal(visibleMeeting?.actionLabel, "Зафиксировать исход");

    const now = new Date();
    const projections = await Promise.all(Array.from({ length: 5 }, () => ensurePastMeetingEscalations(owner.organizationId, now)));
    assert.equal(projections.reduce((sum, item) => sum + item.created, 0), 1);
    const sourceEventId = `meeting:${pastMeeting.id}:past-due:v1`;
    assert.equal(await db.task.count({
      where: { organizationId: owner.organizationId, sourceEventId, type: "MEETING_ESCALATION" },
    }), 1);
    assert.equal(await db.projectionReceipt.count({
      where: { organizationId: owner.organizationId, projector: "m1.meeting-escalation.v1", sourceEventId },
    }), 1);

    const after = await getOperationsQueue(owner.context, now);
    const afterItems = Object.values(after.groups).flat();
    const escalation = afterItems.find((item) => item.source === "Просроченная встреча");
    assert.equal(escalation?.group, "OVERDUE");
    assert.equal(escalation?.href, `/agent/meetings/${pastMeeting.id}?from=today`);
    assert.equal(afterItems.some((item) => item.key === `meeting:${pastMeeting.id}`), false);
    assert.equal(afterItems.filter((item) => item.href === `/agent/meetings/${pastMeeting.id}?from=today`).length, 1);
    const escalationTaskBeforeOutcome = await db.task.findFirstOrThrow({ where: { organizationId: owner.organizationId, sourceEventId } });
    await expectCommandError(assignTask(manager.context, escalationTaskBeforeOutcome.id, {
      assigneeMembershipId: teammate.membershipId,
      reason: "Must remain executable by the meeting owner",
      version: escalationTaskBeforeOutcome.version,
    }, meta(`m1:${fixtures.runId}:escalation-reassign-denied`)), 409, "MEETING_OWNER_REQUIRED");
    await expectCommandError(completeTask(owner.context, escalationTaskBeforeOutcome.id, {
      outcome: "Must be captured on the meeting",
      version: escalationTaskBeforeOutcome.version,
    }, meta(`m1:${fixtures.runId}:escalation-direct-complete-denied`)), 409, "MEETING_OUTCOME_REQUIRED");
    const reconciliation = await reconcileOperations(owner.organizationId, now);
    assert.equal(reconciliation.discrepancies, 0, JSON.stringify(reconciliation));

    const completed = await updateMeetingStatus(owner.context, pastMeeting.id, {
      status: "COMPLETED",
      outcome: "Meeting outcome captured",
      version: pastMeeting.version,
    }, meta(`m1:${fixtures.runId}:past-complete`));
    assert.equal(completed.status, "COMPLETED");
    const escalationTask = await db.task.findFirstOrThrow({ where: { organizationId: owner.organizationId, sourceEventId } });
    assert.equal(escalationTask.status, "COMPLETED");
    assert.equal(escalationTask.outcome, "Meeting outcome captured");
    assert.equal((await reconcileOperations(owner.organizationId, new Date())).discrepancies, 0);
  } finally {
    await fixtures.cleanup();
    await fixtures.assertNoResidue();
  }
});

test("M1 confirming a past meeting replaces its versioned escalation exactly once", opts, async () => {
  const fixtures = createFixtureContext("m1-escalation-confirm");
  try {
    const owner = await fixtures.makeAgent("owner");
    const canonicalCase = await fixtures.makeCase(owner, "past-meeting-confirm");
    const now = new Date();
    const meeting = await createMeeting(owner.context, {
      leadId: canonicalCase.leadId,
      scheduledAt: new Date(now.getTime() - 3_600_000),
    }, meta(`m1:${fixtures.runId}:meeting`));
    assert.equal((await ensurePastMeetingEscalations(owner.organizationId, now)).created, 1);
    const oldSource = `meeting:${meeting.id}:past-due:v${meeting.version}`;

    const confirmed = await updateMeetingStatus(owner.context, meeting.id, {
      status: "CONFIRMED",
      version: meeting.version,
    }, meta(`m1:${fixtures.runId}:confirm`));
    const currentSource = `meeting:${meeting.id}:past-due:v${confirmed.version}`;
    assert.equal(await db.task.count({ where: { organizationId: owner.organizationId, sourceEventId: oldSource, status: "CANCELLED" } }), 1);
    assert.equal(await db.task.count({ where: { organizationId: owner.organizationId, sourceEventId: currentSource, status: "OPEN" } }), 1);
    assert.equal(await db.task.count({ where: { organizationId: owner.organizationId, type: "MEETING_ESCALATION", status: "OPEN" } }), 1);
    assert.equal((await ensurePastMeetingEscalations(owner.organizationId, now)).created, 0);
    assert.equal((await reconcileOperations(owner.organizationId, now)).discrepancies, 0);
  } finally {
    await fixtures.cleanup();
    await fixtures.assertNoResidue();
  }
});

test("M1 meeting confirmation rolls back status and stale escalation when projection fails", opts, async () => {
  const fixtures = createFixtureContext("m1-escalation-confirm-rollback");
  try {
    const owner = await fixtures.makeAgent("owner");
    const canonicalCase = await fixtures.makeCase(owner, "past-meeting-confirm-rollback");
    const now = new Date();
    const meeting = await createMeeting(owner.context, {
      leadId: canonicalCase.leadId,
      scheduledAt: new Date(now.getTime() - 3_600_000),
    }, meta(`m1:${fixtures.runId}:meeting`));
    assert.equal((await ensurePastMeetingEscalations(owner.organizationId, now)).created, 1);
    const oldSource = `meeting:${meeting.id}:past-due:v${meeting.version}`;
    const conflictingProjectionKey = `projection:meeting:${meeting.id}:past-due:v${meeting.version + 1}:task`;
    await createTask(owner.context, {
      leadId: canonicalCase.leadId,
      title: "Synthetic projection conflict",
    }, meta(conflictingProjectionKey));

    await assert.rejects(updateMeetingStatus(owner.context, meeting.id, {
      status: "CONFIRMED",
      version: meeting.version,
    }, meta(`m1:${fixtures.runId}:confirm`)), (error: unknown) => {
      assert.ok(error instanceof Prisma.PrismaClientKnownRequestError);
      assert.equal(error.code, "P2002");
      return true;
    });

    const unchangedMeeting = await db.meeting.findUniqueOrThrow({ where: { id: meeting.id } });
    assert.equal(unchangedMeeting.operationalStatus, "SCHEDULED");
    assert.equal(unchangedMeeting.version, meeting.version);
    assert.equal(await db.task.count({
      where: { organizationId: owner.organizationId, sourceEventId: oldSource, status: "OPEN" },
    }), 1);
    assert.equal(await db.projectionReceipt.count({
      where: {
        organizationId: owner.organizationId,
        projector: "m1.meeting-escalation.v1",
        sourceEventId: `meeting:${meeting.id}:past-due:v${meeting.version + 1}`,
      },
    }), 0);
  } finally {
    await fixtures.cleanup();
    await fixtures.assertNoResidue();
  }
});

test("M1 meeting escalations are system-only tasks", opts, async () => {
  const fixtures = createFixtureContext("m1-system-task-type");
  try {
    const owner = await fixtures.makeAgent("owner");
    const canonicalCase = await fixtures.makeCase(owner, "system-task-type");
    await expectCommandError(createTask(owner.context, {
      leadId: canonicalCase.leadId,
      title: "Manual escalation must be rejected",
      type: "MEETING_ESCALATION",
    }, meta(`m1:${fixtures.runId}:manual-escalation`)), 422, "SYSTEM_TASK_TYPE");
    assert.equal(await db.task.count({
      where: { organizationId: owner.organizationId, type: "MEETING_ESCALATION" },
    }), 0);
  } finally {
    await fixtures.cleanup();
    await fixtures.assertNoResidue();
  }
});

test("M1 stale past-meeting candidate cannot create escalation after terminal outcome", opts, async () => {
  const fixtures = createFixtureContext("m1-escalation-race");
  try {
    const owner = await fixtures.makeAgent("owner");
    const canonicalCase = await fixtures.makeCase(owner, "past-meeting-race");
    const pastMeeting = await createMeeting(owner.context, {
      leadId: canonicalCase.leadId,
      scheduledAt: new Date(Date.now() - 3_600_000),
    }, meta(`m1:${fixtures.runId}:past-meeting-race`));
    await updateMeetingStatus(owner.context, pastMeeting.id, {
      status: "COMPLETED",
      outcome: "Terminal outcome won the race",
      version: pastMeeting.version,
    }, meta(`m1:${fixtures.runId}:past-meeting-race-complete`));

    const created = await projectPastMeetingEscalation(owner.organizationId, pastMeeting.id, new Date());
    assert.equal(created, false);
    assert.equal(await db.task.count({
      where: { organizationId: owner.organizationId, sourceEventId: `meeting:${pastMeeting.id}:past-due:v1` },
    }), 0);
    assert.equal((await reconcileOperations(owner.organizationId, new Date())).discrepancies, 0);
  } finally {
    await fixtures.cleanup();
    await fixtures.assertNoResidue();
  }
});

test("M1 rescheduled past meeting closes stale escalation and projects the new schedule once", opts, async () => {
  const fixtures = createFixtureContext("m1-escalation-reschedule");
  try {
    const owner = await fixtures.makeAgent("owner");
    const canonicalCase = await fixtures.makeCase(owner, "past-meeting-rescheduled");
    const initialNow = new Date();
    const meeting = await createMeeting(owner.context, {
      leadId: canonicalCase.leadId,
      scheduledAt: new Date(initialNow.getTime() - 3_600_000),
    }, meta(`m1:${fixtures.runId}:meeting`));
    assert.equal((await ensurePastMeetingEscalations(owner.organizationId, initialNow)).created, 1);
    const staleSource = `meeting:${meeting.id}:past-due:v${meeting.version}`;
    const staleTask = await db.task.findFirstOrThrow({ where: { organizationId: owner.organizationId, sourceEventId: staleSource } });
    assert.equal(staleTask.status, "OPEN");

    const futureAt = new Date(initialNow.getTime() + 3_600_000);
    const rescheduled = await rescheduleMeeting(owner.context, meeting.id, {
      scheduledAt: futureAt,
      reason: "Synthetic reschedule reason",
      version: meeting.version,
    }, meta(`m1:${fixtures.runId}:reschedule`));
    assert.equal(rescheduled.version, meeting.version + 1);
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: staleTask.id } })).status, "CANCELLED");
    assert.equal((await reconcileOperations(owner.organizationId, initialNow)).discrepancies, 0);
    assert.equal((await ensurePastMeetingEscalations(owner.organizationId, initialNow)).created, 0);

    const afterRescheduledTime = new Date(futureAt.getTime() + 1_000);
    const projections = await Promise.all(Array.from({ length: 3 }, () => ensurePastMeetingEscalations(owner.organizationId, afterRescheduledTime)));
    assert.equal(projections.reduce((sum, projection) => sum + projection.created, 0), 1);
    const currentSource = `meeting:${meeting.id}:past-due:v${rescheduled.version}`;
    assert.equal(await db.task.count({ where: { organizationId: owner.organizationId, sourceEventId: currentSource, status: "OPEN" } }), 1);
    assert.equal((await reconcileOperations(owner.organizationId, afterRescheduledTime)).discrepancies, 0);

    await updateMeetingStatus(owner.context, meeting.id, {
      status: "COMPLETED",
      outcome: "Synthetic meeting outcome",
      version: rescheduled.version,
    }, meta(`m1:${fixtures.runId}:complete`));
    assert.equal(await db.task.count({ where: { organizationId: owner.organizationId, type: "MEETING_ESCALATION", status: "OPEN" } }), 0);
    assert.equal((await reconcileOperations(owner.organizationId, afterRescheduledTime)).discrepancies, 0);
  } finally {
    await fixtures.cleanup();
    await fixtures.assertNoResidue();
  }
});

test("M1 control tower counts only upcoming ceremony SLA and includes meetings in capacity", opts, async () => {
  const fixtures = createFixtureContext("m1-capacity-sla");
  try {
    const now = new Date("2026-07-22T09:00:00.000Z");
    const organizationId = await fixtures.makeOrganization("capacity-team");
    const agent = await fixtures.makeMember("capacity-agent", { organizationId, role: "AGENT" });
    const manager = await fixtures.makeMember("capacity-manager", { organizationId, role: "MANAGER" });
    await fixtures.makeCase(agent, "past-ceremony", { ceremonyAt: new Date(now.getTime() - 3_600_000) });
    const futureCase = await fixtures.makeCase(agent, "future-ceremony", { ceremonyAt: new Date(now.getTime() + 48 * 3_600_000) });
    const manual = await createTask(agent.context, {
      leadId: futureCase.leadId,
      title: "Confirm ceremony details",
      dueAt: new Date(now.getTime() + 2 * 3_600_000),
    }, meta(`m1:${fixtures.runId}:capacity-task`));
    await createMeeting(agent.context, {
      leadId: futureCase.leadId,
      scheduledAt: new Date(now.getTime() + 4 * 3_600_000),
    }, meta(`m1:${fixtures.runId}:capacity-meeting`));

    const queue = await getOperationsQueue(agent.context, now);
    const manualItem = Object.values(queue.groups).flat().find((item) => item.id === manual.id && item.kind === "TASK");
    assert.equal(manualItem?.reason, "Агент зафиксировал обязательное действие по кейсу");

    const tower = await getTeamControlTower(manager.context, now);
    assert.equal(tower.totals.ceremoniesSoon, 1, "Past ceremonies must not remain in the 72-hour SLA window");
    const member = tower.members.find((item) => item.membershipId === agent.membershipId);
    assert.ok(member);
    assert.equal(member.workload, member.open + member.meetings * 2);
    assert.equal(member.meetings, 1);
  } finally {
    await fixtures.cleanup();
    await fixtures.assertNoResidue();
  }
});

test("M1 agent escalation sync cannot project another member's meeting", opts, async () => {
  const fixtures = createFixtureContext("m1-escalation-scope");
  try {
    const organizationId = await fixtures.makeOrganization("scope-team");
    const left = await fixtures.makeMember("left", { organizationId, role: "AGENT" });
    const right = await fixtures.makeMember("right", { organizationId, role: "AGENT" });
    const leftCase = await fixtures.makeCase(left, "left-case");
    const rightCase = await fixtures.makeCase(right, "right-case");
    const scheduledAt = new Date(Date.now() - 3_600_000);
    const leftMeeting = await createMeeting(left.context, { leadId: leftCase.leadId, scheduledAt }, meta(`m1:${fixtures.runId}:left-meeting`));
    const rightMeeting = await createMeeting(right.context, { leadId: rightCase.leadId, scheduledAt }, meta(`m1:${fixtures.runId}:right-meeting`));

    const projection = await ensurePastMeetingEscalations(left.context, new Date());
    assert.equal(projection.scanned, 1);
    assert.equal(projection.created, 1);
    assert.equal(await db.task.count({ where: { organizationId, sourceEventId: `meeting:${leftMeeting.id}:past-due:v1` } }), 1);
    assert.equal(await db.task.count({ where: { organizationId, sourceEventId: `meeting:${rightMeeting.id}:past-due:v1` } }), 0);
  } finally {
    await fixtures.cleanup();
    await fixtures.assertNoResidue();
  }
});

test("M1 cremation and family-plot pilots reach commercial readiness through one operational truth", opts, async () => {
  const fixtures = createFixtureContext("m1-pilots");
  try {
    const organizationId = await fixtures.makeOrganization("pilot-team");
    const agent = await fixtures.makeMember("pilot-agent", { organizationId, role: "AGENT" });
    const coordinator = await fixtures.makeMember("pilot-coordinator", { organizationId, role: "AGENT" });
    const manager = await fixtures.makeMember("pilot-manager", { organizationId, role: "MANAGER" });
    const scenarios = [
      { id: "CREMATION_V1" as const, ceremonyType: "кремация" },
      { id: "FAMILY_PLOT_BURIAL_V1" as const, ceremonyType: "родственное захоронение" },
    ];

    for (const [index, scenario] of scenarios.entries()) {
      const canonicalCase = await fixtures.makeCase(agent, `pilot-${index}`, {
        ceremonyAt: new Date(Date.now() + (48 + index) * 3_600_000),
      });
      await db.clientLead.update({
        where: { id: canonicalCase.leadId },
        data: { deceasedName: "enc1:synthetic", ceremonyType: scenario.ceremonyType },
      });

      await transitionCase({
        leadId: canonicalCase.leadId,
        eventType: "intake.completed.v1",
        payload: {},
        context: {
          organizationId,
          membershipId: agent.membershipId,
          agentId: agent.agentId,
          actorId: agent.agentId,
          idempotencyKey: `m1:${fixtures.runId}:${scenario.id}:intake`,
          correlationId: `m1:${fixtures.runId}:${scenario.id}`,
        },
      });
      await transitionCase({
        leadId: canonicalCase.leadId,
        eventType: "scenario.selected.v1",
        payload: { scenarioId: scenario.id },
        context: {
          organizationId,
          membershipId: agent.membershipId,
          agentId: agent.agentId,
          actorId: agent.agentId,
          idempotencyKey: `m1:${fixtures.runId}:${scenario.id}:scenario`,
          correlationId: `m1:${fixtures.runId}:${scenario.id}`,
        },
      });

      const projectedTasks = await db.task.findMany({
        where: { organizationId, caseId: canonicalCase.id, status: "OPEN" },
        orderBy: { id: "asc" },
      });
      assert.deepEqual(new Set(projectedTasks.map((task) => task.type)), new Set(["PREPARATION", "QUOTE_SEND"]));
      const preparation = projectedTasks.find((task) => task.type === "PREPARATION")!;
      const assigned = await assignTask(manager.context, preparation.id, {
        assigneeMembershipId: coordinator.membershipId,
        reason: `Координатор ведёт подготовку: ${scenario.ceremonyType}`,
        version: preparation.version,
      }, meta(`m1:${fixtures.runId}:${scenario.id}:assign`));

      const tentative = await createMeeting(agent.context, {
        leadId: canonicalCase.leadId,
        scheduledAt: null,
        type: "CONSULTATION",
      }, meta(`m1:${fixtures.runId}:${scenario.id}:meeting`));
      assert.equal(tentative.status, "TENTATIVE");
      const scheduled = await rescheduleMeeting(agent.context, tentative.id, {
        scheduledAt: new Date(Date.now() + (2 + index) * 3_600_000),
        durationMinutes: 60,
        reason: "Семья подтвердила время",
        version: tentative.version,
      }, meta(`m1:${fixtures.runId}:${scenario.id}:schedule`));
      const confirmed = await updateMeetingStatus(agent.context, tentative.id, {
        status: "CONFIRMED",
        version: scheduled.version,
      }, meta(`m1:${fixtures.runId}:${scenario.id}:confirm`));
      const completedMeeting = await updateMeetingStatus(agent.context, tentative.id, {
        status: "COMPLETED",
        outcome: `Потребности по сценарию «${scenario.ceremonyType}» зафиксированы`,
        version: confirmed.version,
      }, meta(`m1:${fixtures.runId}:${scenario.id}:outcome`));
      assert.equal(completedMeeting.status, "COMPLETED");

      const completedPreparation = await completeTask(coordinator.context, assigned.id, {
        outcome: `Чек-лист «${scenario.ceremonyType}» подготовлен`,
        version: assigned.version,
      }, meta(`m1:${fixtures.runId}:${scenario.id}:prepared`));
      assert.equal(completedPreparation.status, "COMPLETED");

      const aggregate = await db.case.findUniqueOrThrow({ where: { id: canonicalCase.id } });
      assert.equal(aggregate.stage, "QUOTING");
      assert.equal(aggregate.scenarioId, scenario.id);
      assert.equal(await db.task.count({ where: { caseId: canonicalCase.id, type: "QUOTE_SEND", status: "OPEN" } }), 1);
      assert.equal(await db.operationalAuditEvent.count({
        where: {
          organizationId,
          idempotencyKey: { in: [
            `m1:${fixtures.runId}:${scenario.id}:assign`,
            `m1:${fixtures.runId}:${scenario.id}:meeting`,
            `m1:${fixtures.runId}:${scenario.id}:schedule`,
            `m1:${fixtures.runId}:${scenario.id}:confirm`,
            `m1:${fixtures.runId}:${scenario.id}:outcome`,
            `m1:${fixtures.runId}:${scenario.id}:prepared`,
          ] },
        },
      }), 6, "Every direct pilot mutation must have one immutable audit event");
    }

    const managerTower = await getTeamControlTower(manager.context);
    assert.equal(managerTower.cases.filter((item) => item.stage === "QUOTING").length, 2);
    assert.equal((await reconcileOperations(organizationId, new Date())).discrepancies, 0);
  } finally {
    await fixtures.cleanup();
    await fixtures.assertNoResidue();
  }
});

test("M1 saved views and search remain tenant-scoped", opts, async () => {
  const fixtures = createFixtureContext("m1-search-view");
  try {
    const organizationId = await fixtures.makeOrganization("team");
    const agent = await fixtures.makeMember("agent", { organizationId, role: "AGENT" });
    const manager = await fixtures.makeMember("manager", { organizationId, role: "MANAGER" });
    const ownCase = await fixtures.makeCase(agent, "needle-own");
    await createTask(agent.context, {
      leadId: ownCase.leadId,
      title: "Needle exact task",
    }, meta(`m1:${fixtures.runId}:search-task`));
    await createMeeting(agent.context, {
      leadId: ownCase.leadId,
      scheduledAt: null,
    }, meta(`m1:${fixtures.runId}:search-meeting`));

    const foreign = await fixtures.makeAgent("foreign");
    const foreignCase = await fixtures.makeCase(foreign, "needle-foreign");
    await createTask(foreign.context, {
      leadId: foreignCase.leadId,
      title: "Needle foreign task",
    }, meta(`m1:${fixtures.runId}:foreign-task`));

    const agentSearch = await searchGet(makeRequest("/api/agent/operations/search?q=Needle", {
      cookie: await cookie(agent),
    }));
    assert.equal(agentSearch.status, 200);
    const agentResults = (await agentSearch.json() as { results: Array<{ href: string; label: string }> }).results;
    assert.equal(agentResults.some((item) => new URL(item.href, "http://localhost").pathname === `/agent/cases/${ownCase.leadId}`), true);
    assert.equal(agentResults.some((item) => new URL(item.href, "http://localhost").pathname === `/agent/cases/${foreignCase.leadId}`), false);
    assert.equal(agentResults.some((item) => item.label.includes("foreign")), false);

    const foreignSearch = await searchGet(makeRequest("/api/agent/operations/search?q=Needle", {
      cookie: await cookie(foreign),
    }));
    const foreignResults = (await foreignSearch.json() as { results: Array<{ href: string }> }).results;
    assert.equal(foreignResults.some((item) => new URL(item.href, "http://localhost").pathname === `/agent/cases/${foreignCase.leadId}`), true);
    assert.equal(foreignResults.some((item) => new URL(item.href, "http://localhost").pathname === `/agent/cases/${ownCase.leadId}`), false);

    const agentViewKey = `m1:${fixtures.runId}:agent-view`;
    const agentView = await viewsPost(makeRequest("/api/agent/operations/views", {
      method: "POST",
      cookie: await cookie(agent),
      headers: { "idempotency-key": agentViewKey, "x-correlation-id": `correlation:${agentViewKey}` },
      body: { name: "Мои просроченные", scope: "MY", query: { screen: "today", group: "OVERDUE" } },
    }));
    assert.equal(agentView.status, 201);

    const managerViewKey = `m1:${fixtures.runId}:manager-view`;
    const managerView = await viewsPost(makeRequest("/api/agent/operations/views", {
      method: "POST",
      cookie: await cookie(manager),
      headers: { "idempotency-key": managerViewKey, "x-correlation-id": `correlation:${managerViewKey}` },
      body: { name: "Команда сегодня", scope: "TEAM", query: { screen: "team", filter: "ATTENTION" } },
    }));
    assert.equal(managerView.status, 201);

    const foreignViewKey = `m1:${fixtures.runId}:foreign-view`;
    assert.equal((await viewsPost(makeRequest("/api/agent/operations/views", {
      method: "POST",
      cookie: await cookie(foreign),
      headers: { "idempotency-key": foreignViewKey, "x-correlation-id": `correlation:${foreignViewKey}` },
      body: { name: "Foreign view", scope: "MY", query: { screen: "today", group: "WAITING" } },
    }))).status, 201);

    const sensitiveMarker = `PRIVATE-FAMILY-NOTE-${fixtures.runId}`;
    const rejectedViewKey = `m1:${fixtures.runId}:sensitive-view`;
    assert.equal((await viewsPost(makeRequest("/api/agent/operations/views", {
      method: "POST",
      cookie: await cookie(agent),
      headers: { "idempotency-key": rejectedViewKey, "x-correlation-id": `correlation:${rejectedViewKey}` },
      body: {
        name: sensitiveMarker,
        scope: "MY",
        query: { screen: "today", group: "TODAY", familyNote: sensitiveMarker },
      },
    }))).status, 400);

    const agentViews = await viewsGet(makeRequest("/api/agent/operations/views", { cookie: await cookie(agent) }));
    const agentList = (await agentViews.json() as { views: Array<{ name: string }> }).views;
    assert.deepEqual(agentList.map((item) => item.name), ["Мои просроченные"]);

    const managerViews = await viewsGet(makeRequest("/api/agent/operations/views", { cookie: await cookie(manager) }));
    const managerList = (await managerViews.json() as { views: Array<{ name: string }> }).views;
    assert.equal(managerList.some((item) => item.name === "Команда сегодня"), true);
    assert.equal(managerList.some((item) => item.name === "Foreign view"), false);

    const audit = await db.operationalAuditEvent.findMany({
      where: { organizationId, entityType: "saved_view" },
      select: { idempotencyKey: true, before: true, after: true },
    });
    assert.deepEqual(new Set(audit.map((item) => item.idempotencyKey)), new Set([agentViewKey, managerViewKey]));
    const serializedAudit = JSON.stringify(audit);
    assert.equal(serializedAudit.includes("Мои просроченные"), false);
    assert.equal(serializedAudit.includes("Команда сегодня"), false);
    assert.equal(serializedAudit.includes(sensitiveMarker), false);
  } finally {
    await fixtures.cleanup();
    await fixtures.assertNoResidue();
  }
});
