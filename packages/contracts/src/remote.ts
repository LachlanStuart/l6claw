import { Schema } from "effect";
import { MessageId, ThreadId, TurnId, TrimmedNonEmptyString } from "./baseSchemas";
import { OrchestrationSessionStatus } from "./orchestration";

export const RemoteInteractionId = TrimmedNonEmptyString;
export type RemoteInteractionId = typeof RemoteInteractionId.Type;

export const RemoteThreadTarget = Schema.Union([
  Schema.Struct({
    threadId: ThreadId,
  }),
  Schema.Struct({
    projectName: TrimmedNonEmptyString,
    threadTitle: TrimmedNonEmptyString,
  }),
]);
export type RemoteThreadTarget = typeof RemoteThreadTarget.Type;

export const RemoteThreadListEntry = Schema.Struct({
  projectName: TrimmedNonEmptyString,
  threadTitle: TrimmedNonEmptyString,
  threadId: ThreadId,
  sessionStatus: OrchestrationSessionStatus,
  remoteAccess: Schema.Boolean,
});
export type RemoteThreadListEntry = typeof RemoteThreadListEntry.Type;

export const RemoteThreadsListInput = Schema.Struct({});
export type RemoteThreadsListInput = typeof RemoteThreadsListInput.Type;

export const RemoteThreadsListResult = Schema.Struct({
  threads: Schema.Array(RemoteThreadListEntry),
});
export type RemoteThreadsListResult = typeof RemoteThreadsListResult.Type;

export const RemoteThreadSendInput = Schema.Struct({
  target: RemoteThreadTarget,
  text: Schema.String,
  sender: TrimmedNonEmptyString,
});
export type RemoteThreadSendInput = typeof RemoteThreadSendInput.Type;

export const RemoteThreadSendAccepted = Schema.Struct({
  status: Schema.Literal("accepted"),
  interactionId: RemoteInteractionId,
  threadId: ThreadId,
});
export type RemoteThreadSendAccepted = typeof RemoteThreadSendAccepted.Type;

export const RemoteThreadSteerInput = Schema.Struct({
  interactionId: RemoteInteractionId,
  text: Schema.String,
  sender: TrimmedNonEmptyString,
});
export type RemoteThreadSteerInput = typeof RemoteThreadSteerInput.Type;

export const RemoteThreadSteerAccepted = Schema.Struct({
  status: Schema.Literal("accepted"),
});
export type RemoteThreadSteerAccepted = typeof RemoteThreadSteerAccepted.Type;

export const RemoteAssistantStreamEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("started"),
    interactionId: RemoteInteractionId,
    threadId: ThreadId,
    turnId: Schema.NullOr(TurnId),
  }),
  Schema.Struct({
    type: Schema.Literal("assistant_message_delta"),
    interactionId: RemoteInteractionId,
    threadId: ThreadId,
    messageId: MessageId,
    textDelta: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("assistant_message_completed"),
    interactionId: RemoteInteractionId,
    threadId: ThreadId,
    messageId: MessageId,
  }),
  Schema.Struct({
    type: Schema.Literal("completed"),
    interactionId: RemoteInteractionId,
    threadId: ThreadId,
    turnId: Schema.NullOr(TurnId),
  }),
  Schema.Struct({
    type: Schema.Literal("interrupted"),
    interactionId: RemoteInteractionId,
    threadId: ThreadId,
    turnId: Schema.NullOr(TurnId),
  }),
  Schema.Struct({
    type: Schema.Literal("error"),
    interactionId: RemoteInteractionId,
    threadId: ThreadId,
    code: TrimmedNonEmptyString,
    message: Schema.String,
  }),
]);
export type RemoteAssistantStreamEvent = typeof RemoteAssistantStreamEvent.Type;

export class RemoteApiError extends Schema.TaggedErrorClass<RemoteApiError>()("RemoteApiError", {
  code: TrimmedNonEmptyString,
  message: Schema.String,
}) {}
