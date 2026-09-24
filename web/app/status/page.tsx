import Shell from "../Shell";
import ArchiveView from "../ArchiveView";

export default function StatusPage() {
  return (
    <Shell>
      <ArchiveView
        kind="status"
        title="Status"
        description="Story WhatsApp yang dibaca, di-react, dan diunduh oleh bot."
        emptyTitle="No status available."
      />
    </Shell>
  );
}
