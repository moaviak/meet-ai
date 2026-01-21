import {
  CallEndedEvent,
  CallRecordingReadyEvent,
  CallSessionParticipantLeftEvent,
  CallSessionStartedEvent,
  CallTranscriptionReadyEvent,
} from "@stream-io/node-sdk";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/db";
import { inngest } from "@/inngest/client";
import { agents, meetings } from "@/db/schema";
import { streamVideo } from "@/lib/stream-video";

function verifySignatureWithSDK(body: string, signature: string): boolean {
  return streamVideo.verifyWebhook(body, signature);
}

// URL of your Python agent service
const AGENT_SERVICE_URL = process.env.AGENT_SERVICE_URL || "http://localhost:8000";

export async function POST(req: NextRequest) {
  const signature = req.headers.get("x-signature");
  const apiKey = req.headers.get("x-api-key");

  if (!signature || !apiKey) {
    return NextResponse.json(
      { error: "Missing signature or API key" },
      { status: 400 }
    );
  }

  const body = await req.text();

  if (!verifySignatureWithSDK(body, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: unknown;

  try {
    payload = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = (payload as Record<string, unknown>)?.type;

  if (eventType === "call.session_started") {
    const event = payload as CallSessionStartedEvent;
    const meetingId = event.call.custom?.meetingId;

    if (!meetingId) {
      return NextResponse.json({ error: "Missing meetingId" }, { status: 400 });
    }

    const [existingMeeting] = await db
      .select()
      .from(meetings)
      .where(and(eq(meetings.id, meetingId), eq(meetings.status, "upcoming")));

    if (!existingMeeting) {
      return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
    }

    await db
      .update(meetings)
      .set({
        status: "active",
        startedAt: new Date(),
      })
      .where(eq(meetings.id, existingMeeting.id));

    const [existingAgent] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, existingMeeting.agentId));

    if (!existingAgent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    // Trigger the Python agent service to join the call
    try {
      const response = await fetch(`${AGENT_SERVICE_URL}/agent/join`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          agent_id: existingAgent.id,
          agent_name: existingAgent.name,
          instructions: existingAgent.instructions,
          call_type: "default",
          call_id: meetingId,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        console.error("Failed to start agent:", error);
        return NextResponse.json(
          { error: "Failed to start agent" },
          { status: 500 }
        );
      }

      const result = await response.json();
      console.log(`Agent ${existingAgent.id} triggered to join call ${meetingId}`);
      console.log("Agent service response:", result);

    } catch (error) {
      console.error("Error calling agent service:", error);
      return NextResponse.json(
        { error: "Agent service unavailable" },
        { status: 503 }
      );
    }

  } else if (eventType === "call.session_participant_left") {
    const event = payload as CallSessionParticipantLeftEvent;
    const meetingId = event.call_cid.split(":")[1];

    if (!meetingId) {
      return NextResponse.json({ error: "Missing meetingId" }, { status: 400 });
    }

    // Tell the Python agent service to remove the agent from the call
    try {
      await fetch(`${AGENT_SERVICE_URL}/agent/leave`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          call_id: meetingId,
        }),
      });
    } catch (error) {
      console.error("Error calling agent service to leave:", error);
    }

    const call = streamVideo.video.call("default", meetingId);
    await call.end();
  } else if (eventType === "call.session_ended") {
    const event = payload as CallEndedEvent;
    const meetingId = event.call.custom?.meetingId;

    if (!meetingId) {
      return NextResponse.json({ error: "Missing meetingId" }, { status: 400 })
    }

    await db
      .update(meetings)
      .set({
        status: "processing",
        endedAt: new Date()
      })
      .where(and(eq(meetings.id, meetingId), eq(meetings.status, "active")))
  } else if (eventType === "call.transcription_ready") {
    const event = payload as CallTranscriptionReadyEvent;
    const meetingId = event.call_cid.split(":")[1];

    const [updatedMeeting] = await db
      .update(meetings)
      .set({
        transcriptUrl: event.call_transcription.url,
      })
      .where(eq(meetings.id, meetingId))
      .returning();

    if (!updatedMeeting) {
      return NextResponse.json({ error: "Missing not found" }, { status: 404 });
    }

    await inngest.send({
      name: "meetings/processing",
      data: {
        meetingId: updatedMeeting.id,
        transcriptUrl: updatedMeeting.transcriptUrl,
      }
    })
  } else if (eventType === "call.recording_ready") {
    const event = payload as CallRecordingReadyEvent;
    const meetingId = event.call_cid.split(":")[1];

    await db
      .update(meetings)
      .set({
        recordingUrl: event.call_recording.url,
      })
      .where(eq(meetings.id, meetingId));

  }

  return NextResponse.json({ status: "ok" });
}