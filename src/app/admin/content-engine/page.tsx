import { getContentQueueSnapshot, getContentQueueCharacters } from "@/lib/frontend/admin-content-queue";
import { ContentQueueConsole } from "@/components/admin/content-queue/content-queue-console";

export default async function AdminContentEnginePage() {
  const [{ items, counts }, characters] = await Promise.all([
    getContentQueueSnapshot(),
    getContentQueueCharacters(),
  ]);

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-16">
      <div>
        <h2 className="font-display text-2xl mb-1">Content Engine</h2>
        <p className="text-text-secondary text-sm">
          AI-generated character images, chat-line variety, and video — nothing here reaches
          users until it&apos;s published.
        </p>
      </div>
      <ContentQueueConsole initialItems={items} initialCounts={counts} characters={characters} />
    </div>
  );
}
