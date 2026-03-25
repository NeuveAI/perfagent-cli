"use client";

import { useState } from "react";
import type { eventWithTime } from "@posthog/rrweb";
import { ReplayViewer } from "@/components/replay/replay-viewer";
import { startRecording, stopRecording } from "@/lib/rrweb";
import { useMountEffect } from "@/hooks/use-mount-effect";

export default function ReplayPage() {
  const [recording, setRecording] = useState(true);
  const [events, setEvents] = useState<eventWithTime[]>([]);

  useMountEffect(() => {
    void startRecording();
  });

  const handleCompleteRecording = () => {
    const recordedEvents = stopRecording();
    if (recordedEvents.length < 2) return;
    setEvents(recordedEvents);
    setRecording(false);
  };

  if (!recording) {
    return <ReplayViewer events={events} />;
  }

  return (
    <div className="relative flex h-screen flex-col items-center justify-center">
      <div className="flex flex-col items-center gap-6">
        <div className="flex size-16 items-center justify-center rounded-full bg-red-500/10">
          <div className="size-4 animate-pulse rounded-full bg-red-500" />
        </div>
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900">
            Recording session...
          </h1>
          <p className="text-sm text-neutral-500">
            Interact with the page, then complete the recording to replay it.
          </p>
        </div>
        <button
          type="button"
          onClick={handleCompleteRecording}
          className="rounded-full bg-neutral-900 px-6 py-2.5 text-sm font-medium text-white shadow-lg transition-transform duration-150 ease-out active:scale-[0.97]"
        >
          Complete Recording
        </button>
      </div>
    </div>
  );
}
