"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChatPanel } from "./chat-panel";
import { TrainingPanel } from "./training-panel";
import { HistoryPanel } from "./history-panel";
import type { DigitalTwinProfile, TrainingDepth } from "@/lib/digital-twin/engine";

export function TwinConsole({
  initialProfile,
  trainingCosts,
  trainingEtas,
  tokens,
}: {
  initialProfile: DigitalTwinProfile | null;
  trainingCosts: Record<TrainingDepth, number>;
  trainingEtas: Record<TrainingDepth, number>;
  tokens: number;
}) {
  const [profile, setProfile] = useState(initialProfile);

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          {profile?.autoTraits && (
            <Badge variant={profile.enabled ? "solid" : "outline"}>
              {profile.enabled ? "Active" : "Disabled"}
            </Badge>
          )}
        </div>
        {profile?.autoTraits && (
          <Button variant="ghost" size="sm" asChild>
            <a href="/api/digital-twin/export" download>
              <Download className="h-4 w-4" /> Export
            </a>
          </Button>
        )}
      </div>

      <Tabs defaultValue="chat">
        <TabsList>
          <TabsTrigger value="chat">Chat</TabsTrigger>
          <TabsTrigger value="training">Training</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="chat" className="pt-6">
          <ChatPanel profile={profile} />
        </TabsContent>

        <TabsContent value="training" className="pt-6">
          <TrainingPanel
            profile={profile}
            trainingCosts={trainingCosts}
            trainingEtas={trainingEtas}
            tokens={tokens}
            onProfileChange={setProfile}
          />
        </TabsContent>

        <TabsContent value="history" className="pt-6">
          <HistoryPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
